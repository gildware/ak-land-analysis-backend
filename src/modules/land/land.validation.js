import { z } from "zod";
import { polygon, booleanValid, area } from "@turf/turf";

/**
 * Coordinate tuple [lng, lat]
 */
const coordinateSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);

/**
 * GeoJSON Polygon schema
 */
const geoJsonPolygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(coordinateSchema).min(4)).min(1),
});

/**
 * Create Land Schema with advanced checks
 */
export const createLandSchema = z
  .object({
    name: z.string().min(1),
    geometry: geoJsonPolygonSchema,
  })
  .superRefine((data, ctx) => {
    const ring = data.geometry.coordinates[0];

    // 1. Ring closure check
    const first = ring[0];
    const last = ring[ring.length - 1];

    if (first[0] !== last[0] || first[1] !== last[1]) {
      ctx.addIssue({
        path: ["geometry", "coordinates"],
        message:
          "Polygon ring must be closed (first and last coordinate must match)",
      });
      return;
    }

    // 2. Turf polygon validity
    let turfPolygon;
    try {
      turfPolygon = polygon(data.geometry.coordinates);
    } catch {
      ctx.addIssue({
        path: ["geometry"],
        message: "Invalid polygon structure",
      });
      return;
    }

    if (!booleanValid(turfPolygon)) {
      ctx.addIssue({
        path: ["geometry"],
        message: "Polygon is self-intersecting or invalid",
      });
      return;
    }

    // 3. Minimum area check (10 m²)
    const polyArea = area(turfPolygon);
    if (polyArea < 10) {
      ctx.addIssue({
        path: ["geometry"],
        message: "Polygon area is too small",
      });
    }
  });
