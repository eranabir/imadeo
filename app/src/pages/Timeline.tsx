import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Images } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AssetViewer } from '../components/AssetViewer';
import { JustifiedGrid } from '../components/JustifiedGrid';
import { InfiniteScrollSentinel } from '../components/InfiniteScrollSentinel';
import { SelectionBar } from '../components/SelectionBar';
import { TimelineScrubber } from '../components/TimelineScrubber';
import { useLibraryActions } from '../components/useLibraryActions';
import { api } from '../lib/api';
import { useInfiniteAssets } from '../lib/useInfiniteAssets';
import { formatDate, groupByDay } from '../lib/format';
import { useSelection } from '../lib/useSelection';
import { useAuth } from '../store/auth';
import type { Asset } from '../types';
import { EmptyState, GridSkeleton, IconButton, Select, SelectionCheck, Tooltip } from '../ui';

export function PhotosPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [viewing, setViewing] = useState<Asset | null>(null);
  const { selected, toggle, selectRange, setAnchor, clear, setSelected } = useSelection<Asset>();

  /** Takes or releases a whole day at once from its date heading. */
  const toggleDay = (items: Asset[], on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const item of items) {
        if (on) next.add(item.id);
        else next.delete(item.id);
      }
      return next;
    });
  // Kept in the URL so the upload panel can link straight to "recently added"
  // after it finishes, and so the choice survives a refresh.
  const [params, setParams] = useSearchParams();
  const sortBy = (params.get('sort') ?? 'date') as 'date' | 'added' | 'name' | 'size';
  const setSortBy = (next: string) => {
    if (next === 'date') params.delete('sort');
    else params.set('sort', next);
    setParams(params, { replace: true });
  };
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');

  const library = useInfiniteAssets(['assets', 'timeline', sortBy, order], {
    sortBy,
    order,
  });
  const pages = library.data?.pages ?? [];
  const assets = pages.flatMap((page) => page.items);
  const total = pages[0]?.pagination.total ?? 0;

  /*
   * The old request used `size: 500`, so photo 501 silently did not exist in
   * the timeline. Pages arrive as the end of the mounted grid nears instead.
   */
  const isLoading = library.isLoading;

  const groups = sortBy === 'date' ? groupByDay(assets) : [{ day: '', items: assets }];
  const actions = useLibraryActions({ onShowDetails: setViewing, selectedIds: [...selected] });

  const afterChange = () => {
    clear();
    return queryClient.invalidateQueries();
  };

  const favorite = useMutation({
    mutationFn: async (ids: string[]) =>
      (await api.put('/assets/bulk', { ids, isFavorite: true })).data,
    onSuccess: afterChange,
  });

  const trash = useMutation({
    mutationFn: async (ids: string[]) => (await api.delete('/assets', { data: { ids } })).data,
    onSuccess: afterChange,
  });

  return (
    /**
     * The rail is a flex sibling of everything else, including the header, so
     * its sticky box starts at the very top of the scroll area. Nested below the
     * header it could not rise past its parent's top edge, so it sat one header
     * lower until the first scroll and then jumped up — it appeared to move with
     * the page.
     */
    <div className="min-h-full">
      <div className="flex min-h-full">
      <div className="min-w-0 flex-1">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-border-subtle/60 bg-surface/80 px-5 py-3 backdrop-blur-xl">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Photos</h1>
          <span className="text-xs text-content-muted tabular-nums">
            {pages.length ? `${total.toLocaleString()} items` : ''}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <Select
            size="sm"
            prefix="Sort by"
            value={sortBy}
            onChange={setSortBy}
            options={[
              { value: 'date', label: 'Date taken', hint: 'When the photo was captured' },
              // Without this, a freshly uploaded old photo files itself by
              // capture date — possibly pages down — and looks like it never
              // arrived. This is the "where did my upload go?" answer.
              { value: 'added', label: 'Recently added', hint: 'When it was uploaded here' },
              { value: 'name', label: 'File name', hint: 'Alphabetical' },
              { value: 'size', label: 'File size', hint: 'Largest or smallest first' },
            ]}
          />
          <Tooltip label={order === 'asc' ? 'Oldest first' : 'Newest first'}>
            <IconButton
              label={order === 'asc' ? 'Oldest first' : 'Newest first'}
              variant="secondary"
              size="sm"
              round={false}
              onClick={() => setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}
            >
              {order === 'asc' ? (
                <ArrowUpNarrowWide size={15} />
              ) : (
                <ArrowDownWideNarrow size={15} />
              )}
            </IconButton>
          </Tooltip>
        </div>
      </header>

      {isLoading && <GridSkeleton />}

      {!isLoading && assets.length === 0 && (
        <EmptyState
          icon={Images}
          title="No photos yet"
          description="Upload photos and videos, or pick a whole folder to bring its structure across."
        />
      )}

      {/* The rail reserves its own column rather than overlaying, so it never
          covers a photo at the right-hand edge. */}
        <div className="px-2 pb-24 pt-4">
        {groups.map(({ day, items }) => {
          const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));

          return (
          <section
            key={day || 'all'}
            data-section={day || 'all'}
            className="mb-4 group/day last:min-h-[calc(100vh-8rem)]"
          >
            {/* Sticks below the page header rather than under it. The offset was
                53px, less than the header's real height, so a date slid up
                against the bottom edge with nothing between them. The negative
                margin cancels the pill's own padding, so the row starts on the
                same left edge as the photos below it — the check first, matching
                where the check sits on each photo. */}
            {day && (
              <h2 className="group/head sticky top-[65px] z-10 mb-0.5 -ml-3 flex w-fit items-center rounded-full bg-surface/85 px-3 py-1 text-[15px] font-semibold backdrop-blur">
                {/* Collapses to nothing when idle rather than merely fading, so
                    the date sits flush with the left edge of its photos; the
                    check then opens and pushes the date across. Kept open once
                    the day is taken, or there would be no way to see what is
                    selected.

                    `:has(img:hover)` rather than a plain group hover: a section
                    is a full-width block, so hovering the empty space beside a
                    short row counted as hovering the day. Keyed to the images,
                    it only appears over an actual photo — plus over the heading
                    itself, or the check would vanish on the way to clicking it. */}
                <span
                  className={clsx(
                    'shrink-0 overflow-hidden transition-all',
                    allSelected
                      ? 'w-8 opacity-100'
                      : 'w-0 opacity-0 focus-within:w-8 focus-within:opacity-100 group-hover/head:w-8 group-hover/head:opacity-100 group-[:has(img:hover)]/day:w-8 group-[:has(img:hover)]/day:opacity-100',
                  )}
                >
                  <SelectionCheck
                    checked={allSelected}
                    onChange={(on) => toggleDay(items, on)}
                    label={`${allSelected ? 'Deselect' : 'Select'} the ${items.length} photos from ${formatDate(day, user?.preferences.locale)}`}
                  />
                </span>
                {formatDate(day, user?.preferences.locale)}
              </h2>
            )}
            <JustifiedGrid
              assets={items}
              selected={selected}
              targetRowHeight={user?.preferences.tileSize ?? 220}
              onOpen={setViewing}
              onToggleSelect={toggle}
              onSelectRange={(a) => selectRange(a, assets)}
              onAnchor={setAnchor}
              onContextMenu={actions.onAssetContextMenu}
            />
          </section>
          );
        })}
        <InfiniteScrollSentinel
          enabled={Boolean(library.hasNextPage)}
          loading={library.isFetchingNextPage}
          onVisible={() => void library.fetchNextPage()}
        />
        </div>
      </div>

      {/* Only meaningful when the groups are dates — sorting by name or size
          leaves nothing for a date rail to point at. */}
      {sortBy === 'date' && groups.length > 1 && (
        <TimelineScrubber
          sections={groups.map(({ day, items }) => ({
            id: day,
            label: formatDate(day, user?.preferences.locale),
            count: items.length,
          }))}
        />
      )}
      </div>

      {actions.overlays}

      <SelectionBar
        count={selected.size}
        onClear={clear}
        onFavorite={() => favorite.mutate([...selected])}
        onDownload={() => {
          window.location.href = `/api/assets/download/archive?ids=${[...selected].join(',')}`;
        }}
        onTrash={() => trash.mutate([...selected])}
      />

      {viewing && (
        <AssetViewer
          asset={viewing}
          assets={assets}
          onClose={() => setViewing(null)}
          onNavigate={setViewing}
        />
      )}
    </div>
  );
}
