-- Recognition reads the first trusted face in a group for every new detection.
-- Keep that lookup bounded even when a person appears in thousands of photos.
CREATE INDEX "asset_faces_personId_createdAt_idx"
ON "asset_faces"("personId", "createdAt");
