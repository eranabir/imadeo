ALTER TABLE "assets" ADD COLUMN "uploadBatchId" VARCHAR(100);

CREATE TABLE "recognition_batches" (
    "id" VARCHAR(100) NOT NULL,
    "ownerId" UUID NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recognition_batches_pkey" PRIMARY KEY ("ownerId", "id")
);

CREATE INDEX "assets_ownerId_uploadBatchId_idx" ON "assets"("ownerId", "uploadBatchId");
CREATE INDEX "recognition_batches_ownerId_completedAt_createdAt_idx"
    ON "recognition_batches"("ownerId", "completedAt", "createdAt" DESC);

ALTER TABLE "recognition_batches"
    ADD CONSTRAINT "recognition_batches_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
