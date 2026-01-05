import { prisma } from "../../config/prisma.js";

export function saveLand(data) {
  return prisma.land.create({
    data,
  });
}

export function getAllLands() {
  return prisma.land.findMany({
    orderBy: { createdAt: "desc" },
  });
}

export function getLandById(id) {
  return prisma.land.findUnique({
    where: { id },
  });
}
