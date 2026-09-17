ALTER TABLE "sessions" ADD COLUMN "previousTokenHash" TEXT,
  ADD COLUMN "refreshRequestId" TEXT,
  ADD COLUMN "native" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "sessions_previousTokenHash_key" ON "sessions"("previousTokenHash");
