-- Private, authenticated shares of individual photos and videos.
CREATE TABLE "asset_users" (
    "assetId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_users_pkey" PRIMARY KEY ("assetId", "userId")
);

CREATE INDEX "asset_users_userId_idx" ON "asset_users"("userId");

ALTER TABLE "asset_users"
  ADD CONSTRAINT "asset_users_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "assets"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "asset_users"
  ADD CONSTRAINT "asset_users_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
