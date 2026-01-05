// ndvi.tiles.routes.js
import { Router } from "express";
import { ndviTileController } from "./ndvi.tiles.controller.js";

const router = Router();

router.get("/ndvi/:landId/:z/:x/:y.png", ndviTileController);

export default router;
