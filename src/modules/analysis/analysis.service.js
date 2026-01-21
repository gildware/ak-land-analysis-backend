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
