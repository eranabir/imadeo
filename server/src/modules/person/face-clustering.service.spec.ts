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
        { personId: 'same-person', distance: 0.58 },
        { personId: 'other-person', distance: 0.67 },
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
        { personId: 'first-person', distance: 0.58 },
        { personId: 'second-person', distance: 0.59 },
      ]),
    };
    const service = new FaceClusteringService(prisma as never, config as never);

    await expect(service.findPerson('owner', [1], SubjectKind.PERSON)).resolves.toBeNull();
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
          return personCreated ? [{ personId: 'one-person', distance: 0 }] : [];
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
