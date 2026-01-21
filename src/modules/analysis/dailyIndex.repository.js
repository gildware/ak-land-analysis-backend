import { prisma } from "../../config/prisma.js";

export function getDailyIndexByRange({ landId, indexType, dateFrom, dateTo }) {
  return prisma.dailyIndex.findMany({
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

export async function bulkInsertDailyIndex(records) {
  if (!records.length) return;

  return prisma.dailyIndex.createMany({
    data: records,
    skipDuplicates: true,
  });
}
