import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { SubjectKind } from '../../db';
import { PrismaService } from '../../infra/prisma/prisma.service';

interface Candidate {
  personId: string;
  distance: number;
}

/**
 * Groups face embeddings into people.
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

  /**
   * Finds the person a face belongs to, or null when it looks like someone new.
   *
   * Uses the *k nearest* assigned faces rather than the single closest one. A
   * lone near-match is often a bad crop or a sibling; requiring that the
   * majority of the closest neighbours agree makes wrong merges much rarer,
   * which matters because a wrong merge is tedious for a person to undo.
   */
  async findPerson(
    ownerId: string,
    embedding: number[],
    kind: SubjectKind = SubjectKind.PERSON,
  ): Promise<Candidate | null> {
    const vector = `[${embedding.join(',')}]`;

    const neighbours = await this.prisma.$queryRaw<{ personId: string; distance: number }[]>`
      SELECT f."personId", (f.embedding <=> ${vector}::vector) AS distance
      FROM asset_faces f
      JOIN assets a ON a.id = f."assetId"
      WHERE a."ownerId" = ${ownerId}::uuid
        -- Trashed photos may be restored with their existing grouping, but
        -- must not teach a newly uploaded photo who it is. Otherwise a new
        -- dog can inherit the name and group of a dog that only exists in
        -- Trash.
        AND a."deletedAt" IS NULL
        AND f."personId" IS NOT NULL
        AND f."deletedAt" IS NULL
        AND f.embedding IS NOT NULL
        -- Faces and pets come from different models, so their embeddings live in
        -- unrelated spaces. Comparing across them is meaningless, and would let
        -- a dog be grouped with whoever is holding it.
        AND f.kind = ${kind}::"SubjectKind"
      ORDER BY f.embedding <=> ${vector}::vector
      LIMIT 9
    `;

    // Appearance is a blunter signal than face geometry, so pets need to look
    // markedly more alike before they are called the same animal.
    const threshold = kind === SubjectKind.PET ? this.petThreshold : this.threshold;
    const withinThreshold = neighbours.filter((n) => n.distance <= threshold);
    if (withinThreshold.length === 0) return null;

    // Vote by count, breaking ties on the closest single face.
    const tally = new Map<string, { votes: number; best: number }>();
    for (const neighbour of withinThreshold) {
      const entry = tally.get(neighbour.personId) ?? { votes: 0, best: Number.POSITIVE_INFINITY };
      entry.votes += 1;
      entry.best = Math.min(entry.best, neighbour.distance);
      tally.set(neighbour.personId, entry);
    }

    const [personId, winner] = [...tally.entries()].sort(
      (a, b) => b[1].votes - a[1].votes || a[1].best - b[1].best,
    )[0];

    return { personId, distance: winner.best };
  }

  /**
   * Assigns every unassigned face for an asset, creating people as needed.
   * Returns the people this asset ended up touching.
   */
  async assignFacesForAsset(assetId: string, ownerId: string): Promise<string[]> {
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

      const match = await this.findPerson(ownerId, embedding, face.kind);

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
   * Needed after the threshold is changed, or to tidy up a library where people
   * were split across several groups early on when there was little to compare
   * against. Manually named or pinned faces are left alone.
   */
  async recluster(ownerId: string) {
    this.logger.log(`Re-clustering faces for ${ownerId}`);

    // Detach everything that was grouped automatically, keeping human decisions.
    await this.prisma.$executeRaw`
      UPDATE asset_faces f
      SET "personId" = NULL
      FROM assets a
      WHERE f."assetId" = a.id
        AND a."ownerId" = ${ownerId}::uuid
        AND f."isPinned" = false
        AND f."personId" IN (
          SELECT id FROM people WHERE "ownerId" = ${ownerId}::uuid AND name = ''
        )
    `;

    // Drop the now-empty unnamed people.
    await this.prisma.$executeRaw`
      DELETE FROM people p
      WHERE p."ownerId" = ${ownerId}::uuid
        AND p.name = ''
        AND NOT EXISTS (SELECT 1 FROM asset_faces f WHERE f."personId" = p.id)
    `;

    const assets = await this.prisma.asset.findMany({
      where: { ownerId, deletedAt: null, faces: { some: { personId: null, deletedAt: null } } },
      select: { id: true },
      orderBy: { localDateTime: 'asc' },
    });

    let assigned = 0;
    for (const asset of assets) {
      assigned += (await this.assignFacesForAsset(asset.id, ownerId)).length;
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
}
