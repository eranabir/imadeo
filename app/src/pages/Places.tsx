import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, MapPin } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AssetViewer } from '../components/AssetViewer';
import { JustifiedGrid } from '../components/JustifiedGrid';
import { PhotoMap, type MapPin as Pin } from '../components/PhotoMap';
import { api } from '../lib/api';
import { formatDate, groupByDay } from '../lib/format';
import { useAuth } from '../store/auth';
import { EmptyState, GridSkeleton, IconButton } from '../ui';
import type { Asset, Paginated } from '../types';

interface Place {
  city: string | null;
  state: string | null;
  country: string | null;
  count: number;
  coverAssetId: string;
  latitude: number | null;
  longitude: number | null;
}

/** "Holon, Israel" — the district in between is noise at this size. */
const nameOf = (place: Place) => [place.city, place.country].filter(Boolean).join(', ') || 'Somewhere';

/**
 * Where the photos were taken.
 *
 * The map and the list are both here rather than a choice between them, because
 * they answer different questions. The map is how a trip is remembered — these
 * three towns were the same week — and the list is how one is found again,
 * ordered by how much was taken there. Neither ordering can be read off the
 * other.
 *
 * With a `:city` in the route the same page becomes that town's photos, which
 * keeps the back button meaning "back to the map".
 */
export function Places() {
  const { city } = useParams();
  return city ? <OnePlace city={decodeURIComponent(city)} /> : <AllPlaces />;
}

function AllPlaces() {
  const navigate = useNavigate();

  const { data: places, isLoading } = useQuery({
    queryKey: ['assets', 'places'],
    queryFn: async () => (await api.get<Place[]>('/assets/places')).data,
  });

  // Stable across renders so the marker effect does not tear down and rebuild
  // every pin each time this component re-renders.
  const open = useCallback(
    (name: string) => navigate(`/places/${encodeURIComponent(name)}`),
    [navigate],
  );

  const list = places ?? [];

  // The pins are the places themselves: a place without coordinates — the
  // geocoder knew the name but not where to put it — simply has no pin, and is
  // still reachable from the card below.
  // Memoised on the query's own result rather than on `list`, which is a fresh
  // array on every render while the request is in flight — that would rebuild
  // every marker each time this component rendered.
  const pins = useMemo<Pin[]>(
    () =>
      (places ?? []).flatMap((place) =>
        place.city && place.latitude !== null && place.longitude !== null
          ? [
              {
                city: place.city,
                count: place.count,
                latitude: place.latitude,
                longitude: place.longitude,
              },
            ]
          : [],
      ),
    [places],
  );

  return (
    <div className="min-h-full">
      <Bar title="Places" count={isLoading ? null : list.length} unit="place" />

      {!isLoading && list.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title="No photos with a location"
          description="A photo carries coordinates only when the camera was allowed to record them. Anything that does will show up here, on the map and below it."
        />
      ) : (
        <div className="px-5 pb-24 pt-4">
          <div className="overflow-hidden rounded-panel border border-border-subtle/60 bg-surface-sunken">
            <PhotoMap pins={pins} onSelect={open} className="h-[min(64vh,660px)] w-full" />
          </div>

          {isLoading ? (
            <div className="mt-6">
              <GridSkeleton />
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
              {list.map((place) => (
                <Link
                  key={nameOf(place)}
                  to={`/places/${encodeURIComponent(place.city ?? '')}`}
                  className="group relative aspect-[4/3] overflow-hidden rounded-panel border border-border-subtle/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <img
                    src={`/api/assets/${place.coverAssetId}/thumbnail`}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  {/* The name sits on the picture rather than under it: a caption
                      line adds a third to the height of every card for two
                      words, and the gradient keeps it readable over a bright
                      sky as well as a dark one. */}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-3 pt-8">
                    <p className="truncate text-sm font-semibold text-white">{nameOf(place)}</p>
                    <p className="text-xs tabular-nums text-white/70">
                      {place.count.toLocaleString()} {place.count === 1 ? 'photo' : 'photos'}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OnePlace({ city }: { city: string }) {
  const { user } = useAuth();
  const [viewing, setViewing] = useState<Asset | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['assets', 'city', city],
    queryFn: async () =>
      (await api.get<Paginated<Asset>>('/assets', { params: { city, size: 500 } })).data,
  });

  const assets = data?.items ?? [];

  return (
    <div className="min-h-full">
      <Bar title={city} count={isLoading ? null : assets.length} unit="photo" back />

      {!isLoading && assets.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title="Nothing here"
          description={`No photos are recorded as taken in ${city}.`}
        />
      ) : (
        <div className="px-2 pb-24 pt-2">
          {groupByDay(assets).map(({ day, items }) => (
            <section key={day} className="mb-4">
              <h2 className="sticky top-[53px] z-10 mb-1.5 w-fit rounded-full bg-surface/85 px-3 py-1 text-[13px] font-medium backdrop-blur">
                {formatDate(day, user?.preferences.locale)}
              </h2>
              <JustifiedGrid
                assets={items}
                targetRowHeight={user?.preferences.tileSize ?? 220}
                onOpen={setViewing}
              />
            </section>
          ))}
        </div>
      )}

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

function Bar({
  title,
  count,
  unit,
  back,
}: {
  title: string;
  count: number | null;
  unit: string;
  back?: boolean;
}) {
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-20 flex items-baseline gap-3 border-b border-border-subtle/60 bg-surface/80 px-5 py-3 backdrop-blur-xl">
      {back && (
        <IconButton label="Back to places" size="sm" onClick={() => navigate('/places')}>
          <ArrowLeft size={18} />
        </IconButton>
      )}
      <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
      <span className="shrink-0 text-xs tabular-nums text-content-muted">
        {count === null ? '' : `${count.toLocaleString()} ${count === 1 ? unit : `${unit}s`}`}
      </span>
    </header>
  );
}
