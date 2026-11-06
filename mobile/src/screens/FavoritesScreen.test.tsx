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
vi.mock('../components/Cards', () => ({
  FolderCard: (props: any) => React.createElement('FolderCard', props),
  AlbumCard: (props: any) => React.createElement('AlbumCard', props),
  Section: ({ children, ...props }: any) => React.createElement('Section', props, children),
}));
vi.mock('../components/BrowseTabs', () => ({ BrowseTabs: (props: any) => React.createElement('BrowseTabs', props) }));
vi.mock('../components/Account', () => ({ Account: () => null }));
vi.mock('../components/PhotoActions', () => ({ PhotoActions: (props: any) => React.createElement('PhotoActions', props) }));
vi.mock('../components/SelectionDock', () => ({ SelectionDock: () => null }));
vi.mock('../components/ui', () => ({ Sheet: () => null, SheetRow: () => null }));
vi.mock('../components/sheets', () => ({ ConfirmSheet: () => null, MoveSheet: () => null, PromptSheet: () => null, ShareSheet: () => null }));
vi.mock('./PlacesScreen', () => ({ PlacesBody: () => null }));
vi.mock('./SharingScreen', () => ({ SharingShelf: () => null }));

import { BrowseScreen } from './BrowseScreen';
import { FavoritesScreen } from './FavoritesScreen';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: ReactTestRenderer[] = [];
async function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(element); });
  mounted.push(tree);
  return tree;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.media.items = [{ id: 'favorite-photo', type: 'IMAGE', isFavorite: true }];
  mocks.media.pagination = { page: 1, size: 150, total: 301 };
  mocks.media.error = null;
});
afterEach(async () => {
  for (const tree of mounted.splice(0)) await act(async () => tree.unmount());
});

describe('Favorites collection', () => {
  it('is visible in Albums without user-created albums and opens its collection', async () => {
    const tree = await render(<BrowseScreen serverUrl="test" folderId={null} />);
    const tabs = tree.root.findByType('BrowseTabs' as any);
    expect(tabs.props.segments).toHaveLength(5);
    await act(async () => tabs.props.onChange('albums'));
    const favorites = tree.root.findAllByType('FolderCard' as any)
      .find(card => card.props.folder.name === 'Favorites');
    expect(favorites).toBeTruthy();
    expect(favorites!.props.folder.cardIcon).toBe('heart-filled');
    await act(async () => favorites!.props.onPress());
    expect(mocks.push).toHaveBeenCalledWith('/favorites');
    expect(tree.root.findByType('AssetGrid' as any).props.showEmptyState).toBe(false);
  });

  it('pages the server-filtered collection instead of filtering the first library page', async () => {
    const tree = await render(<FavoritesScreen serverUrl="test" onBack={vi.fn()} />);
    expect(mocks.paged).toHaveBeenCalledWith('test', '/assets?isFavorite=true&sortBy=date&order=desc');
    const grid = tree.root.findByType('AssetGrid' as any);
    expect(grid.props.assets).toEqual(mocks.media.items);
    expect(tree.root.findByType('Header' as any).props.subtitle).toBe('301 items');
    expect(grid.props.hasMore).toBe(true);
    await act(async () => grid.props.onLoadMore());
    expect(mocks.loadMore).toHaveBeenCalledOnce();
  });

  it('keeps the favorite predicate for every sort and reuses the list/grid control', async () => {
    const tree = await render(<FavoritesScreen serverUrl="test" onBack={vi.fn()} />);
    const sort = () => tree.root.findByType('MediaSortControl' as any);
    await act(async () => sort().props.onSort('type'));
    expect(mocks.paged).toHaveBeenLastCalledWith('test', '/assets?isFavorite=true&sortBy=type&order=asc');
    await act(async () => sort().props.onOrder('desc'));
    expect(mocks.paged).toHaveBeenLastCalledWith('test', '/assets?isFavorite=true&sortBy=type&order=desc');
    await act(async () => sort().props.onSort('name'));
    expect(mocks.paged).toHaveBeenLastCalledWith('test', '/assets?isFavorite=true&sortBy=name&order=asc');
    await act(async () => tree.root.findByType('HeaderAction' as any).props.onPress());
    expect(tree.root.findByType('AssetGrid' as any).props.viewMode).toBe('list');
    expect(tree.root.findByType('HeaderAction' as any).props.label).toBe('Show as grid');
  });

  it('clears selection and reloads after unfavoriting, with a useful empty collection', async () => {
    const tree = await render(<FavoritesScreen serverUrl="test" onBack={vi.fn()} />);
    const grid = () => tree.root.findByType('AssetGrid' as any);
    await act(async () => grid().props.onStartSelecting('favorite-photo'));
    const actions = tree.root.findByType('PhotoActions' as any);
    expect(actions.props.allFavorite).toBe(true);
    mocks.media.items = [];
    mocks.media.pagination = { page: 1, size: 150, total: 0 };
    await act(async () => actions.props.onDone());
    expect(mocks.reload).toHaveBeenCalledOnce();
    expect(grid().props.selected).toEqual([]);
    expect(grid().props.assets).toEqual([]);
    expect(grid().props.emptyTitle).toBe('No favorites yet');
    expect(grid().props.emptyBody).toContain('Tap the heart');
    await act(async () => grid().props.onChanged());
    await act(async () => grid().props.onRefresh());
    expect(mocks.reload).toHaveBeenCalledTimes(3);
  });

  it('shows a failed request as an error, with refresh available', async () => {
    mocks.media.error = 'Server unavailable';
    mocks.media.items = [];
    const tree = await render(<FavoritesScreen serverUrl="test" onBack={vi.fn()} />);
    const grid = tree.root.findByType('AssetGrid' as any);
    expect(grid.props.emptyTitle).toBe('Could not load favorites');
    expect(tree.root.findAllByType('Text' as any).some(text => text.props.children === 'Server unavailable')).toBe(true);
    await act(async () => grid.props.onRefresh());
    expect(mocks.reload).toHaveBeenCalledOnce();
  });
});
