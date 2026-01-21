-- CreateTable
CREATE TABLE "DailyIndexRaster" (
    "id" TEXT NOT NULL,
    "landId" TEXT NOT NULL,
    "indexType" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "pngPath" TEXT NOT NULL,
    "tiffPath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyIndexRaster_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyIndexRaster_landId_indexType_date_idx" ON "DailyIndexRaster"("landId", "indexType", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyIndexRaster_landId_indexType_date_key" ON "DailyIndexRaster"("landId", "indexType", "date");

-- AddForeignKey
ALTER TABLE "DailyIndexRaster" ADD CONSTRAINT "DailyIndexRaster_landId_fkey" FOREIGN KEY ("landId") REFERENCES "Land"("id") ON DELETE CASCADE ON UPDATE CASCADE;
