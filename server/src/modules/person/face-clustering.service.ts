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

interface Neighbour {
  faceId: string;
  personId: string | null;
  assetId: string;
  distance: number;
}

interface HumanClusterDecision {
  personId: string | null;
  distance: number | null;
  isCore: boolean;
  ambiguous: boolean;
  unassignedFaceIds: string[];
}

interface PersonVotes {
  personId: string;
  strictVotes: number;
  totalVotes: number;
  bestDistance: number;
  averageDistance: number;
}

/**
 * Density-based identity decision, kept pure so its precision/recall rules are
 * covered without a database fixture.
 *
 * Existing identities grow only when several independent photos agree, or one
 * face is exceptionally close. New identities are seeded exclusively from
 * strict neighbours. Relaxed neighbours may vote for an established identity,
 * but are never bulk-assigned; that prevents a single bridge face from folding
 * two families into one group.
 */
export function decideHumanCluster(
  neighbours: Neighbour[],
  strictDistance: number,
  maxDistance: number,
  minFaces: number,
): HumanClusterDecision {
  const nearby = neighbours.filter(
    (neighbour) => Number.isFinite(neighbour.distance) && neighbour.distance <= maxDistance,
  );
  const requiredVotes = Math.max(1, minFaces);
  const strictUnassigned = nearby.filter(
    (neighbour) => neighbour.personId === null && neighbour.distance <= strictDistance,
  );
  const isCore = strictUnassigned.length >= requiredVotes;

  const votesByPerson = new Map<string, number[]>();
  for (const neighbour of nearby) {
    if (!neighbour.personId) continue;
    const distances = votesByPerson.get(neighbour.personId) ?? [];
    distances.push(neighbour.distance);
    votesByPerson.set(neighbour.personId, distances);
  }

  const veryCloseDistance = strictDistance * 0.75;
  const relaxedAverageLimit = (strictDistance + maxDistance) / 2;
  const candidates: PersonVotes[] = [...votesByPerson.entries()]
    .map(([personId, distances]) => ({
      personId,
      strictVotes: distances.filter((distance) => distance <= strictDistance).length,
      totalVotes: distances.length,
      bestDistance: Math.min(...distances),
      averageDistance: distances.reduce((sum, distance) => sum + distance, 0) / distances.length,
    }))
    .filter(
      (candidate) =>
        candidate.bestDistance <= veryCloseDistance ||
        candidate.strictVotes >= 2 ||
        (candidate.totalVotes >= requiredVotes &&
          candidate.averageDistance <= relaxedAverageLimit),
    )
    .sort(
      (a, b) =>
        b.strictVotes - a.strictVotes ||
        b.totalVotes - a.totalVotes ||
        a.averageDistance - b.averageDistance ||
        a.bestDistance - b.bestDistance,
    );
  const winner = candidates[0];
  const runnerUp = candidates[1];

  // Matching evidence that is effectively tied is deliberately left
  // unassigned. A later photo can resolve it; a silent merge is destructive.
  const ambiguous = Boolean(
    winner &&
      runnerUp &&
      winner.strictVotes === runnerUp.strictVotes &&
      winner.totalVotes === runnerUp.totalVotes &&
      Math.abs(winner.averageDistance - runnerUp.averageDistance) < 0.04,
  );

  return {
    personId: winner && !ambiguous ? winner.personId : null,
    distance: winner && !ambiguous ? winner.bestDistance : null,
    isCore,
    ambiguous,
    unassignedFaceIds: strictUnassigned.map((neighbour) => neighbour.faceId),
  };
}

