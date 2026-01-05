import { createLand, listLands, findLandById } from "./land.service.js";
import { createLandSchema } from "./land.validation.js";

export async function createLandController(req, res) {
  const result = createLandSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: result.error.flatten(),
    });
  }

  const land = await createLand(result.data);
  res.status(201).json(land);
}

export async function listLandsController(req, res) {
  try {
    const lands = await listLands();
    res.json(lands);
  } catch (error) {
    console.error("Error listing lands:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function getLandByIdController(req, res) {
  const land = await findLandById(req.params.id);

  if (!land) {
    return res.status(404).json({ error: "Land not found" });
  }

  res.json(land);
}
