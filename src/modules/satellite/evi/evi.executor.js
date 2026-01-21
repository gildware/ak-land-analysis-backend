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

export async function runEVIAnalysis(analysisId) {
  console.log(`[EVI] ▶️ Starting EVI analysis`, { analysisId });

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
      indexType: "EVI",
      dateFrom,
      dateTo,
    });

    const missingRanges = getMissingDateRanges({
      dateFrom,
      dateTo,
      existingRows: existing,
    });

    console.log(`[EVI] Missing ranges`, { missingRanges });

    if (missingRanges.length) {
      const token = await getSentinelAccessToken();

      for (const range of missingRanges) {
        const payload = buildEVIPayload(
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

        const rows = normalizeEVIStats({
          landId,
          indexType: "EVI",
          from: range.from,
          to: range.to,
          stats: res.data,
        });

        await bulkInsertDailyIndex(rows);
      }
    }

    await markAnalysisCompleted(analysisId);
    console.log(`[EVI] ✅ Completed`, { analysisId });
  } catch (err) {
    console.error(`[EVI] ❌ Failed`, err.response?.data || err.message);
    await markAnalysisFailed(analysisId, err.message);
  }
}

/* ---------------- helpers ---------------- */

function buildEVIPayload(geometry, from, to) {
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
            input: [{ bands: ["B02", "B04", "B08", "dataMask"] }],
            output: [
              { id: "evi", bands: 1 },
              { id: "dataMask", bands: 1 }
            ]
          };
        }

        function evaluatePixel(s) {
          let evi = 2.5 * (s.B08 - s.B04) /
            (s.B08 + 6.0 * s.B04 - 7.5 * s.B02 + 1.0);

          return {
            evi: [evi],
            dataMask: [s.dataMask]
          };
        }
      `,
    },
  };
}

function normalizeEVIStats({ landId, indexType, from, to, stats }) {
  const days = enumerateDaysUTC(from, to);
  const map = new Map();

  for (const d of stats.data || []) {
    const day = toUTCDay(new Date(d.interval.from));
    const eviStats = d.outputs?.evi?.bands?.B0?.stats ?? null;

    map.set(day.getTime(), eviStats);
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
