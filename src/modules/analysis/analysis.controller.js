import { createAnalysisJob, listAnalysesForLand } from "./analysis.service.js";

export async function createAnalysisController(req, res) {
  try {
    const { landId, indexType, dateFrom, dateTo } = req.body;

    if (!landId || !indexType || !dateFrom || !dateTo) {
      return res.status(400).json({ message: "Missing fields" });
    }

    const analysis = await createAnalysisJob({
      landId,
      indexType,
      dateFrom,
      dateTo,
    });

    res.status(201).json(analysis);
  } catch (err) {
    console.error("Create analysis failed:", err);
    res.status(500).json({ message: "Failed to create analysis" });
  }
}

export async function listAnalysesController(req, res) {
  try {
    const { landId } = req.params;

    if (!landId) {
      return res.status(400).json({ message: "landId is required" });
    }

    const analyses = await listAnalysesForLand(landId);
    res.json(analyses);
  } catch (err) {
    console.error("Fetch analyses failed:", err);
    res.status(500).json({ message: "Failed to fetch analyses" });
  }
}
