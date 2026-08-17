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
});
