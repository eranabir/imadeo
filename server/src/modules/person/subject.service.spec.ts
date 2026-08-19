import { describe, expect, it, vi } from 'vitest';
import { SourceType, SubjectKind } from '../../db';
import { SubjectService } from './subject.service';

describe('SubjectService.list', () => {
  it('returns every detected group without a hidden server-side cap', async () => {
    const rows = Array.from({ length: 620 }, (_, index) => ({
      id: `subject-${index}`,
      name: '',
      birthDate: null,
      thumbnailPath: '',
      isHidden: false,
      isFavorite: false,
      kind: 'PERSON',
      species: null,
      thumbnailUpdatedAt: new Date(),
      faceCount: 1n,
    }));
    const queryRaw = vi.fn().mockResolvedValue(rows);
    const service = new SubjectService(
      { $queryRaw: queryRaw } as never,
      {} as never,
      {} as never,
      { get: vi.fn().mockReturnValue(3) } as never,
    );

    const result = await service.list('owner-id', { minFaces: 1 });
    const sql = (queryRaw.mock.calls[0][0] as TemplateStringsArray).join(' ');

    expect(result).toHaveLength(620);
    expect(sql).not.toContain('LIMIT');
  });
});

describe('SubjectService.getAssets', () => {
  it('returns a bounded page and the total number of pages', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'asset-101' }]);
    const count = vi.fn().mockResolvedValue(275);
    const service = new SubjectService(
      { asset: { findMany, count } } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    vi.spyOn(service, 'get').mockResolvedValue({ id: 'subject-id' } as never);

    await expect(service.getAssets('owner-id', 'subject-id', 2, 100)).resolves.toEqual({
      items: [{ id: 'asset-101' }],
      pagination: { page: 2, size: 100, total: 275, pages: 3 },
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 100, take: 100 }),
    );
  });
});

describe('SubjectService classification corrections', () => {
  it('removes pet species from the subject and its detections when moved to People', async () => {
    const personUpdate = vi.fn().mockResolvedValue({
      id: 'subject-id',
      kind: SubjectKind.PERSON,
      species: null,
    });
    const faceUpdateMany = vi.fn().mockResolvedValue({ count: 2 });
    const transaction = vi.fn(async (work) =>
      work({ person: { update: personUpdate }, assetFace: { updateMany: faceUpdateMany } }),
    );
    const service = new SubjectService(
      { $transaction: transaction } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    vi.spyOn(service, 'get').mockResolvedValue({ id: 'subject-id' } as never);

    await service.update('owner-id', 'subject-id', { kind: SubjectKind.PERSON });

    expect(personUpdate).toHaveBeenCalledWith({
      where: { id: 'subject-id' },
      data: expect.objectContaining({ kind: SubjectKind.PERSON, species: null }),
    });
    expect(faceUpdateMany).toHaveBeenCalledWith({
      where: { personId: 'subject-id' },
      data: { kind: SubjectKind.PERSON, species: null },
    });
  });

  it('pins the current representative when a group is named', async () => {
    const faceFindFirst = vi.fn().mockResolvedValue({ id: 'cover-face' });
    const faceUpdate = vi.fn().mockResolvedValue({});
    const transaction = vi.fn(async (work) =>
      work({
        person: { update: vi.fn().mockResolvedValue({ id: 'subject-id', name: 'Eran' }) },
        assetFace: { findFirst: faceFindFirst, update: faceUpdate },
      }),
    );
    const service = new SubjectService(
      { $transaction: transaction } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    vi.spyOn(service, 'get').mockResolvedValue({
      id: 'subject-id',
      faceAssetId: 'cover-asset',
    } as never);

    await service.update('owner-id', 'subject-id', { name: 'Eran' });

    expect(faceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ assetId: 'cover-asset', personId: 'subject-id' }),
      }),
    );
    expect(faceUpdate).toHaveBeenCalledWith({
      where: { id: 'cover-face' },
      data: { isPinned: true },
    });
  });

  it('moves exact detections to the selected person and clears their pet species', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const service = new SubjectService(
      { assetFace: { updateMany } } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    vi.spyOn(service, 'get').mockResolvedValue({
      id: 'target-id',
      kind: SubjectKind.PERSON,
      species: null,
    } as never);

    await expect(
      service.reassignFaces('owner-id', ['face-id'], 'target-id'),
    ).resolves.toEqual({ reassigned: 1 });

    expect(updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: { in: ['face-id'] } }),
      data: {
        personId: 'target-id',
        kind: SubjectKind.PERSON,
        species: null,
        isPinned: true,
        sourceType: SourceType.MANUAL,
      },
    });
  });

  it('does not guess which face belongs to a person in an ambiguous photo', async () => {
    const faceUpdate = vi.fn();
    const faceCreate = vi.fn().mockResolvedValue({});
    const service = new SubjectService(
      {
        asset: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'asset-id',
              exif: { exifImageWidth: 1200, exifImageHeight: 800 },
              faces: [
                { id: 'face-a', kind: SubjectKind.PERSON, personId: null },
                { id: 'face-b', kind: SubjectKind.PERSON, personId: null },
              ],
            },
          ]),
        },
        assetFace: { update: faceUpdate, create: faceCreate },
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    vi.spyOn(service, 'get').mockResolvedValue({
      id: 'target-id',
      kind: SubjectKind.PERSON,
      species: null,
    } as never);

    await expect(service.attachAssets('owner-id', 'target-id', ['asset-id'])).resolves.toEqual({
      moved: 0,
      created: 1,
      total: 1,
    });
    expect(faceUpdate).not.toHaveBeenCalled();
    expect(faceCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assetId: 'asset-id',
        personId: 'target-id',
        sourceType: SourceType.MANUAL,
        isPinned: true,
      }),
    });
  });

  it('moves the detected face when a photo contains exactly one candidate', async () => {
    const faceUpdate = vi.fn().mockResolvedValue({});
    const faceCreate = vi.fn();
    const service = new SubjectService(
      {
        asset: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'asset-id',
              exif: null,
              faces: [{ id: 'only-face', kind: SubjectKind.PERSON, personId: null }],
            },
          ]),
        },
        assetFace: { update: faceUpdate, create: faceCreate },
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    vi.spyOn(service, 'get').mockResolvedValue({
      id: 'target-id',
      kind: SubjectKind.PERSON,
      species: null,
    } as never);

    await expect(service.attachAssets('owner-id', 'target-id', ['asset-id'])).resolves.toEqual({
      moved: 1,
      created: 0,
      total: 1,
    });
    expect(faceUpdate).toHaveBeenCalledWith({
      where: { id: 'only-face' },
      data: {
        personId: 'target-id',
        isPinned: true,
        sourceType: SourceType.MANUAL,
      },
    });
    expect(faceCreate).not.toHaveBeenCalled();
  });
});
