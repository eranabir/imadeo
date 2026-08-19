import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { MAIN_LIBRARY_ASSET_SQL, mainLibraryAssetWhere } from '../../common/asset-scope';
import { Prisma, SubjectKind } from '../../db';
import { PrismaService } from '../../infra/prisma/prisma.service';

interface Candidate {
  personId: string;
  distance: number;
}

interface Neighbour extends Candidate {
  centroidDistance: number;
}

/**
 * Groups recognition embeddings into people and pets.
 *
 * The approach is incremental nearest-neighbour rather than a batch algorithm
 * like DBSCAN: each new face is compared against faces already assigned to a
 * person and joins the closest one within a distance threshold, or starts a new
 * person. That matters because photos arrive one at a time — a batch clusterer
 * would have to re-run over the whole library after every upload.
 *
 * The comparison is cosine distance in pgvector (`<=>`), which the HNSW index on
 * `asset_faces.embedding` serves directly.
 */
@Injectable()
export class FaceClusteringService {
  private readonly logger = new Logger(FaceClusteringService.name);
  private readonly ownerLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private get threshold() {
    return this.config.get('machineLearning.faceClusterDistance', { infer: true });
  }

  private get petThreshold() {
    return this.config.get('machineLearning.petClusterDistance', { infer: true });
  }

  private get relaxedFaceThreshold() {
    return this.config.get('machineLearning.faceClusterRelaxedDistance', { infer: true });
  }

