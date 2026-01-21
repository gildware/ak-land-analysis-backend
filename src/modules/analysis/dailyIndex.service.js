import { getDailyIndexByRange } from "./dailyIndex.repository.js";

/**
 * Fetch already stored daily index rows
 */
export async function getExistingDailyIndex({
  landId,
  indexType,
  dateFrom,
  dateTo,
}) {
  return getDailyIndexByRange({
    landId,
    indexType,
    dateFrom: toUTCDay(dateFrom),
    dateTo: toUTCDay(dateTo),
  });
}

/**
 * Detect missing UTC calendar-day ranges
 * THIS VERSION IS SAFE AND IDPOTENT
 */
export function getMissingDateRanges({ dateFrom, dateTo, existingRows }) {
  // 1️⃣ Normalize request bounds
  const start = toUTCDay(dateFrom);
  const end = toUTCDay(dateTo);

  // 2️⃣ Build a set of existing UTC days (numeric)
  const existingDayKeys = new Set(
    existingRows.map((row) => toUTCDay(row.date).getTime()),
  );

  const missingRanges = [];

  let rangeStart = null;
  let cursor = new Date(start);

  while (cursor <= end) {
    const key = cursor.getTime();

    if (!existingDayKeys.has(key)) {
      if (!rangeStart) {
        rangeStart = new Date(cursor);
      }
    } else if (rangeStart) {
      // close previous missing range
      missingRanges.push({
        from: new Date(rangeStart),
        to: new Date(cursor),
      });
      rangeStart = null;
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  // close tail range
  if (rangeStart) {
    missingRanges.push({
      from: new Date(rangeStart),
      to: new Date(end),
    });
  }

  return missingRanges;
}

/* ---------- helpers ---------- */

function toUTCDay(d) {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}
