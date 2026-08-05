-- DropIndex
DROP INDEX "assets_ownerId_checksum_key";

-- CreateIndex
CREATE INDEX "assets_ownerId_checksum_idx" ON "assets"("ownerId", "checksum");
