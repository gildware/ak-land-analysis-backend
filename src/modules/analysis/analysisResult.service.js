// src/modules/analysis/analysisResult.service.js

import { getDailyIndexByRange } from "./dailyIndex.repository.js";

/**
 * Builds analysis result from daily index data
 */
export async function buildAnalysisResult({
  landId,
  indexType,
  dateFrom,
  dateTo,
}) {
  const dailyRows = await getDailyIndexByRange({
    landId,
    indexType,
    dateFrom,
    dateTo,
  });

  // Keep same response shape as before
  // Returning raw daily stats array
  return dailyRows.map((row) => ({
    date: row.date,
    data: row.data,
  }));
}
