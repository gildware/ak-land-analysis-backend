// ndvi.tiles.controller.js
import { getNDVITile } from "./ndvi.tiles.service.js";

export async function ndviTileController(req, res) {
  try {
    const { landId, z, x, y } = req.params;
    const { dateFrom, dateTo, data } = req.query;

    // if (!dateFrom || !dateTo) {
    //   return res.status(400).send("dateFrom and dateTo required");
    // }

    const image = await getNDVITile({
      landId,
      z: Number(z),
      x: Number(x),
      y: Number(y),
      dateFrom: data,
      dateTo: data,
    });

    res.set("Content-Type", "image/png");
    res.send(image);
  } catch (e) {
    console.log("NDVI tile err", e);
    console.error(e.response?.data || e.message);
    res.status(500).send("NDVI tile failed");
  }
}
