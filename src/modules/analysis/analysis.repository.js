import { prisma } from "../../config/prisma.js";

export function createAnalysis(data) {
  return prisma.analysis.create({
    data,
  });
}

export function getAnalysesByLandId(landId) {
  return prisma.analysis.findMany({
    where: { landId },
    orderBy: { createdAt: "desc" },
  });
}

export function getAnalysisById(id) {
  return prisma.analysis.findUnique({
    where: { id },
  });
}

export function updateAnalysisStatus(id, status, result = null) {
  return prisma.analysis.update({
    where: { id },
    data: {
      status,
      ...(result && { result }),
    },
  });
}

export async function getDailyDataForAnalysis({
  landId,
  indexType,
  dateFrom,
  dateTo,
}) {
  const [stats, rasters] = await Promise.all([
    prisma.dailyIndex.findMany({
      where: {
        landId,
        indexType,
        date: {
          gte: dateFrom,
          lte: dateTo,
        },
      },
    }),
    prisma.dailyIndexRaster.findMany({
      where: {
        landId,
        indexType,
        date: {
          gte: dateFrom,
          lte: dateTo,
        },
      },
    }),
  ]);

  return { stats, rasters };
}