  /**
   * Finds the person a face belongs to, or null when it looks like someone new.
   *
   * Uses nearest faces from distinct media together with each subject's
   * centroid. A lone near-match is often a bad crop or the statistical outlier
   * of a very large library; requiring both local and whole-cluster agreement
   * keeps that face from silently contaminating an established person.
   */
  async findPerson(
    ownerId: string,
    embedding: number[],
    kind: SubjectKind = SubjectKind.PERSON,
    deviceOnly = false,
  ): Promise<Candidate | null> {
    const vector = `[${embedding.join(',')}]`;

    const neighbours = await this.prisma.$queryRaw<Neighbour[]>`
      WITH nearest AS MATERIALIZED (
        SELECT
          f."personId",
          f."assetId",
          (f.embedding <=> ${vector}::vector) AS distance
        FROM asset_faces f
        JOIN assets a ON a.id = f."assetId"
        WHERE a."ownerId" = ${ownerId}::uuid
          ${deviceOnly
            ? Prisma.sql`AND a."deletedAt" IS NULL AND a."isDeviceOnly" = true`
            : MAIN_LIBRARY_ASSET_SQL}
          AND f."personId" IS NOT NULL
          AND f."deletedAt" IS NULL
          AND f.embedding IS NOT NULL
          -- Faces and pets come from different models, so their embeddings live in
          -- unrelated spaces. Comparing across them is meaningless, and would let
          -- a dog be grouped with whoever is holding it.
          AND f.kind = ${kind}::"SubjectKind"
        ORDER BY f.embedding <=> ${vector}::vector
        LIMIT 60
      ), nearest_per_asset AS (
        -- Video sampling can produce many nearly identical frames. One video
        -- must count as one piece of evidence rather than sixty votes.
        SELECT DISTINCT ON ("personId", "assetId")
          "personId", "assetId", distance
        FROM nearest
        ORDER BY "personId", "assetId", distance
      ), ranked AS (
        SELECT
          "personId",
          distance,
          ROW_NUMBER() OVER (PARTITION BY "personId" ORDER BY distance) AS rank
        FROM nearest_per_asset
      ), candidate_people AS (
        SELECT DISTINCT "personId" FROM nearest
      ), centroids AS (
        -- A stable anchor prevents single-link chaining: an unrelated face may
        -- resemble one outlier, but it must also resemble the identity's origin.
        -- Custom covers are strongest, followed by explicit corrections, then
        -- the first face that created an automatic group. Scalar subqueries let
        -- PostgreSQL stop at the first available source instead of averaging a
        -- ten-thousand-face cluster for every new detection.
        SELECT
          candidate."personId",
          COALESCE(
            (
              SELECT AVG(custom.embedding)
              FROM asset_faces custom
              JOIN assets a ON a.id = custom."assetId"
              WHERE custom."personId" = candidate."personId"
                AND p."thumbnailIsCustom" = true
                AND custom."assetId" = p."faceAssetId"
                ${deviceOnly
                  ? Prisma.sql`AND a."deletedAt" IS NULL AND a."isDeviceOnly" = true`
                  : MAIN_LIBRARY_ASSET_SQL}
                AND custom."deletedAt" IS NULL
                AND custom.embedding IS NOT NULL
            ),
            (
              SELECT AVG(pinned.embedding)
              FROM asset_faces pinned
              JOIN assets a ON a.id = pinned."assetId"
              WHERE pinned."personId" = candidate."personId"
                AND pinned."isPinned" = true
                ${deviceOnly
                  ? Prisma.sql`AND a."deletedAt" IS NULL AND a."isDeviceOnly" = true`
                  : MAIN_LIBRARY_ASSET_SQL}
                AND pinned."deletedAt" IS NULL
                AND pinned.embedding IS NOT NULL
            ),
            (
              SELECT seed.embedding
              FROM asset_faces seed
              JOIN assets a ON a.id = seed."assetId"
              WHERE seed."personId" = candidate."personId"
                ${deviceOnly
                  ? Prisma.sql`AND a."deletedAt" IS NULL AND a."isDeviceOnly" = true`
                  : MAIN_LIBRARY_ASSET_SQL}
                AND seed."deletedAt" IS NULL
                AND seed.embedding IS NOT NULL
              ORDER BY seed."createdAt" ASC
              LIMIT 1
            )
          ) AS centroid
        FROM candidate_people candidate
        JOIN people p ON p.id = candidate."personId"
      )
      SELECT
        ranked."personId",
        ranked.distance,
        (centroids.centroid <=> ${vector}::vector) AS "centroidDistance"
      FROM ranked
      JOIN centroids ON centroids."personId" = ranked."personId" AND centroids.centroid IS NOT NULL
      WHERE ranked.rank <= 3
      ORDER BY ranked.distance
    `;

    // Appearance is a blunter signal than face geometry, so pets need to look
    // markedly more alike before they are called the same animal.
    const threshold =
      kind === SubjectKind.PET
        ? this.petThreshold
        : Math.max(this.threshold, this.relaxedFaceThreshold);
    const withinThreshold = neighbours.filter((n) => n.distance <= threshold);
    if (withinThreshold.length === 0) return null;

    // Vote by count, breaking ties on the closest single face.
    const tally = new Map<string, { votes: number; best: number; centroid: number }>();
    for (const neighbour of withinThreshold) {
      const entry = tally.get(neighbour.personId) ?? {
        votes: 0,
        best: Number.POSITIVE_INFINITY,
        centroid: neighbour.centroidDistance,
      };
      entry.votes += 1;
      entry.best = Math.min(entry.best, neighbour.distance);
      entry.centroid = Math.min(entry.centroid, neighbour.centroidDistance);
      tally.set(neighbour.personId, entry);
    }

    const eligible = [...tally.entries()].filter(([, candidate]) =>
      kind === SubjectKind.PET || candidate.centroid <= this.threshold,
    );
    if (eligible.length === 0) return null;

    const score = ({ best, centroid }: { best: number; centroid: number }) =>
      (best + centroid) / 2;
    const ranked = eligible.sort(
      (a, b) => score(a[1]) - score(b[1]) || b[1].votes - a[1].votes,
    );
    const [personId, winner] = ranked[0];

    if (kind === SubjectKind.PERSON) {
      // A relaxed match needs agreement from separate photos; one borderline
      // crop is deliberately split because a false split is easy to merge and
      // a false merge silently corrupts an established person.
      if (winner.best > this.threshold && winner.votes < 2) return null;

      const runnerUp = ranked[1]?.[1];
      if (runnerUp && score(runnerUp) - score(winner) < 0.04) return null;
    }

    return { personId, distance: winner.best };
  }

  /**
   * Assigns every unassigned detection for an asset, creating subjects as needed.
   * Returns the subjects this asset ended up touching.
   */
  async assignFacesForAsset(assetId: string, ownerId: string): Promise<string[]> {
    return this.withOwnerLock(ownerId, () => this.assignFacesForAssetUnlocked(assetId, ownerId));
  }

  private async assignFacesForAssetUnlocked(assetId: string, ownerId: string): Promise<string[]> {
    const asset = await this.prisma.asset.findFirst({
      where: { id: assetId, ownerId, deletedAt: null },
      select: { isDeviceOnly: true, visibility: true },
    });
    if (!asset || asset.visibility === 'HIDDEN' || asset.visibility === 'LOCKED') return [];

    const faces = await this.prisma.$queryRaw<
      { id: string; embedding: string; kind: SubjectKind; species: string | null }[]
    >`
      SELECT id, embedding::text AS embedding, kind, species
      FROM asset_faces
      WHERE "assetId" = ${assetId}::uuid
        AND "personId" IS NULL
        AND "deletedAt" IS NULL
        AND embedding IS NOT NULL
        AND "isPinned" = false
      ORDER BY score DESC
    `;

    const touched = new Set<string>();

    for (const face of faces) {
      const embedding = this.parseVector(face.embedding);
      if (embedding.length !== 512) continue;

      const match = await this.findPerson(ownerId, embedding, face.kind, asset.isDeviceOnly);

      const personId =
        match?.personId ??
        (
          await this.prisma.person.create({
            data: {
              ownerId,
              name: '',
              faceAssetId: assetId,
              kind: face.kind,
              species: face.species,
            },
            select: { id: true },
          })
        ).id;

      await this.prisma.assetFace.update({ where: { id: face.id }, data: { personId } });
      touched.add(personId);
    }

    return [...touched];
  }

