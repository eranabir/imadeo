import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  paged: vi.fn(),
  reload: vi.fn(),
  loadMore: vi.fn(),
  media: { items: [] as any[], pagination: { page: 1, size: 150, total: 0 }, error: null as string | null },
}));
vi.mock('react-native', () => ({ View: 'View', Text: 'Text', Platform: { OS: 'ios', isPad: false }, Alert: { alert: vi.fn() } }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('../lib/api', () => ({
  usePagedResource: (server: string, path: string | null) => {
    mocks.paged(server, path);
    return { ...mocks.media, token: 'token', loading: false, loadingMore: false,
      hasMore: true, reload: mocks.reload, loadMore: mocks.loadMore };
  },
  useResource: (_server: string, path: string | null) => ({
    data: path === '/albums' ? [] : null, token: 'token', loading: false, error: null, reload: mocks.reload,
  }),
}));
vi.mock('../lib/viewMode', () => ({ useMediaViewMode: () => React.useState<'grid' | 'list'>('grid') }));
vi.mock('../lib/actions', () => ({ actions: {} }));
vi.mock('../components/AssetGrid', () => ({
  AssetGrid: (props: any) => React.createElement('AssetGrid', props, props.header),
  useSelection: () => {
    const [ids, setIds] = React.useState<string[]>([]);
    return { ids, clear: () => setIds([]), start: (id: string) => setIds([id]),
      toggle: (id: string) => setIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]),
      toggleMany: vi.fn() };
  },
}));
vi.mock('../components/Header', () => ({
  Header: ({ children, ...props }: any) => React.createElement('Header', props, props.action, children),
  HeaderAction: (props: any) => React.createElement('HeaderAction', props),
  useHeaderClearance: (extra = 0) => 100 + extra,
}));
vi.mock('../components/MediaSort', () => ({
  MEDIA_SORT_HEIGHT: 48,
  MediaSortControl: (props: any) => React.createElement('MediaSortControl', props),
}));
vi.mock('../components/Icon', () => ({ Icon: 'Icon' }));
vi.mock('../components/PhotoActions', () => ({ PhotoActions: (props: any) => React.createElement('PhotoActions', props) }));
vi.mock('../components/SelectionDock', () => ({ SelectionDock: () => null }));
import { SubjectScreen } from './SubjectScreen';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: ReactTestRenderer[] = [];
afterEach(async () => { for (const tree of mounted.splice(0)) await act(async () => tree.unmount()); });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.media.items = [{ id: 'photo', faces: [{ id: 'this-person-face' }] }];
});

describe('Person and pet photo sorting', () => {
  it.each(['PERSON', 'PET'] as const)('sorts the complete %s collection through paged API requests', async (kind) => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<SubjectScreen serverUrl="test" subjectId="subject" title="Alex" kind={kind} species={null} onBack={vi.fn()} />);
    });
    mounted.push(tree);
    const sort = () => tree.root.findByType('MediaSortControl' as any);
    const grid = () => tree.root.findByType('AssetGrid' as any);
    expect(mocks.paged).toHaveBeenLastCalledWith('test', '/people-and-pets/subject/assets?sortBy=date&order=desc');
    expect(grid().props.topInset).toBe(148);
    await act(async () => grid().props.onStartSelecting('photo'));
    expect(tree.root.findByType('PhotoActions' as any).props.assignmentFaceIds).toEqual(['this-person-face']);
    await act(async () => sort().props.onSort('name'));
    expect(mocks.paged).toHaveBeenLastCalledWith('test', '/people-and-pets/subject/assets?sortBy=name&order=asc');
    expect(grid().props.selected).toEqual([]);
    await act(async () => sort().props.onOrder('desc'));
    expect(mocks.paged).toHaveBeenLastCalledWith('test', '/people-and-pets/subject/assets?sortBy=name&order=desc');
    await act(async () => sort().props.onSort('type'));
    expect(mocks.paged).toHaveBeenLastCalledWith('test', '/people-and-pets/subject/assets?sortBy=type&order=asc');
    await act(async () => sort().props.onSort('date'));
    expect(mocks.paged).toHaveBeenLastCalledWith('test', '/people-and-pets/subject/assets?sortBy=date&order=desc');
    await act(async () => grid().props.onLoadMore());
    expect(mocks.loadMore).toHaveBeenCalledOnce();
  });
});
