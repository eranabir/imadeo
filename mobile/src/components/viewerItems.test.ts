import { describe, expect, it } from 'vitest';
import { withoutViewerItem } from './viewerItems';
describe('deleting inside either viewer', () => {
  const items = ['a', 'b', 'c'].map((id) => ({ id }));
  for (const [at, next] of [[0,'b'],[1,'c'],[2,'b']] as const) {
    it(`deleting index ${at} advances to ${next}`, () => {
      const result = withoutViewerItem(items, at, items[at].id);
      expect(result.items[result.index].id).toBe(next);
      expect(result.items).toHaveLength(2); expect(items).toHaveLength(3);
    });
  }
  it('closes only once the final item is removed', () => {
    let state = { items, index: 1 };
    while (state.items.length) {
      state = withoutViewerItem(state.items,state.index,state.items[state.index].id);
      if (state.items.length) expect(state.items[state.index]).toBeDefined();
    }
    expect(state.items).toEqual([]);
  });
  it('does not jump if another item is deleted', () => {
    const result=withoutViewerItem(items,2,'a'); expect(result.items[result.index].id).toBe('c');
  });
});
