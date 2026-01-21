import axios from "axios";
import fs from "fs";
import { prisma } from "../../config/prisma.js";
import { getSentinelAccessToken } from "./sentinelAuth.js";

import {
  markAnalysisRunning,
  markAnalysisCompleted,
  markAnalysisFailed,
} from "../analysis/analysis.service.js";

import {
  getExistingDailyIndex,
  getMissingDateRanges,
} from "../analysis/dailyIndex.service.js";

import { bulkInsertDailyIndex } from "../analysis/dailyIndex.repository.js";

import {
  getRastersByRange,
  createRasterEntry,
} from "../raster/dailyIndexRaster.repository.js";

import {
  getRasterPaths,
  ensureRasterDir,
  rasterExists,
  getPublicRasterPaths,
} from "./rasterStorage.js";

const STATISTICS_URL = "https://services.sentinel-hub.com/api/v1/statistics";
const PROCESS_URL = "https://services.sentinel-hub.com/api/v1/process";

/* ======================================================
 * ENTRY POINT
 * ====================================================== */

export async function runNDVIAnalysis(analysisId) {
  console.log("[NDVI] ▶️ Starting NDVI analysis", { analysisId });

  try {
    await markAnalysisRunning(analysisId);
    console.log("[NDVI] Status → RUNNING", { analysisId });

    const analysis = await prisma.analysis.findUnique({
      where: { id: analysisId },
      include: { land: true },
    });

    if (!analysis || !analysis.land) {
      throw new Error("Analysis or land not found");
    }

    const { landId, dateFrom, dateTo } = analysis;

    console.log("[NDVI] Analysis loaded", {
      analysisId,
      landId,
      dateFrom,
      dateTo,
    });

    const token = await getSentinelAccessToken();
    console.log("[NDVI] Sentinel token acquired");

    /* ======================================================
     * 1️⃣ DAILY NDVI STATS
     * ====================================================== */

    const existingStats = await getExistingDailyIndex({
      landId,
      indexType: "NDVI",
      dateFrom,
      dateTo,
    });

    console.log("[NDVI] Cached stats rows", {
      analysisId,
      cachedDays: existingStats.length,
    });

    const missingRanges = getMissingDateRanges({
      dateFrom,
      dateTo,
      existingRows: existingStats,
    });

    console.log("[NDVI] Missing stats ranges", {
      analysisId,
      missingRanges,
    });

    for (const range of missingRanges) {
      console.log("[NDVI] Fetching NDVI stats", {
        analysisId,
        from: range.from,
        to: range.to,
      });

      const statsRes = await axios.post(
        STATISTICS_URL,
        buildNDVIStatsPayload(analysis.land.geometry, range.from, range.to),
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        },
      );

      console.log("[NDVI] Stats API response", {
        analysisId,
        daysReturned: statsRes.data?.data?.length ?? 0,
      });

      const dailyStats = normalizeNDVIStats({
        landId,
        indexType: "NDVI",
        from: range.from,
        to: range.to,
        stats: statsRes.data,
      });

      const daysWithData = dailyStats.filter((d) => d.data !== null).length;

      console.log("[NDVI] Stats normalized", {
        analysisId,
        totalDays: dailyStats.length,
        daysWithData,
        daysWithNoData: dailyStats.length - daysWithData,
      });

      await bulkInsertDailyIndex(dailyStats);

      console.log("[NDVI] Stats stored", {
        analysisId,
        inserted: dailyStats.length,
      });
    }

    /* ======================================================
     * 2️⃣ DAILY NDVI RASTERS
     * ====================================================== */

    const existingRasters = await getRastersByRange({
      landId,
      indexType: "NDVI",
      dateFrom,
      dateTo,
    });

    console.log("[NDVI] Cached raster rows", {
      analysisId,
      cachedRasterDays: existingRasters.length,
    });

    const existingRasterSet = new Set(
      existingRasters.map((r) => r.date.getTime()),
    );

    for (const day of enumerateDaysUTC(dateFrom, dateTo)) {
      const dayKey = day.getTime();
      const dayStr = day.toISOString().slice(0, 10);

      if (existingRasterSet.has(dayKey)) {
        console.log("[NDVI] Raster already cached (DB)", {
          analysisId,
          date: dayStr,
        });
        continue;
      }

      const { dir, pngPath, tiffPath } = getRasterPaths({
        landId,
        indexType: "NDVI",
        date: day,
      });

      if (rasterExists({ pngPath, tiffPath })) {
        console.log("[NDVI] Raster exists on disk", {
          analysisId,
          date: dayStr,
        });
        continue;
      }

      console.log("[NDVI] Fetching raster", {
        analysisId,
        date: dayStr,
      });

      ensureRasterDir(dir);

      /* ---------- PNG ---------- */

      const pngRes = await axios.post(
        PROCESS_URL,
        buildNDVIRasterPayload(analysis.land.geometry, day, "image/png"),
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
        console.log("[NDVI] No raster data for day (storing NULL)", {
          analysisId,
          date: dayStr,
        });

        await createRasterEntry({
          landId,
          indexType: "NDVI",
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
        buildNDVIRasterPayload(analysis.land.geometry, day, "image/tiff"),
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "image/tiff",
          },
          responseType: "arraybuffer",
        },
      );
      const publicPaths = getPublicRasterPaths({
        landId,
        indexType: "NDVI",
        date: day,
      });
      fs.writeFileSync(tiffPath, tifRes.data);

      await createRasterEntry({
        landId,
        indexType: "NDVI",
        date: day,
        pngPath: publicPaths.png,
        tiffPath: publicPaths.tiff,
      });

      console.log("[NDVI] Raster stored", {
        analysisId,
        date: dayStr,
        pngPath,
        tiffPath,
      });
    }

    await markAnalysisCompleted(analysisId);
    console.log("[NDVI] ✅ Analysis COMPLETED", { analysisId });
  } catch (err) {
    const errorPayload =
      err.response?.data && Buffer.isBuffer(err.response.data)
        ? JSON.parse(err.response.data.toString("utf8"))
        : err.response?.data || err.message;

    console.error("[NDVI] ❌ Analysis FAILED", {
      analysisId,
      error: errorPayload,
    });

    await markAnalysisFailed(analysisId, JSON.stringify(errorPayload));
  }
}