/**
 * Groups recognition embeddings into people and pets.
 *
 * Human faces use incremental density clustering derived from DBSCAN. A person
 * is created only when several distinct media items agree; isolated detections
 * remain available for a later upload to complete the group. This makes the
 * result independent of which one photo happened to finish processing first.
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

  private get minFaces() {
    return this.config.get('machineLearning.faceMinCount', { infer: true });
  }

  /**
   * Finds the person a face belongs to, or null when it looks like someone new.
   *
   * Uses nearest faces from distinct media. Repeated appearances form a dense
   * identity core; an isolated face can join an existing person only through
   * the stricter distance.
   */
  async findPerson(
    ownerId: string,
    embedding: number[],
    kind: SubjectKind = SubjectKind.PERSON,
    deviceOnly = false,
    species: string | null = null,
  ): Promise<Candidate | null> {
    if (kind === SubjectKind.PET && !species) return null;
    const neighbours = await this.findNeighbours(ownerId, embedding, kind, deviceOnly, species);

    // Appearance is a blunter signal than face geometry, so pets need to look
    // markedly more alike before they are called the same animal.
    if (kind === SubjectKind.PERSON) {
      const decision = decideHumanCluster(
        neighbours,
        this.threshold,
        this.relaxedFaceThreshold,
        this.minFaces,
      );
      return decision.personId && decision.distance !== null
        ? { personId: decision.personId, distance: decision.distance }
        : null;
    }

    const withinThreshold = neighbours.filter(
      (neighbour) => neighbour.personId && neighbour.distance <= this.petThreshold,
    );
    if (withinThreshold.length === 0) return null;

    // Vote by count, breaking ties on the closest single face.
    const tally = new Map<string, { votes: number; best: number }>();
    for (const neighbour of withinThreshold) {
      const personId = neighbour.personId!;
      const entry = tally.get(personId) ?? { votes: 0, best: Number.POSITIVE_INFINITY };
      entry.votes += 1;
      entry.best = Math.min(entry.best, neighbour.distance);
      tally.set(personId, entry);
    }

    const ranked = [...tally.entries()].sort(
      (a, b) => b[1].votes - a[1].votes || a[1].best - b[1].best,
    );
    const [personId, winner] = ranked[0];
    return { personId, distance: winner.best };
  }

  /** Nearest detections, with one vote per media item. */
  private async findNeighbours(
    ownerId: string,
    embedding: number[],
    kind: SubjectKind,
    deviceOnly: boolean,
    species: string | null = null,
  ) {
    const vector = `[${embedding.join(',')}]`;
    const maxDistance =
      kind === SubjectKind.PET ? this.petThreshold : this.relaxedFaceThreshold;
    const limit = Math.max(60, this.minFaces * 20);

    return this.prisma.$queryRaw<Neighbour[]>`
      WITH nearest AS MATERIALIZED (
        SELECT
          f.id AS "faceId",
          f."personId",
          f."assetId",
          (f.embedding <=> ${vector}::vector) AS distance
        FROM asset_faces f
        JOIN assets a ON a.id = f."assetId"
        WHERE a."ownerId" = ${ownerId}::uuid
          ${deviceOnly
            ? Prisma.sql`AND a."deletedAt" IS NULL AND a."isDeviceOnly" = true`
            : MAIN_LIBRARY_ASSET_SQL}
          AND f."deletedAt" IS NULL
          AND f.embedding IS NOT NULL
          AND f.kind = ${kind}::"SubjectKind"
          ${kind === SubjectKind.PET
            ? Prisma.sql`
                AND f.species = ${species}
                AND (
                  f."personId" IS NULL
                  OR EXISTS (
                    SELECT 1
                    FROM people pet_group
                    WHERE pet_group.id = f."personId"
                      AND pet_group.species = ${species}
                  )
                )
              `
            : Prisma.empty}
          -- A face explicitly detached by the user is pinned with no person.
          -- It must not seed or extend another automatic group.
          AND (f."personId" IS NOT NULL OR f."isPinned" = false)
        ORDER BY f.embedding <=> ${vector}::vector
        LIMIT ${limit}
      ), nearest_per_asset AS (
        -- Twenty similar frames from one video are one appearance, not twenty
        -- independent votes that can create a person by themselves.
        SELECT DISTINCT ON ("assetId")
          "faceId", "personId", "assetId", distance
        FROM nearest
        ORDER BY "assetId", distance
      )
      SELECT "faceId", "personId", "assetId", distance
      FROM nearest_per_asset
      WHERE distance <= ${maxDistance}
      ORDER BY distance
    `;
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

      if (face.kind === SubjectKind.PERSON) {
        const neighbours = await this.findNeighbours(
          ownerId,
          embedding,
          face.kind,
          asset.isDeviceOnly,
        );
        const decision = decideHumanCluster(
          neighbours,
          this.threshold,
          this.relaxedFaceThreshold,
          this.minFaces,
        );

        // Outliers stay unassigned. A later upload can turn them into a dense
        // group without manufacturing hundreds of one-photo people meanwhile.
        if (decision.ambiguous || (!decision.personId && !decision.isCore)) continue;

        const personId =
          decision.personId ??
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

        // Existing identities receive only the face being evaluated. Bulk
        // assignment is safe solely while creating a new strict core.
        const faceIds = decision.personId
          ? [face.id]
          : [...new Set([face.id, ...decision.unassignedFaceIds])];
        await this.prisma.assetFace.updateMany({
          where: { id: { in: faceIds }, personId: null, isPinned: false },
          data: { personId },
        });
        touched.add(personId);
        continue;
      }

      const match = await this.findPerson(
        ownerId,
        embedding,
        face.kind,
        asset.isDeviceOnly,
        face.species,
      );

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
