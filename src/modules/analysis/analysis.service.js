import { runNDVIAnalysis } from "../satellite/ndvi.executor.js";
import {
  createAnalysis,
  getAnalysesByLandId,
  updateAnalysisStatus,
} from "./analysis.repository.js";

export async function createAnalysisJob(payload) {
  const analysis = await createAnalysis({
    landId: payload.landId,
    indexType: payload.indexType,
    dateFrom: new Date(payload.dateFrom),
    dateTo: new Date(payload.dateTo),
    status: "pending",
  });

  // 🔥 Trigger async computation
  if (payload.indexType === "NDVI") {
    runNDVIAnalysis(analysis.id); // fire-and-forget
  }

  return analysis;
}

export function listAnalysesForLand(landId) {
  return getAnalysesByLandId(landId);
}

// used by executor
export function markAnalysisRunning(id) {
  return updateAnalysisStatus(id, "running");
}

export function markAnalysisCompleted(id, result) {
  return updateAnalysisStatus(id, "completed", result);
}

export function markAnalysisFailed(id, error) {
  return updateAnalysisStatus(id, "failed", { error });
}