/* ======================================================
 * HELPERS
 * ====================================================== */

function isRasterEmpty(buffer) {
  // Sentinel empty PNGs are tiny (~<1KB)
  return !buffer || buffer.length < 1200;
}

/* ======================================================
 * PAYLOAD BUILDERS
 * ====================================================== */

function buildNDVIStatsPayload(geometry, from, to) {
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
      evalscript: NDVI_STATS_EVALSCRIPT,
    },
  };
}

function buildNDVIRasterPayload(geometry, date, format) {
  const from = date.toISOString();
  const to = new Date(date.getTime() + 86400000).toISOString();

  const isPNG = format === "image/png";

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
      resolutions: {
        default: { resolution: 10 },
      },
      responses: [
        {
          identifier: "default",
          format: { type: format },
        },
      ],
    },
    evalscript: isPNG ? NDVI_PNG_EVALSCRIPT : NDVI_TIFF_EVALSCRIPT,
  };
}

/* ======================================================
 * NORMALIZATION
 * ====================================================== */

function normalizeNDVIStats({ landId, indexType, from, to, stats }) {
  const days = enumerateDaysUTC(from, to);
  const map = new Map();

  for (const row of stats.data || []) {
    const day = toUTCDay(new Date(row.interval.from));
    const ndviStats = row.outputs?.ndvi?.bands?.B0?.stats ?? null;
    map.set(day.getTime(), ndviStats);
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

const NDVI_STATS_EVALSCRIPT = `
  //VERSION=3
  function setup() {
    return {
      input: [{ bands: ["B04", "B08", "dataMask"] }],
      output: [
        { id: "ndvi", bands: 1 },
        { id: "dataMask", bands: 1 }
      ]
    };
  }

  function evaluatePixel(s) {
    let ndvi = (s.B08 - s.B04) / (s.B08 + s.B04);
    return { ndvi: [ndvi], dataMask: [s.dataMask] };
  }
`;

const NDVI_PNG_EVALSCRIPT = `
  //VERSION=3
  function setup() {
    return {
      input: [{ bands: ["B04", "B08", "dataMask"] }],
      output: [{ id: "default", bands: 4, sampleType: "UINT8" }]
    };
  }

  function colorRamp(ndvi) {
    if (ndvi < 0)   return [255, 0, 0, 255];
    if (ndvi < 0.2) return [255, 255, 0, 255];
    if (ndvi < 0.4) return [144, 238, 144, 255];
    if (ndvi < 0.6) return [0, 128, 0, 255];
    return [0, 100, 0, 255];
  }

  function evaluatePixel(s) {
    if (s.dataMask === 0) return [0, 0, 0, 0];
    let ndvi = (s.B08 - s.B04) / (s.B08 + s.B04);
    return colorRamp(ndvi);
  }
`;

const NDVI_TIFF_EVALSCRIPT = `
  //VERSION=3
  function setup() {
    return {
      input: [{ bands: ["B04", "B08", "dataMask"] }],
      output: [{ id: "default", bands: 1, sampleType: "FLOAT32" }]
    };
  }

  function evaluatePixel(s) {
    if (s.dataMask === 0) return [NaN];
    let ndvi = (s.B08 - s.B04) / (s.B08 + s.B04);
    return [ndvi];
  }
`;
