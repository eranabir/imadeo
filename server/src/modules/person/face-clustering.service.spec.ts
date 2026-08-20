import { describe, expect, it, vi } from 'vitest';
import { SubjectKind } from '../../db';
import { decideHumanCluster, FaceClusteringService } from './face-clustering.service';

const config = {
  get: vi.fn((key: string) => {
    if (key === 'machineLearning.faceClusterDistance') return 0.55;
    if (key === 'machineLearning.faceClusterRelaxedDistance') return 0.637;
    if (key === 'machineLearning.petClusterDistance') return 0.12;
    if (key === 'machineLearning.faceMinCount') return 3;
    throw new Error(`Unexpected config key ${key}`);
  }),
};

const neighbour = (
  faceId: string,
  distance: number,
  personId: string | null = null,
  assetId = faceId,
) => ({ faceId, personId, assetId, distance });

describe('decideHumanCluster', () => {
  it('uses repeated appearances to accept the same person at the relaxed distance', () => {
    const decision = decideHumanCluster(
      [
        neighbour('current', 0),
        neighbour('older-angle', 0.6, 'same-person'),
        neighbour('different-light', 0.62, 'same-person'),
      ],
      0.55,
      0.637,
      3,
    );

    expect(decision).toMatchObject({ personId: 'same-person', distance: 0.6, isCore: true });
  });

  it('establishes a new identity only from a dense group', () => {
    const dense = decideHumanCluster(
      [neighbour('one', 0), neighbour('two', 0.59), neighbour('three', 0.61)],
      0.55,
      0.637,
      3,
    );
    const isolated = decideHumanCluster(
      [neighbour('one', 0), neighbour('two', 0.59)],
      0.55,
      0.637,
      3,
    );

    expect(dense).toMatchObject({ personId: null, isCore: true });
    expect(dense.unassignedFaceIds).toEqual(['one', 'two', 'three']);
    expect(isolated).toMatchObject({ personId: null, isCore: false });
  });

  it('lets an isolated face join only through the strict distance', () => {
    const strict = decideHumanCluster(
      [neighbour('current', 0), neighbour('known', 0.5, 'known-person')],
      0.55,
      0.637,
      3,
    );
    const relaxed = decideHumanCluster(
      [neighbour('current', 0), neighbour('known', 0.59, 'known-person')],
      0.55,
      0.637,
      3,
    );

    expect(strict.personId).toBe('known-person');
    expect(relaxed.personId).toBeNull();
  });

  it('does not guess between two equally plausible existing people', () => {
    const decision = decideHumanCluster(
      [
        neighbour('current', 0),
        neighbour('first', 0.51, 'first-person'),
        neighbour('second', 0.53, 'second-person'),
      ],
      0.55,
      0.637,
      3,
    );

    expect(decision).toMatchObject({ personId: null, isCore: true, ambiguous: true });
  });
});

