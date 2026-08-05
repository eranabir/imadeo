-- CreateEnum
CREATE TYPE "SubjectKind" AS ENUM ('PERSON', 'PET');

-- AlterTable
ALTER TABLE "asset_faces" ADD COLUMN     "kind" "SubjectKind" NOT NULL DEFAULT 'PERSON',
ADD COLUMN     "species" TEXT;

-- AlterTable
ALTER TABLE "people" ADD COLUMN     "kind" "SubjectKind" NOT NULL DEFAULT 'PERSON',
ADD COLUMN     "species" TEXT;

-- CreateIndex
CREATE INDEX "asset_faces_kind_idx" ON "asset_faces"("kind");

-- CreateIndex
CREATE INDEX "people_ownerId_kind_idx" ON "people"("ownerId", "kind");
