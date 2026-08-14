-- A backup source is not an authentication session. It remains attached to
-- its photos after sign-out and can be displayed as its own library.
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT '',
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "devices_ownerId_clientId_key" ON "devices"("ownerId", "clientId");
CREATE INDEX "devices_ownerId_lastSeenAt_idx" ON "devices"("ownerId", "lastSeenAt" DESC);

ALTER TABLE "devices"
  ADD CONSTRAINT "devices_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "device_assets" (
    "deviceId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "deviceAssetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_assets_pkey" PRIMARY KEY ("deviceId", "deviceAssetId")
);

CREATE INDEX "device_assets_assetId_idx" ON "device_assets"("assetId");

ALTER TABLE "device_assets"
  ADD CONSTRAINT "device_assets_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "devices"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "device_assets"
  ADD CONSTRAINT "device_assets_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "assets"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve mobile backups made before Device was a first-class entity.
INSERT INTO "devices" ("id", "ownerId", "clientId", "name", "platform", "lastSeenAt", "createdAt", "updatedAt")
SELECT
  md5("ownerId"::text || ':' || "deviceId")::uuid,
  "ownerId",
  "deviceId",
  'Mobile device ' || right("deviceId", 4),
  '',
  max("updatedAt"),
  min("createdAt"),
  max("updatedAt")
FROM "assets"
WHERE "deviceId" IS NOT NULL
GROUP BY "ownerId", "deviceId";

INSERT INTO "device_assets" ("deviceId", "assetId", "deviceAssetId", "createdAt")
SELECT
  md5("ownerId"::text || ':' || "deviceId")::uuid,
  "id",
  "deviceAssetId",
  "createdAt"
FROM "assets"
WHERE "deviceId" IS NOT NULL AND "deviceAssetId" IS NOT NULL
ON CONFLICT ("deviceId", "deviceAssetId") DO NOTHING;
