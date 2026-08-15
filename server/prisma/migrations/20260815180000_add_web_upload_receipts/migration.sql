ALTER TABLE "assets"
ADD COLUMN "uploadId" VARCHAR(100);

CREATE UNIQUE INDEX "assets_ownerId_uploadId_key"
ON "assets"("ownerId", "uploadId");
