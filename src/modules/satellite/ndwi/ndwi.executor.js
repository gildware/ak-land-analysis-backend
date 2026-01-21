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

export async function runNDWIAnalysis(analysisId) {
  console.log(`[NDWI] ▶️ Starting NDWI analysis`, { analysisId });

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
      indexType: "NDWI",
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
        const payload = buildNDWIPayload(
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

        const rows = normalizeNDWIStats({
          landId,
          indexType: "NDWI",
          from: range.from,
          to: range.to,
          stats: res.data,
        });

        await bulkInsertDailyIndex(rows);
      }
    }

    await markAnalysisCompleted(analysisId);
    console.log(`[NDWI] ✅ Completed`, { analysisId });
  } catch (err) {
    console.error(`[NDWI] ❌ Failed`, err.response?.data || err.message);
    await markAnalysisFailed(analysisId, err.message);
  }
}

/* ---------- helpers ---------- */

function buildNDWIPayload(geometry, from, to) {
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
            input: [{ bands: ["B08", "B11", "dataMask"] }],
            output: [
              { id: "ndwi", bands: 1 },
              { id: "dataMask", bands: 1 }
            ]
          };
        }

        function evaluatePixel(s) {
          let ndwi = (s.B08 - s.B11) / (s.B08 + s.B11);
          return {
            ndwi: [ndwi],
            dataMask: [s.dataMask]
          };
        }
      `,
    },
  };
}

function normalizeNDWIStats({ landId, indexType, from, to, stats }) {
  const days = enumerateDaysUTC(from, to);
  const map = new Map();

  for (const d of stats.data || []) {
    const day = toUTCDay(new Date(d.interval.from));
    const ndwiStats = d.outputs?.ndwi?.bands?.B0?.stats ?? null;

    map.set(day.getTime(), ndwiStats);
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