describe('FaceClusteringService', () => {
  it('counts distinct media and excludes explicitly detached faces', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      neighbour('current', 0),
      neighbour('known', 0.5, 'known-person'),
    ]);
    const service = new FaceClusteringService({ $queryRaw: queryRaw } as never, config as never);

    await expect(service.findPerson('owner', [1], SubjectKind.PERSON)).resolves.toEqual({
      personId: 'known-person',
      distance: 0.5,
    });

    const sql = (queryRaw.mock.calls[0][0] as TemplateStringsArray).join(' ');
    expect(sql).toContain('DISTINCT ON ("assetId")');
    expect(sql).toContain('(f."personId" IS NOT NULL OR f."isPinned" = false)');
  });

  it('creates one person and assigns every unassigned face in a dense group', async () => {
    const embedding = `[${Array.from({ length: 512 }, () => 0).join(',')}]`;
    const prisma = {
      asset: {
        findFirst: vi.fn().mockResolvedValue({ isDeviceOnly: false, visibility: 'TIMELINE' }),
      },
      assetFace: { updateMany: vi.fn().mockResolvedValue({ count: 3 }) },
      person: { create: vi.fn().mockResolvedValue({ id: 'new-person' }) },
      $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
        const sql = strings.join('');
        if (sql.includes('SELECT id, embedding::text')) {
          return [
            {
              id: 'current',
              embedding,
              kind: SubjectKind.PERSON,
              species: null,
            },
          ];
        }
        return [
          neighbour('current', 0),
          neighbour('same-one', 0.59),
          neighbour('same-two', 0.62),
        ];
      }),
    };
    const service = new FaceClusteringService(prisma as never, config as never);

    await expect(service.assignFacesForAsset('asset-a', 'owner')).resolves.toEqual(['new-person']);
    expect(prisma.person.create).toHaveBeenCalledTimes(1);
    expect(prisma.assetFace.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['current', 'same-one', 'same-two'] },
        personId: null,
        isPinned: false,
      },
      data: { personId: 'new-person' },
    });
  });

  it('leaves an isolated automatic face unassigned', async () => {
    const embedding = `[${Array.from({ length: 512 }, () => 0).join(',')}]`;
    const prisma = {
      asset: {
        findFirst: vi.fn().mockResolvedValue({ isDeviceOnly: false, visibility: 'TIMELINE' }),
      },
      assetFace: { updateMany: vi.fn() },
      person: { create: vi.fn() },
      $queryRaw: vi.fn(async (strings: TemplateStringsArray) =>
        strings.join('').includes('SELECT id, embedding::text')
          ? [{ id: 'current', embedding, kind: SubjectKind.PERSON, species: null }]
          : [neighbour('current', 0)],
      ),
    };
    const service = new FaceClusteringService(prisma as never, config as never);

    await expect(service.assignFacesForAsset('asset-a', 'owner')).resolves.toEqual([]);
    expect(prisma.person.create).not.toHaveBeenCalled();
    expect(prisma.assetFace.updateMany).not.toHaveBeenCalled();
  });

  it('rebuilds automatic assignments inside named groups while preserving an anchor', async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const service = new FaceClusteringService(
      {
        $executeRaw: executeRaw,
        asset: { findMany: vi.fn().mockResolvedValue([]) },
      } as never,
      config as never,
    );

    await service.recluster('owner');

    const anchorSql = (executeRaw.mock.calls[0][0] as TemplateStringsArray).join(' ');
    const detachSql = (executeRaw.mock.calls[1][0] as TemplateStringsArray).join(' ');
    expect(anchorSql).toContain('WITH needs_anchor');
    expect(anchorSql).toContain('p."thumbnailIsCustom" = true');
    expect(anchorSql).toContain('SET "isPinned" = true');
    expect(detachSql).toContain('f."personId" IS NOT NULL');
    expect(detachSql).not.toContain('p.name =');
  });

  it('serialises one owner so concurrent dense groups create one person', async () => {
    let personCreated = false;
    const embedding = `[${Array.from({ length: 512 }, () => 0).join(',')}]`;
    const prisma = {
      asset: {
        findFirst: vi.fn().mockResolvedValue({ isDeviceOnly: false, visibility: 'TIMELINE' }),
      },
      assetFace: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      person: {
        create: vi.fn(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          personCreated = true;
          return { id: 'one-person' };
        }),
      },
      $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join('');
        if (sql.includes('SELECT id, embedding::text')) {
          return [
            {
              id: `face-${String(values[0])}`,
              embedding,
              kind: SubjectKind.PERSON,
              species: null,
            },
          ];
        }
        const current = neighbour(`face-${String(values[1])}`, 0);
        return personCreated
          ? [current, neighbour('known', 0.2, 'one-person')]
          : [current, neighbour('same-one', 0.3), neighbour('same-two', 0.4)];
      }),
    };
    const service = new FaceClusteringService(prisma as never, config as never);

    await Promise.all([
      service.assignFacesForAsset('asset-a', 'owner'),
      service.assignFacesForAsset('asset-b', 'owner'),
    ]);

    expect(prisma.person.create).toHaveBeenCalledTimes(1);
    expect(prisma.assetFace.updateMany).toHaveBeenCalledTimes(2);
  });
});
