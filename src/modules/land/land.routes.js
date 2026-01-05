import express from "express";
import {
  createLandController,
  listLandsController,
  getLandByIdController,
} from "./land.controller.js";

const router = express.Router();

router.post("/", createLandController);
router.get("/", listLandsController);
router.get("/:id", getLandByIdController);

export default router;
