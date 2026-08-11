CREATE TABLE "folder_users" (
    "folderId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "folder_users_pkey" PRIMARY KEY ("folderId", "userId")
);

CREATE INDEX "folder_users_userId_idx" ON "folder_users"("userId");

ALTER TABLE "folder_users"
  ADD CONSTRAINT "folder_users_folderId_fkey"
  FOREIGN KEY ("folderId") REFERENCES "folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "folder_users"
  ADD CONSTRAINT "folder_users_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
