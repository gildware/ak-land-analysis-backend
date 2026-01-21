-- CreateTable
CREATE TABLE "Land" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "geometry" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Land_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Analysis" (
    "id" TEXT NOT NULL,
    "landId" TEXT NOT NULL,
    "indexType" TEXT NOT NULL,
    "dateFrom" TIMESTAMP(3) NOT NULL,
    "dateTo" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyIndex" (
    "id" TEXT NOT NULL,
    "landId" TEXT NOT NULL,
    "indexType" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyIndex_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Analysis_landId_idx" ON "Analysis"("landId");

-- CreateIndex
CREATE INDEX "DailyIndex_landId_indexType_date_idx" ON "DailyIndex"("landId", "indexType", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyIndex_landId_indexType_date_key" ON "DailyIndex"("landId", "indexType", "date");

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_landId_fkey" FOREIGN KEY ("landId") REFERENCES "Land"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyIndex" ADD CONSTRAINT "DailyIndex_landId_fkey" FOREIGN KEY ("landId") REFERENCES "Land"("id") ON DELETE CASCADE ON UPDATE CASCADE;
