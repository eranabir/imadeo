ALTER TABLE "assets"
ADD COLUMN "isDeviceOnly" BOOLEAN NOT NULL DEFAULT false;

-- Existing mobile uploads already carry their original client identifier.
-- Keep them out of the general Photos timeline after this migration too.
UPDATE "assets"
SET "isDeviceOnly" = true
WHERE "deviceId" IS NOT NULL;
