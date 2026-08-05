-- Approximate-nearest-neighbour indexes for the two embedding columns.
-- Prisma cannot express these, so they are applied as a hand-written migration.
--
-- HNSW is chosen over IVFFlat because it needs no training pass and stays
-- accurate as rows are added one upload at a time. Both use cosine distance,
-- which is what the CLIP and InsightFace embeddings are normalised for.

CREATE INDEX IF NOT EXISTS "smart_search_embedding_idx"
  ON "smart_search"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS "asset_faces_embedding_idx"
  ON "asset_faces"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Trigram indexes backing the "search as you type" metadata queries.
CREATE INDEX IF NOT EXISTS "assets_original_file_name_trgm_idx"
  ON "assets" USING gin ("originalFileName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "people_name_trgm_idx"
  ON "people" USING gin ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "asset_exif_description_trgm_idx"
  ON "asset_exif" USING gin ("description" gin_trgm_ops);

-- The timeline is always "this user's non-deleted assets, newest first".
-- A partial index keeps trashed and vault rows out of the hot path.
CREATE INDEX IF NOT EXISTS "assets_timeline_idx"
  ON "assets" ("ownerId", "localDateTime" DESC)
  WHERE "deletedAt" IS NULL AND "visibility" = 'TIMELINE';
