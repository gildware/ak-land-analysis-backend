import axios from "axios";
import { prisma } from "../../../config/prisma.js";
import { getSentinelAccessToken } from "./../sentinelAuth.js";
import {
  markAnalysisRunning,
  markAnalysisCompleted,
  markAnalysisFailed,
} from "../../analysis/analysis.service.js";

import {
  getExistingDailyIndex,
  getMissingDateRanges,
} from "../../analysis/dailyIndex.service.js";

import { bulkInsertDailyIndex } from "../../analysis/dailyIndex.repository.js";

const STATISTICS_URL = "https://services.sentinel-hub.com/api/v1/statistics";
const L = 0.5; // Soil brightness correction factor

export async function runSAVIAnalysis(analysisId) {
  console.log(`[SAVI] ▶️ Starting SAVI analysis`, { analysisId });

  try {
    await markAnalysisRunning(analysisId);

    const analysis = await prisma.analysis.findUnique({
      where: { id: analysisId },
      include: { land: true },
    });

    if (!analysis || !analysis.land) {
      throw new Error("Analysis or land not found");
    }

    const { landId, dateFrom, dateTo } = analysis;

    const existing = await getExistingDailyIndex({
      landId,
      indexType: "SAVI",
      dateFrom,
      dateTo,
    });

    const missingRanges = getMissingDateRanges({
      dateFrom,
      dateTo,
      existingRows: existing,
    });

    if (missingRanges.length) {
      const token = await getSentinelAccessToken();

      for (const range of missingRanges) {
        const payload = buildSAVIPayload(
          analysis.land.geometry,
          range.from,
          range.to,
        );

        const res = await axios.post(STATISTICS_URL, payload, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });

        const rows = normalizeSAVIStats({
          landId,
          indexType: "SAVI",
          from: range.from,
          to: range.to,
          stats: res.data,
        });

        await bulkInsertDailyIndex(rows);
      }
    }

    await markAnalysisCompleted(analysisId);
    console.log(`[SAVI] ✅ Completed`, { analysisId });
  } catch (err) {
    console.error(`[SAVI] ❌ Failed`, err.response?.data || err.message);
    await markAnalysisFailed(analysisId, err.message);
  }
}

/* ---------- helpers ---------- */

function buildSAVIPayload(geometry, from, to) {
  return {
    input: {
      bounds: { geometry },
      data: [
        {
          type: "sentinel-2-l2a",
          dataFilter: {
            timeRange: {
              from: from.toISOString(),
              to: to.toISOString(),
            },
          },
        },
      ],
    },
    aggregation: {
      timeRange: {
        from: from.toISOString(),
        to: to.toISOString(),
      },
      aggregationInterval: { of: "P1D" },
      evalscript: `
        //VERSION=3
        function setup() {
          return {
            input: [{ bands: ["B04", "B08", "dataMask"] }],
            output: [
              { id: "savi", bands: 1 },
              { id: "dataMask", bands: 1 }
            ]
          };
        }

        function evaluatePixel(s) {
          let savi = (1 + ${L}) * (s.B08 - s.B04) /
                     (s.B08 + s.B04 + ${L});
          return {
            savi: [savi],
            dataMask: [s.dataMask]
          };
        }
      `,
    },
  };
}

function normalizeSAVIStats({ landId, indexType, from, to, stats }) {
  const days = enumerateDaysUTC(from, to);
  const map = new Map();

  for (const d of stats.data || []) {
    const day = toUTCDay(new Date(d.interval.from));
    const saviStats = d.outputs?.savi?.bands?.B0?.stats ?? null;

    map.set(day.getTime(), saviStats);
  }

  return days.map((date) => ({
    landId,
    indexType,
    date,
    data: map.get(date.getTime()) ?? null,
  }));
}

function enumerateDaysUTC(from, to) {
  const days = [];
  let cursor = toUTCDay(from);
  const end = toUTCDay(to);

  while (cursor <= end) {
    days.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

function toUTCDay(d) {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}
