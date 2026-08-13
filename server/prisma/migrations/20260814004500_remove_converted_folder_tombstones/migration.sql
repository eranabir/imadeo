-- Folder-to-album conversion used to soft-delete its empty source folder,
-- which exposed that implementation detail as a restorable Trash item.
-- A matching live album created within five seconds identifies conversion;
-- the dependency checks ensure no user data can be removed by this cleanup.
DELETE FROM folders AS folder
USING albums AS album
WHERE folder."deletedAt" IS NOT NULL
  AND album."ownerId" = folder."ownerId"
  AND album."folderId" IS NOT DISTINCT FROM folder."parentId"
  AND album.name = folder.name
  AND album."deletedAt" IS NULL
  AND ABS(EXTRACT(EPOCH FROM (folder."deletedAt" - album."createdAt"))) < 5
  AND NOT EXISTS (SELECT 1 FROM assets WHERE assets."folderId" = folder.id)
  AND NOT EXISTS (SELECT 1 FROM albums AS child_album WHERE child_album."folderId" = folder.id)
  AND NOT EXISTS (SELECT 1 FROM folders AS child_folder WHERE child_folder."parentId" = folder.id)
  AND NOT EXISTS (SELECT 1 FROM folder_users WHERE folder_users."folderId" = folder.id);
