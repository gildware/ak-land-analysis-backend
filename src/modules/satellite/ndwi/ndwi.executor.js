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

export async function runNDWIAnalysis(analysisId) {
  console.log("[NDWI] ▶️ Starting NDWI analysis", { analysisId });

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
     * 1️⃣ DAILY NDWI STATS
     * ====================================================== */

    const existingStats = await getExistingDailyIndex({
      landId,
      indexType: "NDWI",
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
        buildNDWIStatsPayload(analysis.land.geometry, range.from, range.to),
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        },
      );

      const rows = normalizeNDWIStats({
        landId,
        indexType: "NDWI",
        from: range.from,
        to: range.to,
        stats: res.data,
      });

      await bulkInsertDailyIndex(rows);
    }

    /* ======================================================
     * 2️⃣ DAILY NDWI RASTERS
     * ====================================================== */

    const existingRasters = await getRastersByRange({
      landId,
      indexType: "NDWI",
      dateFrom,
      dateTo,
    });

    const rasterSet = new Set(existingRasters.map((r) => r.date.getTime()));

    for (const day of enumerateDaysUTC(dateFrom, dateTo)) {
      const key = day.getTime();
      const dayStr = day.toISOString().slice(0, 10);

      if (rasterSet.has(key)) continue;

      const { dir, pngPath, tiffPath } = getRasterPaths({
        landId,
        indexType: "NDWI",
        date: day,
      });

      if (rasterExists({ pngPath, tiffPath })) continue;

      ensureRasterDir(dir);

      /* ---------- PNG ---------- */

      const pngRes = await axios.post(
        PROCESS_URL,
        buildNDWIRasterPayload(analysis.land.geometry, day, "image/png"),
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
          indexType: "NDWI",
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
        buildNDWIRasterPayload(analysis.land.geometry, day, "image/tiff"),
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
        indexType: "NDWI",
        date: day,
      });

      await createRasterEntry({
        landId,
        indexType: "NDWI",
        date: day,
        pngPath: publicPaths.png,
        tiffPath: publicPaths.tiff,
      });
    }

    await markAnalysisCompleted(analysisId);
    console.log("[NDWI] ✅ Completed", { analysisId });
  } catch (err) {
    console.error("[NDWI] ❌ Failed", err.response?.data || err.message);
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

function buildNDWIStatsPayload(geometry, from, to) {
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
      evalscript: NDWI_STATS_EVALSCRIPT,
    },
  };
}

function buildNDWIRasterPayload(geometry, date, format) {
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
      format === "image/png" ? NDWI_PNG_EVALSCRIPT : NDWI_TIFF_EVALSCRIPT,
  };
}

/* ======================================================
 * NORMALIZATION
 * ====================================================== */

function normalizeNDWIStats({ landId, indexType, from, to, stats }) {
  const days = enumerateDaysUTC(from, to);
  const map = new Map();

  for (const row of stats.data || []) {
    const day = toUTCDay(new Date(row.interval.from));
    const ndwiStats = row.outputs?.ndwi?.bands?.B0?.stats ?? null;
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

/* ======================================================
 * EVALSCRIPTS
 * ====================================================== */

const NDWI_STATS_EVALSCRIPT = `
  //VERSION=3
  function setup() {
    return {
      input: [{ bands: ["B03", "B08", "dataMask"] }],
      output: [
        { id: "ndwi", bands: 1 },
        { id: "dataMask", bands: 1 }
      ]
    };
  }

  function evaluatePixel(s) {
    let ndwi = (s.B03 - s.B08) / (s.B03 + s.B08);
    return { ndwi: [ndwi], dataMask: [s.dataMask] };
  }
`;

const NDWI_PNG_EVALSCRIPT = `
  //VERSION=3
  function setup() {
    return {
      input: [{ bands: ["B03", "B08", "dataMask"] }],
      output: [{ id: "default", bands: 4, sampleType: "UINT8" }]
    };
  }

  function colorRamp(ndwi) {
    if (ndwi < -0.2) return [139, 69, 19, 255];  // dry soil
    if (ndwi < 0.0)  return [210, 180, 140, 255]; // bare land
    if (ndwi < 0.2)  return [173, 216, 230, 255]; // moist soil
    if (ndwi < 0.4)  return [100, 149, 237, 255]; // shallow water
    return [0, 0, 139, 255];                      // deep water
  }

  function evaluatePixel(s) {
    if (s.dataMask === 0) return [0, 0, 0, 0];
    let ndwi = (s.B03 - s.B08) / (s.B03 + s.B08);
    return colorRamp(ndwi);
  }
`;

const NDWI_TIFF_EVALSCRIPT = `
  //VERSION=3
  function setup() {
    return {
      input: [{ bands: ["B03", "B08", "dataMask"] }],
      output: [{ id: "default", bands: 1, sampleType: "FLOAT32" }]
    };
  }

  function evaluatePixel(s) {
    if (s.dataMask === 0) return [NaN];
    let ndwi = (s.B03 - s.B08) / (s.B03 + s.B08);
    return [ndwi];
  }
`;
