-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "cube";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "earthdistance";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('IMAGE', 'VIDEO', 'AUDIO', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetVisibility" AS ENUM ('TIMELINE', 'ARCHIVE', 'HIDDEN', 'LOCKED');

-- CreateEnum
CREATE TYPE "AlbumUserRole" AS ENUM ('VIEWER', 'EDITOR');

-- CreateEnum
CREATE TYPE "SharedLinkType" AS ENUM ('ALBUM', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'REMOVING', 'DELETED');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('MACHINE_LEARNING', 'EXIF', 'MANUAL');

-- CreateEnum
CREATE TYPE "Permission" AS ENUM ('READ', 'WRITE', 'ADMIN');

-- CreateEnum
CREATE TYPE "ReactionType" AS ENUM ('COMMENT', 'LIKE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password" TEXT NOT NULL DEFAULT '',
    "oauthId" TEXT NOT NULL DEFAULT '',
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "quotaSizeInBytes" BIGINT,
    "quotaUsageInBytes" BIGINT NOT NULL DEFAULT 0,
    "storageLabel" TEXT,
    "profileImagePath" TEXT NOT NULL DEFAULT '',
    "shouldChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "vaultPinHash" TEXT,
    "vaultWrappedKey" TEXT,
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "profileChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "deviceType" TEXT NOT NULL DEFAULT '',
    "deviceOS" TEXT NOT NULL DEFAULT '',
    "ipAddress" TEXT NOT NULL DEFAULT '',
    "vaultUnlockedUntil" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "permissions" "Permission"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partners" (
    "sharedById" UUID NOT NULL,
    "sharedWithId" UUID NOT NULL,
    "inTimeline" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("sharedById","sharedWithId")
);

-- CreateTable
CREATE TABLE "folders" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "parentId" UUID,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "type" "AssetType" NOT NULL,
    "originalPath" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "checksum" BYTEA NOT NULL,
    "fileSizeInByte" BIGINT NOT NULL DEFAULT 0,
    "thumbnailPath" TEXT,
    "previewPath" TEXT,
    "encodedVideoPath" TEXT,
    "thumbhash" BYTEA,
    "deviceAssetId" TEXT NOT NULL DEFAULT '',
    "deviceId" TEXT NOT NULL DEFAULT '',
    "fileCreatedAt" TIMESTAMP(3) NOT NULL,
    "fileModifiedAt" TIMESTAMP(3) NOT NULL,
    "localDateTime" TIMESTAMP(3) NOT NULL,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "visibility" "AssetVisibility" NOT NULL DEFAULT 'TIMELINE',
    "isOffline" BOOLEAN NOT NULL DEFAULT false,
    "isExternal" BOOLEAN NOT NULL DEFAULT false,
    "duration" TEXT,
    "livePhotoVideoId" UUID,
    "folderId" UUID,
    "stackId" UUID,
    "libraryId" UUID,
    "duplicateId" UUID,
    "duplicateResolvedAt" TIMESTAMP(3),
    "perceptualHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_exif" (
    "assetId" UUID NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "lensModel" TEXT,
    "exifImageWidth" INTEGER,
    "exifImageHeight" INTEGER,
    "orientation" TEXT,
    "dateTimeOriginal" TIMESTAMP(3),
    "modifyDate" TIMESTAMP(3),
    "timeZone" TEXT,
    "fNumber" DOUBLE PRECISION,
    "focalLength" DOUBLE PRECISION,
    "iso" INTEGER,
    "exposureTime" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "rating" INTEGER,
    "fps" DOUBLE PRECISION,
    "bitsPerSample" INTEGER,
    "colorspace" TEXT,
    "profileDescription" TEXT,
    "projectionType" TEXT,
    "autoStackId" TEXT,

    CONSTRAINT "asset_exif_pkey" PRIMARY KEY ("assetId")
);

-- CreateTable
CREATE TABLE "asset_job_status" (
    "assetId" UUID NOT NULL,
    "metadataExtractedAt" TIMESTAMP(3),
    "thumbnailAt" TIMESTAMP(3),
    "videoEncodedAt" TIMESTAMP(3),
    "smartSearchAt" TIMESTAMP(3),
    "facesRecognizedAt" TIMESTAMP(3),
    "duplicatesDetectedAt" TIMESTAMP(3),

    CONSTRAINT "asset_job_status_pkey" PRIMARY KEY ("assetId")
);

-- CreateTable
CREATE TABLE "smart_search" (
    "assetId" UUID NOT NULL,
    "embedding" vector(512) NOT NULL,

    CONSTRAINT "smart_search_pkey" PRIMARY KEY ("assetId")
);

-- CreateTable
CREATE TABLE "stacks" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "primaryAssetId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "albums" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "thumbnailAssetId" UUID,
    "folderId" UUID,
    "isActivityEnabled" BOOLEAN NOT NULL DEFAULT true,
    "order" TEXT NOT NULL DEFAULT 'desc',
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "albums_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "album_assets" (
    "albumId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "addedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "album_assets_pkey" PRIMARY KEY ("albumId","assetId")
);

