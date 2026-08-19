import { describe, expect, it, vi } from 'vitest';
import { SubjectKind } from '../../db';
import { FaceClusteringService } from './face-clustering.service';

const config = {
  get: vi.fn((key: string) => {
    if (key === 'machineLearning.faceClusterDistance') return 0.55;
    if (key === 'machineLearning.faceClusterRelaxedDistance') return 0.6;
    if (key === 'machineLearning.petClusterDistance') return 0.12;
    throw new Error(`Unexpected config key ${key}`);
  }),
};

describe('FaceClusteringService', () => {
  it('accepts an unambiguous relaxed face match', async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([
        { personId: 'same-person', distance: 0.58, centroidDistance: 0.45 },
        { personId: 'same-person', distance: 0.59, centroidDistance: 0.45 },
        { personId: 'other-person', distance: 0.67, centroidDistance: 0.5 },
      ]),
    };
    const service = new FaceClusteringService(prisma as never, config as never);

    await expect(service.findPerson('owner', [1], SubjectKind.PERSON)).resolves.toEqual({
      personId: 'same-person',
      distance: 0.58,
    });
  });

  it('rejects an ambiguous relaxed face match', async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([
        { personId: 'first-person', distance: 0.52, centroidDistance: 0.5 },
        { personId: 'second-person', distance: 0.53, centroidDistance: 0.51 },
      ]),
    };
    const service = new FaceClusteringService(prisma as never, config as never);

    await expect(service.findPerson('owner', [1], SubjectKind.PERSON)).resolves.toBeNull();
  });

  it('rejects nearest-face outliers from a large unrelated person', async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([
        { personId: 'large-person', distance: 0.41, centroidDistance: 0.66 },
        { personId: 'large-person', distance: 0.45, centroidDistance: 0.66 },
        { personId: 'large-person', distance: 0.49, centroidDistance: 0.66 },
      ]),
    };
    const service = new FaceClusteringService(prisma as never, config as never);

    await expect(service.findPerson('owner', [1], SubjectKind.PERSON)).resolves.toBeNull();
  });

  it('rejects a lone borderline match even when there is no runner-up', async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([
        { personId: 'borderline-person', distance: 0.58, centroidDistance: 0.5 },
      ]),
    };
    const service = new FaceClusteringService(prisma as never, config as never);

    await expect(service.findPerson('owner', [1], SubjectKind.PERSON)).resolves.toBeNull();
  });

  it('uses stable identity anchors instead of averaging the whole cluster', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      { personId: 'confirmed-person', distance: 0.3, centroidDistance: 0.25 },
    ]);
    const service = new FaceClusteringService(
      { $queryRaw: queryRaw } as never,
      config as never,
    );

    await service.findPerson('owner', [1], SubjectKind.PERSON);

    const sql = (queryRaw.mock.calls[0][0] as TemplateStringsArray).join(' ');
    expect(sql).toContain('p."thumbnailIsCustom"');
    expect(sql).toContain('AVG(pinned.embedding)');
    expect(sql).toContain('ORDER BY seed."createdAt" ASC');
    expect(sql).not.toContain('AVG(f.embedding)');
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

  it('serialises one owner so concurrent assets create one group', async () => {
    let personCreated = false;
    const embedding = `[${Array.from({ length: 512 }, () => 0).join(',')}]`;
    const prisma = {
      asset: { findFirst: vi.fn().mockResolvedValue({ isDeviceOnly: false, visibility: 'TIMELINE' }) },
      assetFace: { update: vi.fn().mockResolvedValue({}) },
      person: {
        create: vi.fn(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          personCreated = true;
          return { id: 'one-person' };
        }),
      },
      $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join('');
        if (sql.includes('JOIN assets')) {
          return personCreated
            ? [{ personId: 'one-person', distance: 0, centroidDistance: 0 }]
            : [];
        }
        return [
          {
            id: `face-${String(values[0])}`,
            embedding,
            kind: SubjectKind.PERSON,
            species: null,
          },
        ];
      }),
    };
    const service = new FaceClusteringService(prisma as never, config as never);

    await Promise.all([
      service.assignFacesForAsset('asset-a', 'owner'),
      service.assignFacesForAsset('asset-b', 'owner'),
    ]);

    expect(prisma.person.create).toHaveBeenCalledTimes(1);
    expect(prisma.assetFace.update).toHaveBeenCalledTimes(2);
  });
});
