import { prisma } from "../../config/prisma.js";

export function getRastersByRange({ landId, indexType, dateFrom, dateTo }) {
  return prisma.dailyIndexRaster.findMany({
    where: {
      landId,
      indexType,
      date: {
        gte: dateFrom,
        lte: dateTo,
      },
    },
    orderBy: { date: "asc" },
  });
}

export async function createRasterEntry({
  landId,
  indexType,
  date,
  pngPath,
  tiffPath,
}) {
  return prisma.dailyIndexRaster.create({
    data: {
      indexType,
      date,
      pngPath,
      tiffPath,
      land: {
        connect: { id: landId },
      },
    },
  });
}
