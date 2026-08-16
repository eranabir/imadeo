import { describe, expect, it, vi } from 'vitest';
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