-- CreateTable
CREATE TABLE "album_users" (
    "albumId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "AlbumUserRole" NOT NULL DEFAULT 'VIEWER',

    CONSTRAINT "album_users_pkey" PRIMARY KEY ("albumId","userId")
);

-- CreateTable
CREATE TABLE "shared_links" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "SharedLinkType" NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "password" TEXT,
    "expiresAt" TIMESTAMP(3),
    "allowUpload" BOOLEAN NOT NULL DEFAULT false,
    "allowDownload" BOOLEAN NOT NULL DEFAULT true,
    "showExif" BOOLEAN NOT NULL DEFAULT true,
    "slug" TEXT,
    "albumId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shared_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_link_assets" (
    "sharedLinkId" UUID NOT NULL,
    "assetId" UUID NOT NULL,

    CONSTRAINT "shared_link_assets_pkey" PRIMARY KEY ("sharedLinkId","assetId")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL,
    "albumId" UUID NOT NULL,
    "assetId" UUID,
    "userId" UUID NOT NULL,
    "type" "ReactionType" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "birthDate" DATE,
    "thumbnailPath" TEXT NOT NULL DEFAULT '',
    "faceAssetId" UUID,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_faces" (
    "id" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "personId" UUID,
    "boundingBoxX1" INTEGER NOT NULL,
    "boundingBoxY1" INTEGER NOT NULL,
    "boundingBoxX2" INTEGER NOT NULL,
    "boundingBoxY2" INTEGER NOT NULL,
    "imageWidth" INTEGER NOT NULL,
    "imageHeight" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "embedding" vector(512),
    "sourceType" "SourceType" NOT NULL DEFAULT 'MACHINE_LEARNING',
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_faces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "parentId" UUID,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag_assets" (
    "tagId" UUID NOT NULL,
    "assetId" UUID NOT NULL,

    CONSTRAINT "tag_assets_pkey" PRIMARY KEY ("tagId","assetId")
);

-- CreateTable
CREATE TABLE "memories" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'on_this_day',
    "data" JSONB NOT NULL,
    "memoryAt" TIMESTAMP(3) NOT NULL,
    "seenAt" TIMESTAMP(3),
    "isSaved" BOOLEAN NOT NULL DEFAULT false,
    "showAt" TIMESTAMP(3),
    "hideAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_assets" (
    "memoryId" UUID NOT NULL,
    "assetId" UUID NOT NULL,

    CONSTRAINT "memory_assets_pkey" PRIMARY KEY ("memoryId","assetId")
);

-- CreateTable
CREATE TABLE "libraries" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "importPaths" TEXT[],
    "exclusionPatterns" TEXT[],
    "refreshedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "libraries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_config" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "system_metadata" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "system_metadata_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "userId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "detail" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_storageLabel_key" ON "users"("storageLabel");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "api_keys_userId_idx" ON "api_keys"("userId");

-- CreateIndex
CREATE INDEX "folders_ownerId_path_idx" ON "folders"("ownerId", "path");

-- CreateIndex
CREATE INDEX "folders_parentId_idx" ON "folders"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "folders_ownerId_parentId_name_key" ON "folders"("ownerId", "parentId", "name");

-- CreateIndex
CREATE INDEX "assets_ownerId_localDateTime_idx" ON "assets"("ownerId", "localDateTime" DESC);

-- CreateIndex
CREATE INDEX "assets_ownerId_visibility_deletedAt_idx" ON "assets"("ownerId", "visibility", "deletedAt");

-- CreateIndex
CREATE INDEX "assets_ownerId_isFavorite_idx" ON "assets"("ownerId", "isFavorite");

-- CreateIndex
CREATE INDEX "assets_folderId_idx" ON "assets"("folderId");

-- CreateIndex
CREATE INDEX "assets_duplicateId_idx" ON "assets"("duplicateId");

