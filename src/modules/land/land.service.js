import { saveLand, getAllLands, getLandById } from "./land.repository.js";

export function createLand({ name, geometry }) {
  return saveLand({
    name,
    geometry,
  });
}

export function listLands() {
  return getAllLands();
}

export function findLandById(id) {
  return getLandById(id);
}
