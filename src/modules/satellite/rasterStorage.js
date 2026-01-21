import fs from "fs";
import path from "path";

/**
 * Base directory where rasters are physically stored
 * (used ONLY by backend)
 */
const BASE_DIR = path.resolve("storage/rasters");

/**
 * Public base path (NO domain, NO protocol)
 * Frontend will resolve it automatically
 */
const PUBLIC_BASE_PATH = "rasters";

/**
 * Filesystem paths (for saving files)
 */
export function getRasterPaths({ landId, indexType, date }) {
  const day = date.toISOString().slice(0, 10);

  const dir = path.join(BASE_DIR, landId, indexType, day);

  return {
    dir,
    pngPath: path.join(dir, "image.png"),
    tiffPath: path.join(dir, "image.tif"),
  };
}

/**
 * Public paths (for API response)
 */
export function getPublicRasterPaths({ landId, indexType, date }) {
  const day = date.toISOString().slice(0, 10);

  return {
    png: `${PUBLIC_BASE_PATH}/${landId}/${indexType}/${day}/image.png`,
    tiff: `${PUBLIC_BASE_PATH}/${landId}/${indexType}/${day}/image.tif`,
  };
}

export function ensureRasterDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function rasterExists({ pngPath, tiffPath }) {
  return fs.existsSync(pngPath) && fs.existsSync(tiffPath);
}