-- CreateIndex
CREATE INDEX "assets_deletedAt_idx" ON "assets"("deletedAt");

-- CreateIndex
CREATE INDEX "assets_type_idx" ON "assets"("type");

-- CreateIndex
CREATE UNIQUE INDEX "assets_ownerId_checksum_key" ON "assets"("ownerId", "checksum");

-- CreateIndex
CREATE UNIQUE INDEX "assets_ownerId_deviceId_deviceAssetId_key" ON "assets"("ownerId", "deviceId", "deviceAssetId");

-- CreateIndex
CREATE INDEX "asset_exif_city_idx" ON "asset_exif"("city");

-- CreateIndex
CREATE INDEX "asset_exif_country_idx" ON "asset_exif"("country");

-- CreateIndex
CREATE INDEX "asset_exif_make_model_idx" ON "asset_exif"("make", "model");

-- CreateIndex
CREATE INDEX "asset_exif_latitude_longitude_idx" ON "asset_exif"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "stacks_ownerId_idx" ON "stacks"("ownerId");

-- CreateIndex
CREATE INDEX "albums_ownerId_idx" ON "albums"("ownerId");

-- CreateIndex
CREATE INDEX "albums_folderId_idx" ON "albums"("folderId");

-- CreateIndex
CREATE INDEX "album_assets_assetId_idx" ON "album_assets"("assetId");

-- CreateIndex
CREATE INDEX "album_users_userId_idx" ON "album_users"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "shared_links_key_key" ON "shared_links"("key");

-- CreateIndex
CREATE UNIQUE INDEX "shared_links_slug_key" ON "shared_links"("slug");

-- CreateIndex
CREATE INDEX "shared_links_userId_idx" ON "shared_links"("userId");

-- CreateIndex
CREATE INDEX "activities_albumId_assetId_idx" ON "activities"("albumId", "assetId");

-- CreateIndex
CREATE INDEX "people_ownerId_idx" ON "people"("ownerId");

-- CreateIndex
CREATE INDEX "asset_faces_assetId_idx" ON "asset_faces"("assetId");

-- CreateIndex
CREATE INDEX "asset_faces_personId_idx" ON "asset_faces"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "tags_ownerId_value_key" ON "tags"("ownerId", "value");

-- CreateIndex
CREATE INDEX "tag_assets_assetId_idx" ON "tag_assets"("assetId");

-- CreateIndex
CREATE INDEX "memories_ownerId_memoryAt_idx" ON "memories"("ownerId", "memoryAt");

-- CreateIndex
CREATE INDEX "libraries_ownerId_idx" ON "libraries"("ownerId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_sharedById_fkey" FOREIGN KEY ("sharedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_sharedWithId_fkey" FOREIGN KEY ("sharedWithId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folders" ADD CONSTRAINT "folders_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folders" ADD CONSTRAINT "folders_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_livePhotoVideoId_fkey" FOREIGN KEY ("livePhotoVideoId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_stackId_fkey" FOREIGN KEY ("stackId") REFERENCES "stacks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "libraries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_exif" ADD CONSTRAINT "asset_exif_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_job_status" ADD CONSTRAINT "asset_job_status_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "smart_search" ADD CONSTRAINT "smart_search_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stacks" ADD CONSTRAINT "stacks_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "albums" ADD CONSTRAINT "albums_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "albums" ADD CONSTRAINT "albums_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "album_assets" ADD CONSTRAINT "album_assets_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "albums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "album_assets" ADD CONSTRAINT "album_assets_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "album_users" ADD CONSTRAINT "album_users_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "albums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "album_users" ADD CONSTRAINT "album_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_links" ADD CONSTRAINT "shared_links_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_links" ADD CONSTRAINT "shared_links_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "albums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_link_assets" ADD CONSTRAINT "shared_link_assets_sharedLinkId_fkey" FOREIGN KEY ("sharedLinkId") REFERENCES "shared_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_link_assets" ADD CONSTRAINT "shared_link_assets_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "albums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_faces" ADD CONSTRAINT "asset_faces_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_faces" ADD CONSTRAINT "asset_faces_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag_assets" ADD CONSTRAINT "tag_assets_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag_assets" ADD CONSTRAINT "tag_assets_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_assets" ADD CONSTRAINT "memory_assets_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_assets" ADD CONSTRAINT "memory_assets_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "libraries" ADD CONSTRAINT "libraries_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
