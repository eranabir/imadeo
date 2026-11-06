import { describe, expect, it } from 'vitest';
import { sortContainers } from './containerSort';
const rows = [
  { id: 'b', name: 'Folder 10', createdAt: '2026-01-01' },
  { id: 'a', name: 'Folder 2', createdAt: '2026-02-01' },
];
describe('folder and album sorting', () => {
  it('sorts names naturally in either direction without mutating the response', () => {
    expect(sortContainers(rows, 'name', 'asc').map(r => r.id)).toEqual(['a', 'b']);
    expect(sortContainers(rows, 'name', 'desc').map(r => r.id)).toEqual(['b', 'a']);
    expect(rows.map(r => r.id)).toEqual(['b', 'a']);
  });
  it('uses container creation dates rather than names', () => {
    expect(sortContainers(rows, 'date', 'asc').map(r => r.id)).toEqual(['b', 'a']);
    expect(sortContainers(rows, 'date', 'desc').map(r => r.id)).toEqual(['a', 'b']);
  });
  it('sorts within an existing type section by name and handles missing dates', () => {
    expect(sortContainers(rows, 'type', 'asc').map(r => r.id)).toEqual(['a', 'b']);
    expect(sortContainers(rows.map(({ createdAt, ...row }) => row), 'date', 'asc').map(r => r.id)).toEqual(['a', 'b']);
  });
});
