import {
  createAnalysisJob,
  getAnalysisWithDailyData,
  listAnalysesForLand,
} from "./analysis.service.js";

import { getDailyIndexByRange } from "./dailyIndex.repository.js";

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

    const enriched = await Promise.all(
      analyses.map((a) => getAnalysisWithDailyData(a)),
    );

    res.json(enriched);
  } catch (err) {
    console.error("Fetch analyses failed:", err);
    res.status(500).json({ message: "Failed to fetch analyses" });
  }
}

// export async function listAnalysesController(req, res) {
//   try {
//     const { landId } = req.params;

//     if (!landId) {
//       return res.status(400).json({ message: "landId is required" });
//     }

//     const analyses = await listAnalysesForLand(landId);

//     const enriched = await Promise.all(
//       analyses.map(async (analysis) => {
//         if (analysis.status !== "completed") {
//           return { ...analysis, result: null };
//         }

//         const daily = await getDailyIndexByRange({
//           landId: analysis.landId,
//           indexType: analysis.indexType,
//           dateFrom: analysis.dateFrom,
//           dateTo: analysis.dateTo,
//         });

//         // 🔥 result shape SAME as earlier: array of daily values
//         return {
//           ...analysis,
//           result: daily.map((d) => ({
//             date: d.date,
//             value: d.data, // stats OR null
//           })),
//         };
//       }),
//     );

//     res.json(enriched);
//   } catch (err) {
//     console.error("Fetch analyses failed:", err);
//     res.status(500).json({ message: "Failed to fetch analyses" });
//   }
// }