  /**
   * Re-runs clustering across a whole library.
   *
   * Needed after the threshold is changed, or to tidy up a library where subjects
   * were split across several groups early on when there was little to compare
   * against. Pinned identity anchors are left alone; every automatic assignment
   * is rebuilt, including faces inside named groups.
   */
  async recluster(ownerId: string) {
    return this.withOwnerLock(ownerId, () => this.reclusterUnlocked(ownerId));
  }

  private async reclusterUnlocked(ownerId: string) {
    this.logger.log(`Re-clustering faces for ${ownerId}`);

    // Older named groups predate explicit anchors. Preserve one representative
    // before rebuilding so their names remain connected to the identity the user
    // saw. A chosen/current cover is preferred, then a clear still-image face.
    await this.prisma.$executeRaw`
      WITH needs_anchor AS (
        SELECT p.id, p."faceAssetId"
        FROM people p
        WHERE p."ownerId" = ${ownerId}::uuid
          AND p.name <> ''
          AND (
            p."thumbnailIsCustom" = true
            OR NOT EXISTS (
              SELECT 1
              FROM asset_faces pinned
              WHERE pinned."personId" = p.id
                AND pinned."isPinned" = true
                AND pinned."deletedAt" IS NULL
                AND pinned.embedding IS NOT NULL
            )
          )
      ), anchors AS (
        SELECT needs_anchor.id AS "personId", candidate.id AS "faceId"
        FROM needs_anchor
        CROSS JOIN LATERAL (
          SELECT f.id
          FROM asset_faces f
          JOIN assets a ON a.id = f."assetId"
          WHERE f."personId" = needs_anchor.id
            ${MAIN_LIBRARY_ASSET_SQL}
            AND f."deletedAt" IS NULL
            AND f.embedding IS NOT NULL
          ORDER BY
            (f."assetId" = needs_anchor."faceAssetId") DESC NULLS LAST,
            (f."sourceTimecodeMs" IS NULL) DESC,
            f.score DESC,
            f."createdAt" ASC
          LIMIT 1
        ) candidate
      )
      UPDATE asset_faces f
      SET "isPinned" = true
      FROM anchors
      WHERE f.id = anchors."faceId"
    `;

    // Detach every automatic assignment. Restricting this to unnamed groups
    // made a named cluster a permanent sink: once one stranger joined it, even a
    // full rescan retained the stranger and used them to recruit more faces.
    await this.prisma.$executeRaw`
      UPDATE asset_faces f
      SET "personId" = NULL
      FROM assets a
      WHERE f."assetId" = a.id
        AND a."ownerId" = ${ownerId}::uuid
        ${MAIN_LIBRARY_ASSET_SQL}
        AND f."isPinned" = false
        AND f."personId" IS NOT NULL
    `;

    // Drop the now-empty unnamed subjects.
    await this.prisma.$executeRaw`
      DELETE FROM people p
      WHERE p."ownerId" = ${ownerId}::uuid
        AND p.name = ''
        AND NOT EXISTS (SELECT 1 FROM asset_faces f WHERE f."personId" = p.id)
    `;

    const assets = await this.prisma.asset.findMany({
      where: {
        ...mainLibraryAssetWhere(ownerId),
        faces: { some: { personId: null, deletedAt: null } },
      },
      select: { id: true },
      orderBy: { localDateTime: 'asc' },
    });

    let assigned = 0;
    for (const asset of assets) {
      assigned += (await this.assignFacesForAssetUnlocked(asset.id, ownerId)).length;
    }

    this.logger.log(`Re-clustering touched ${assets.length} assets`);
    return { assets: assets.length, groups: assigned };
  }

  /** pgvector returns `[0.1,0.2,...]` as text. */
  private parseVector(value: string): number[] {
    return value
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map(Number);
  }

  /** Recognition workers may finish together. Serialising one owner's writes
   * closes the find-none/create-two race without blocking other accounts. */
  private async withOwnerLock<T>(ownerId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.ownerLocks.get(ownerId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.ownerLocks.set(ownerId, current);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.ownerLocks.get(ownerId) === current) this.ownerLocks.delete(ownerId);
    }
  }
}
