-- A folder in Trash must not reserve its old name. Re-uploading that path
-- creates a new active folder while the deleted hierarchy stays restorable.
DROP INDEX IF EXISTS "folders_ownerId_parentId_name_key";

CREATE UNIQUE INDEX "folders_ownerId_parentId_name_active_key"
ON "folders"("ownerId", "parentId", "name")
WHERE "deletedAt" IS NULL;
