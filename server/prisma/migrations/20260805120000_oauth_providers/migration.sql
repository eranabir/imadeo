-- Link accounts to an external identity provider (Google, Apple).

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "oauthProvider" TEXT,
ALTER COLUMN "oauthId" DROP NOT NULL,
ALTER COLUMN "oauthId" DROP DEFAULT;

-- Rows created before this migration carry the old '' default. They are local
-- password accounts, so normalise them to NULL: Postgres treats NULLs as
-- distinct, which is what lets the unique index below coexist with any number
-- of non-OAuth users.
UPDATE "users" SET "oauthId" = NULL WHERE "oauthId" = '';

-- CreateIndex
CREATE UNIQUE INDEX "users_oauthProvider_oauthId_key" ON "users"("oauthProvider", "oauthId");
