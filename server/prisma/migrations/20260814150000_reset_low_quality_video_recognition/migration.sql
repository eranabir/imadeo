-- Video recognition originally accepted ordinary photo thresholds, which left
-- blurry and clipped one-off subjects behind. Remove only automatic video
-- detections and make those videos eligible for the stricter scanner.
DELETE FROM "asset_faces" f
USING "assets" a
WHERE f."assetId" = a.id
  AND a.type = 'VIDEO'
  AND f."sourceType" = 'MACHINE_LEARNING'
  AND f."isPinned" = false;

UPDATE "asset_job_status" s
SET "facesRecognizedAt" = NULL,
    "petsRecognizedAt" = NULL
FROM "assets" a
WHERE s."assetId" = a.id
  AND a.type = 'VIDEO';

DELETE FROM "people" p
WHERE p.name = ''
  AND NOT EXISTS (
    SELECT 1 FROM "asset_faces" f WHERE f."personId" = p.id
  );
