ALTER TABLE "assets"
ADD COLUMN "rotation" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "assets"
ADD CONSTRAINT "assets_rotation_check" CHECK ("rotation" IN (0, 90, 180, 270));
