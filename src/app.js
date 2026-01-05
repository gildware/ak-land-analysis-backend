import express from "express";
import cors from "cors";
import healthRoutes from "./routes/health.routes.js";
import landRoutes from "./modules/land/land.routes.js";
import analysisRoutes from "./modules/analysis/analysis.routes.js";
import ndviRoutes from "./modules/satellite/ndvi.tiles.routes.js";
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/health", healthRoutes);
app.use("/lands", landRoutes);
app.use("/analysis", analysisRoutes);

app.use("/api/tiles", ndviRoutes);

export default app;
