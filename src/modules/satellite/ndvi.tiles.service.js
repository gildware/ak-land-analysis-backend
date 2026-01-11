// ndvi.tiles.service.js
import axios from "axios";
import * as tilebelt from "@mapbox/tilebelt";
import { prisma } from "../../config/prisma.js";
import { getSentinelAccessToken } from "./sentinelAuth.js";
import { NDVI_EVALSCRIPT } from "./ndvi.evalscript.js";

const PROCESS_URL = "https://services.sentinel-hub.com/api/v1/process";

export async function getNDVITile({ landId, z, x, y, dateFrom, dateTo }) {
  // 1. get land geometry
  const land = await prisma.land.findUnique({
    where: { id: landId },
  });

  if (!land) {
    throw new Error("Land not found");
  }

  // 2. tile → bbox
  const bbox = tilebelt.tileToBBOX([x, y, z]);

  // 3. sentinel token
  const token = await getSentinelAccessToken();

  // 4. SENTINEL PAYLOAD (VALID, TESTED STRUCTURE)
  const payload = {
    input: {
      bounds: {
        bbox,
        geometry: land.geometry, // 🔥 CLIP HERE
        properties: {
          crs: "http://www.opengis.net/def/crs/EPSG/0/4326",
        },
      },
      data: [
        {
          type: "sentinel-2-l2a",
          dataFilter: {
            timeRange: {
              from: dateFrom,
              to: dateTo,
            },
            mosaickingOrder: "mostRecent",
          },
        },
      ],
    },
    output: {
      width: 256,
      height: 256,
      responses: [
        {
          identifier: "default",
          format: { type: "image/png" },
        },
      ],
    },
    evalscript: NDVI_EVALSCRIPT,
  };

  try {
    console.log("SENTINEL PAYLOAD", JSON.stringify(payload));
    const res = await axios.post(PROCESS_URL, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "image/png",
      },
      responseType: "arraybuffer",
    });
    console.log("Sentinel request successful");
    return res.data;
  } catch (error) {
    console.error(
      "Sentinel request failed:",
      error.response?.data || error.message
    );
    return error;
  }
}
