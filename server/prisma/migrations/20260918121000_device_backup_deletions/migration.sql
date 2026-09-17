CREATE TABLE "device_backup_exclusions" (
  "ownerId" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "clientId" TEXT NOT NULL,
  "deviceAssetId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("ownerId", "clientId", "deviceAssetId")
);
INSERT INTO "device_backup_exclusions" ("ownerId", "clientId", "deviceAssetId")
SELECT a."ownerId", d."clientId", da."deviceAssetId"
FROM "device_assets" da JOIN "devices" d ON d.id = da."deviceId"
JOIN "assets" a ON a.id = da."assetId" WHERE a."deletedAt" IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO "device_backup_exclusions" ("ownerId", "clientId", "deviceAssetId")
SELECT "ownerId", "deviceId", "deviceAssetId" FROM "assets"
WHERE "deletedAt" IS NOT NULL AND "deviceId" IS NOT NULL AND "deviceAssetId" IS NOT NULL
ON CONFLICT DO NOTHING;
