import { Router } from "express";
import {
  createAnalysisController,
  listAnalysesController,
} from "./analysis.controller.js";

const router = Router();

router.post("/", createAnalysisController);
router.get("/:landId", listAnalysesController);

export default router;
