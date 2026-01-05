import axios from "axios";
import { prisma } from "../../config/prisma.js";
import { getSentinelAccessToken } from "./sentinelAuth.js";
import {
  markAnalysisRunning,
  markAnalysisCompleted,
  markAnalysisFailed,
} from "../analysis/analysis.service.js";

const STATISTICS_URL = "https://services.sentinel-hub.com/api/v1/statistics";

export async function runNDVIAnalysis(analysisId) {
  try {
    await markAnalysisRunning(analysisId);

    const analysis = await prisma.analysis.findUnique({
      where: { id: analysisId },
      include: { land: true },
    });

    if (!analysis || !analysis.land) {
      throw new Error("Analysis or land not found");
    }

    const token = await getSentinelAccessToken();

    const payload = {
      input: {
        bounds: {
          geometry: analysis.land.geometry,
        },
        data: [
          {
            type: "sentinel-2-l2a",
            dataFilter: {
              timeRange: {
                from: analysis.dateFrom.toISOString(),
                to: analysis.dateTo.toISOString(),
              },
            },
          },
        ],
      },
      aggregation: {
        timeRange: {
          from: analysis.dateFrom.toISOString(),
          to: analysis.dateTo.toISOString(),
        },
        aggregationInterval: { of: "P1D" },
        evalscript: `
  //VERSION=3
  function setup() {
    return {
      input: [
        {
          bands: ["B04", "B08", "dataMask"]
        }
      ],
      output: [
        {
          id: "ndvi",
          bands: 1
        },
        {
          id: "dataMask",
          bands: 1
        }
      ]
    };
  }

  function evaluatePixel(sample) {
    let ndvi = (sample.B08 - sample.B04) / (sample.B08 + sample.B04);
    return {
      ndvi: [ndvi],
      dataMask: [sample.dataMask]
    };
  }
`,
        resolutions: {
          ndvi: { resolution: 10 },
        },
      },
    };

    const res = await axios.post(STATISTICS_URL, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    await markAnalysisCompleted(analysisId, res.data);
  } catch (err) {
    console.error("NDVI analysis failed:", err.response?.data || err.message);
    await markAnalysisFailed(analysisId, err.message);
  }
}
