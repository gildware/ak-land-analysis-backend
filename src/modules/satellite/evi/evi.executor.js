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

export async function runEVIAnalysis(analysisId) {
  console.log("[EVI] ▶️ Starting EVI analysis", { analysisId });

  try {
    await markAnalysisRunning(analysisId);
    console.log("[EVI] Status → RUNNING", { analysisId });

    const analysis = await prisma.analysis.findUnique({
      where: { id: analysisId },
      include: { land: true },
    });

    if (!analysis || !analysis.land) {
      throw new Error("Analysis or land not found");
    }

    const { landId, dateFrom, dateTo } = analysis;

    console.log("[EVI] Analysis loaded", {
      analysisId,
      landId,
      dateFrom,
      dateTo,
    });

    const token = await getSentinelAccessToken();
    console.log("[EVI] Sentinel token acquired");

    /* ======================================================
     * 1️⃣ DAILY EVI STATS
     * ====================================================== */

    const existingStats = await getExistingDailyIndex({
      landId,
      indexType: "EVI",
      dateFrom,
      dateTo,
    });

    const missingRanges = getMissingDateRanges({
      dateFrom,
      dateTo,
      existingRows: existingStats,
    });

    console.log("[EVI] Missing stats ranges", {
      analysisId,
      missingRanges,
    });

    for (const range of missingRanges) {
      const res = await axios.post(
        STATISTICS_URL,
        buildEVIStatsPayload(analysis.land.geometry, range.from, range.to),
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        },
      );

      const rows = normalizeEVIStats({
        landId,
        indexType: "EVI",
        from: range.from,
        to: range.to,
        stats: res.data,
      });

      await bulkInsertDailyIndex(rows);

      console.log("[EVI] Stats stored", {
        analysisId,
        inserted: rows.length,
      });
    }

    /* ======================================================
     * 2️⃣ DAILY EVI RASTERS
     * ====================================================== */

    const existingRasters = await getRastersByRange({
      landId,
      indexType: "EVI",
      dateFrom,
      dateTo,
    });

    const existingRasterSet = new Set(
      existingRasters.map((r) => r.date.getTime()),
    );

    for (const day of enumerateDaysUTC(dateFrom, dateTo)) {
      const dayKey = day.getTime();
      const dayStr = day.toISOString().slice(0, 10);

      if (existingRasterSet.has(dayKey)) {
        continue;
      }

      const { dir, pngPath, tiffPath } = getRasterPaths({
        landId,
        indexType: "EVI",
        date: day,
      });

      if (rasterExists({ pngPath, tiffPath })) {
        continue;
      }

      console.log("[EVI] Fetching raster", {
        analysisId,
        date: dayStr,
      });

      ensureRasterDir(dir);

      /* ---------- PNG ---------- */

      const pngRes = await axios.post(
        PROCESS_URL,
        buildEVIRasterPayload(analysis.land.geometry, day, "image/png"),
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
          indexType: "EVI",
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
        buildEVIRasterPayload(analysis.land.geometry, day, "image/tiff"),
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
        indexType: "EVI",
        date: day,
      });

      await createRasterEntry({
        landId,
        indexType: "EVI",
        date: day,
        pngPath: publicPaths.png,
        tiffPath: publicPaths.tiff,
      });

      console.log("[EVI] Raster stored", {
        analysisId,
        date: dayStr,
      });
    }

    await markAnalysisCompleted(analysisId);
    console.log("[EVI] ✅ Analysis COMPLETED", { analysisId });
  } catch (err) {
    console.error("[EVI] ❌ Analysis FAILED", {
      analysisId,
      error: err.response?.data || err.message,
    });

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
 * PAYLOAD BUILDERS
 * ====================================================== */

function buildEVIStatsPayload(geometry, from, to) {
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
      evalscript: EVI_STATS_EVALSCRIPT,
    },
  };
}

function buildEVIRasterPayload(geometry, date, format) {
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
      resolutions: {
        default: { resolution: 10 },
      },
      responses: [{ identifier: "default", format: { type: format } }],
    },
    evalscript:
      format === "image/png" ? EVI_PNG_EVALSCRIPT : EVI_TIFF_EVALSCRIPT,
  };
}

/* ======================================================
 * NORMALIZATION
 * ====================================================== */

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

/* ======================================================
 * EVALSCRIPTS
 * ====================================================== */

const EVI_STATS_EVALSCRIPT = `
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
    let evi =
      2.5 * (s.B08 - s.B04) /
      (s.B08 + 6.0 * s.B04 - 7.5 * s.B02 + 1.0);

    return { evi: [evi], dataMask: [s.dataMask] };
  }
`;

const EVI_PNG_EVALSCRIPT = `
  //VERSION=3
  function setup() {
    return {
      input: [{ bands: ["B02", "B04", "B08", "dataMask"] }],
      output: [{ id: "default", bands: 4, sampleType: "UINT8" }]
    };
  }

  function colorRamp(evi) {
    if (evi < 0.0)  return [0, 0, 120, 255];     // Water / no vegetation
    if (evi < 0.2)  return [139, 69, 19, 255];   // Bare soil (brown)
    if (evi < 0.4)  return [173, 205, 50, 255];  // Sparse veg
    if (evi < 0.6)  return [34, 139, 34, 255];   // Moderate veg
    return [0, 100, 0, 255];                     // Dense veg
  }

  function evaluatePixel(s) {
    if (s.dataMask === 0) return [0, 0, 0, 0];

    let evi =
      2.5 * (s.B08 - s.B04) /
      (s.B08 + 6.0 * s.B04 - 7.5 * s.B02 + 1.0);

    return colorRamp(evi);
  }
`;

