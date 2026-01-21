import { runNDVIAnalysis } from "../satellite/ndvi.executor.js";
import {
  createAnalysis,
  getAnalysesByLandId,
  updateAnalysisStatus,
} from "./analysis.repository.js";
import { runEVIAnalysis } from "../satellite/evi/evi.executor.js";
import { runSAVIAnalysis } from "../satellite/savi/savi.executor.js";
import { runNDWIAnalysis } from "../satellite/ndwi/ndwi.executor.js";

export async function createAnalysisJob(payload) {
  const analysis = await createAnalysis({
    landId: payload.landId,
    indexType: payload.indexType,
    dateFrom: new Date(payload.dateFrom),
    dateTo: new Date(payload.dateTo),
    status: "pending",
  });

  switch (payload.indexType) {
    case "NDVI":
      runNDVIAnalysis(analysis.id);
      break;
    case "EVI":
      runEVIAnalysis(analysis.id);
      break;
    case "SAVI":
      runSAVIAnalysis(analysis.id);
      break;
    case "NDWI":
      runNDWIAnalysis(analysis.id);
      break;
    default:
      throw new Error(`Unsupported index type: ${payload.indexType}`);
  }

  return analysis;
}

export function listAnalysesForLand(landId) {
  return getAnalysesByLandId(landId);
}

// executor helpers (unchanged)
export function markAnalysisRunning(id) {
  return updateAnalysisStatus(id, "running");
}

export function markAnalysisCompleted(id) {
  return updateAnalysisStatus(id, "completed");
}

export function markAnalysisFailed(id, error) {
  return updateAnalysisStatus(id, "failed", { error });
}

import { getDailyDataForAnalysis } from "./analysis.repository.js";

export async function getAnalysisWithDailyData(analysis) {
  const { stats, rasters } = await getDailyDataForAnalysis({
    landId: analysis.landId,
    indexType: analysis.indexType,
    dateFrom: analysis.dateFrom,
    dateTo: analysis.dateTo,
  });

  const statsMap = new Map(
    stats.map((s) => [s.date.toISOString().slice(0, 10), s.data]),
  );

  const rasterMap = new Map(
    rasters.map((r) => [
      r.date.toISOString().slice(0, 10),
      r.pngPath ? { png: r.pngPath, tiff: r.tiffPath } : null,
    ]),
  );

  const days = [];
  let cursor = new Date(
    Date.UTC(
      analysis.dateFrom.getUTCFullYear(),
      analysis.dateFrom.getUTCMonth(),
      analysis.dateFrom.getUTCDate(),
    ),
  );

  const end = new Date(
    Date.UTC(
      analysis.dateTo.getUTCFullYear(),
      analysis.dateTo.getUTCMonth(),
      analysis.dateTo.getUTCDate(),
    ),
  );

  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);

    days.push({
      date: key,
      stats: statsMap.get(key) ?? null,
      raster: rasterMap.get(key) ?? null,
    });

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return {
    ...analysis,
    daily: days,
  };
}
