import axios from "axios";
import fs from "fs";
import { prisma } from "../../../config/prisma.js";
import { getSentinelAccessToken } from "../sentinelAuth.js";

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

import {
  getRastersByRange,
  createRasterEntry,
} from "../../raster/dailyIndexRaster.repository.js";

import {
  getRasterPaths,
  ensureRasterDir,
  rasterExists,
  getPublicRasterPaths,
} from "../rasterStorage.js";

const STATISTICS_URL = "https://services.sentinel-hub.com/api/v1/statistics";
const PROCESS_URL = "https://services.sentinel-hub.com/api/v1/process";

/* ======================================================
 * ENTRY POINT
 * ====================================================== */

export async function runSAVIAnalysis(analysisId) {
  console.log("[SAVI] ▶️ Starting SAVI analysis", { analysisId });

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
    const token = await getSentinelAccessToken();

    /* ======================================================
     * 1️⃣ DAILY SAVI STATS
     * ====================================================== */

    const existingStats = await getExistingDailyIndex({
      landId,
      indexType: "SAVI",
      dateFrom,
      dateTo,
    });

    const missingRanges = getMissingDateRanges({
      dateFrom,
      dateTo,
      existingRows: existingStats,
    });

    for (const range of missingRanges) {
      const res = await axios.post(
        STATISTICS_URL,
        buildSAVIStatsPayload(analysis.land.geometry, range.from, range.to),
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        },
      );

      const rows = normalizeSAVIStats({
        landId,
        indexType: "SAVI",
        from: range.from,
        to: range.to,
        stats: res.data,
      });

      await bulkInsertDailyIndex(rows);
    }

    /* ======================================================
     * 2️⃣ DAILY SAVI RASTERS
     * ====================================================== */

    const existingRasters = await getRastersByRange({
      landId,
      indexType: "SAVI",
      dateFrom,
      dateTo,
    });

    const rasterSet = new Set(existingRasters.map((r) => r.date.getTime()));

    for (const day of enumerateDaysUTC(dateFrom, dateTo)) {
      const key = day.getTime();

      if (rasterSet.has(key)) continue;

      const { dir, pngPath, tiffPath } = getRasterPaths({
        landId,
        indexType: "SAVI",
        date: day,
      });

      if (rasterExists({ pngPath, tiffPath })) continue;

      ensureRasterDir(dir);

      /* ---------- PNG ---------- */

      const pngRes = await axios.post(
        PROCESS_URL,
        buildSAVIRasterPayload(analysis.land.geometry, day, "image/png"),
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "image/png",
          },
          responseType: "arraybuffer",
        },
      );

      if (isRasterEmpty(pngRes.data)) {
        await createRasterEntry({
          landId,
          indexType: "SAVI",
          date: day,
          pngPath: null,
          tiffPath: null,
        });
        continue;
      }

      fs.writeFileSync(pngPath, pngRes.data);

      /* ---------- TIFF ---------- */

      const tifRes = await axios.post(
        PROCESS_URL,
        buildSAVIRasterPayload(analysis.land.geometry, day, "image/tiff"),
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "image/tiff",
          },
          responseType: "arraybuffer",
        },
      );

      fs.writeFileSync(tiffPath, tifRes.data);

      const publicPaths = getPublicRasterPaths({
        landId,
        indexType: "SAVI",
        date: day,
      });

      await createRasterEntry({
        landId,
        indexType: "SAVI",
        date: day,
        pngPath: publicPaths.png,
        tiffPath: publicPaths.tiff,
      });
    }

    await markAnalysisCompleted(analysisId);
    console.log("[SAVI] ✅ Completed", { analysisId });
  } catch (err) {
    console.error("[SAVI] ❌ Failed", err.response?.data || err.message);
    await markAnalysisFailed(analysisId, err.message);
  }
}

/* ======================================================
 * HELPERS
 * ====================================================== */

function isRasterEmpty(buffer) {
  return !buffer || buffer.length < 1200;
}

/* ======================================================
 * PAYLOADS
 * ====================================================== */

function buildSAVIStatsPayload(geometry, from, to) {
  return {
    input: {
      bounds: { geometry },
      data: [
        {
          type: "sentinel-2-l2a",
          dataFilter: { timeRange: { from, to } },
        },
      ],
    },
    aggregation: {
      timeRange: { from, to },
      aggregationInterval: { of: "P1D" },
      evalscript: SAVI_STATS_EVALSCRIPT,
    },
  };
}

function buildSAVIRasterPayload(geometry, date, format) {
  const from = date.toISOString();
  const to = new Date(date.getTime() + 86400000).toISOString();

  return {
    input: {
      bounds: { geometry },
      data: [
        {
          type: "sentinel-2-l2a",
          dataFilter: { timeRange: { from, to } },
        },
      ],
    },
    output: {
      bounds: { geometry },
      resolutions: { default: { resolution: 10 } },
      responses: [{ identifier: "default", format: { type: format } }],
    },
    evalscript:
      format === "image/png" ? SAVI_PNG_EVALSCRIPT : SAVI_TIFF_EVALSCRIPT,
  };
}

/* ======================================================
 * NORMALIZATION
 * ====================================================== */

function normalizeSAVIStats({ landId, indexType, from, to, stats }) {
  const days = enumerateDaysUTC(from, to);
  const map = new Map();

  for (const row of stats.data || []) {
    const day = toUTCDay(new Date(row.interval.from));
    const saviStats = row.outputs?.savi?.bands?.B0?.stats ?? null;
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

/* ======================================================
 * EVALSCRIPTS
 * ====================================================== */

const SAVI_STATS_EVALSCRIPT = `
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
    let L = 0.5;
    let savi = ((s.B08 - s.B04) / (s.B08 + s.B04 + L)) * (1 + L);
    return { savi: [savi], dataMask: [s.dataMask] };
  }
`;

const SAVI_PNG_EVALSCRIPT = `
  //VERSION=3
  function setup() {
    return {
      input: [{ bands: ["B04", "B08", "dataMask"] }],
      output: [{ id: "default", bands: 4, sampleType: "UINT8" }]
    };
  }

  function colorRamp(savi) {
    if (savi < 0)   return [165, 42, 42, 255];   // bare soil
    if (savi < 0.2) return [210, 180, 140, 255]; // sparse veg
    if (savi < 0.4) return [144, 238, 144, 255]; // moderate
    if (savi < 0.6) return [34, 139, 34, 255];   // healthy
    return [0, 100, 0, 255];                     // dense
  }

  function evaluatePixel(s) {
    if (s.dataMask === 0) return [0, 0, 0, 0];
    let L = 0.5;
    let savi = ((s.B08 - s.B04) / (s.B08 + s.B04 + L)) * (1 + L);
    return colorRamp(savi);
  }
`;

const SAVI_TIFF_EVALSCRIPT = `
  //VERSION=3
  function setup() {
    return {
      input: [{ bands: ["B04", "B08", "dataMask"] }],
      output: [{ id: "default", bands: 1, sampleType: "FLOAT32" }]
    };
  }

  function evaluatePixel(s) {
    if (s.dataMask === 0) return [NaN];
    let L = 0.5;
    let savi = ((s.B08 - s.B04) / (s.B08 + s.B04 + L)) * (1 + L);
    return [savi];
  }
`;
