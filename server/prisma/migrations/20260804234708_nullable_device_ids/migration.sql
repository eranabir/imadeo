-- DropIndex
DROP INDEX "asset_exif_description_trgm_idx";

-- DropIndex
DROP INDEX "asset_faces_embedding_idx";

-- DropIndex
DROP INDEX "assets_original_file_name_trgm_idx";

-- DropIndex
DROP INDEX "people_name_trgm_idx";

-- DropIndex
DROP INDEX "smart_search_embedding_idx";

-- AlterTable
ALTER TABLE "assets" ALTER COLUMN "deviceAssetId" DROP NOT NULL,
ALTER COLUMN "deviceAssetId" DROP DEFAULT,
ALTER COLUMN "deviceId" DROP NOT NULL,
ALTER COLUMN "deviceId" DROP DEFAULT;
