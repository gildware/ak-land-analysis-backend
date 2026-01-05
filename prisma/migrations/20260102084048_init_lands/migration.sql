-- CreateTable
CREATE TABLE "lands" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "geometry" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lands_pkey" PRIMARY KEY ("id")
);