const EVI_TIFF_EVALSCRIPT = `
  //VERSION=3
  function setup() {
    return {
      input: [{ bands: ["B02", "B04", "B08", "dataMask"] }],
      output: [{ id: "default", bands: 1, sampleType: "FLOAT32" }]
    };
  }

  function evaluatePixel(s) {
    if (s.dataMask === 0) return [NaN];

    let evi =
      2.5 * (s.B08 - s.B04) /
      (s.B08 + 6.0 * s.B04 - 7.5 * s.B02 + 1.0);

    return [evi];
  }
`;

// import axios from "axios";
// import { prisma } from "../../../config/prisma.js";
// import { getSentinelAccessToken } from "./../sentinelAuth.js";
// import {
//   markAnalysisRunning,
//   markAnalysisCompleted,
//   markAnalysisFailed,
// } from "../../analysis/analysis.service.js";

// import {
//   getExistingDailyIndex,
//   getMissingDateRanges,
// } from "../../analysis/dailyIndex.service.js";

// import { bulkInsertDailyIndex } from "../../analysis/dailyIndex.repository.js";

// const STATISTICS_URL = "https://services.sentinel-hub.com/api/v1/statistics";

// export async function runEVIAnalysis(analysisId) {
//   console.log(`[EVI] ▶️ Starting EVI analysis`, { analysisId });

//   try {
//     await markAnalysisRunning(analysisId);

//     const analysis = await prisma.analysis.findUnique({
//       where: { id: analysisId },
//       include: { land: true },
//     });

//     if (!analysis || !analysis.land) {
//       throw new Error("Analysis or land not found");
//     }

//     const { landId, dateFrom, dateTo } = analysis;

//     const existing = await getExistingDailyIndex({
//       landId,
//       indexType: "EVI",
//       dateFrom,
//       dateTo,
//     });

//     const missingRanges = getMissingDateRanges({
//       dateFrom,
//       dateTo,
//       existingRows: existing,
//     });

//     console.log(`[EVI] Missing ranges`, { missingRanges });

//     if (missingRanges.length) {
//       const token = await getSentinelAccessToken();

//       for (const range of missingRanges) {
//         const payload = buildEVIPayload(
//           analysis.land.geometry,
//           range.from,
//           range.to,
//         );

//         const res = await axios.post(STATISTICS_URL, payload, {
//           headers: {
//             Authorization: `Bearer ${token}`,
//             "Content-Type": "application/json",
//           },
//         });

//         const rows = normalizeEVIStats({
//           landId,
//           indexType: "EVI",
//           from: range.from,
//           to: range.to,
//           stats: res.data,
//         });

//         await bulkInsertDailyIndex(rows);
//       }
//     }

//     await markAnalysisCompleted(analysisId);
//     console.log(`[EVI] ✅ Completed`, { analysisId });
//   } catch (err) {
//     console.error(`[EVI] ❌ Failed`, err.response?.data || err.message);
//     await markAnalysisFailed(analysisId, err.message);
//   }
// }

// /* ---------------- helpers ---------------- */

// function buildEVIPayload(geometry, from, to) {
//   return {
//     input: {
//       bounds: { geometry },
//       data: [
//         {
//           type: "sentinel-2-l2a",
//           dataFilter: {
//             timeRange: {
//               from: from.toISOString(),
//               to: to.toISOString(),
//             },
//           },
//         },
//       ],
//     },
//     aggregation: {
//       timeRange: {
//         from: from.toISOString(),
//         to: to.toISOString(),
//       },
//       aggregationInterval: { of: "P1D" },
//       evalscript: `
//         //VERSION=3
//         function setup() {
//           return {
//             input: [{ bands: ["B02", "B04", "B08", "dataMask"] }],
//             output: [
//               { id: "evi", bands: 1 },
//               { id: "dataMask", bands: 1 }
//             ]
//           };
//         }

//         function evaluatePixel(s) {
//           let evi = 2.5 * (s.B08 - s.B04) /
//             (s.B08 + 6.0 * s.B04 - 7.5 * s.B02 + 1.0);

//           return {
//             evi: [evi],
//             dataMask: [s.dataMask]
//           };
//         }
//       `,
//     },
//   };
// }

// function normalizeEVIStats({ landId, indexType, from, to, stats }) {
//   const days = enumerateDaysUTC(from, to);
//   const map = new Map();

//   for (const d of stats.data || []) {
//     const day = toUTCDay(new Date(d.interval.from));
//     const eviStats = d.outputs?.evi?.bands?.B0?.stats ?? null;

//     map.set(day.getTime(), eviStats);
//   }

//   return days.map((date) => ({
//     landId,
//     indexType,
//     date,
//     data: map.get(date.getTime()) ?? null,
//   }));
// }

// function enumerateDaysUTC(from, to) {
//   const days = [];
//   let cursor = toUTCDay(from);
//   const end = toUTCDay(to);

//   while (cursor <= end) {
//     days.push(new Date(cursor));
//     cursor.setUTCDate(cursor.getUTCDate() + 1);
//   }

//   return days;
// }

// function toUTCDay(d) {
//   return new Date(
//     Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
//   );
// }
