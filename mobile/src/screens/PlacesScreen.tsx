import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { Empty } from '../components/AssetGrid';
import { Icon } from '../components/Icon';
import { Loading } from '../components/Loading';
import { Touchable } from '../components/ui';
import { thumbnail, useResource } from '../lib/api';
import { resolvedDark } from '../lib/preferences';
import { frameOf, mapStyleJson } from '../lib/mapstyle';
import { useRouter } from 'expo-router';
import { colors, radius, shadow, TAB_BAR_CLEARANCE } from '../theme';

interface Place {
  city: string | null;
  state: string | null;
  country: string | null;
  count: number;
  coverAssetId: string;
  latitude: number | null;
  longitude: number | null;
}

interface Pin {
  city: string;
  title: string;
  count: number;
  latitude: number;
  longitude: number;
}

/**
 * MapLibre is native code, so it exists only in a build that compiled it in.
 *
 * Loaded through a guarded `require` rather than an import because the module
 * asserts its native side is present the moment it is evaluated — under a
 * client that lacks it the assertion is thrown before React has rendered
 * anything, and the whole app dies with it, not just this screen. Absent, the
 * places themselves still list; only the map goes missing.
 */
const maplibre = (() => {
  try {
    return require('@maplibre/maplibre-react-native') as typeof import('@maplibre/maplibre-react-native');
  } catch {
    return null;
  }
})();

/** Below this a pin shows only its count; above it, the place name too. */
const LABEL_ZOOM = 5;

/** "Holon, Israel" — the district in between is noise at this size. */
const nameOf = (place: Place) =>
  [place.city, place.country].filter(Boolean).join(', ') || 'Somewhere';

/**
 * Where the photos were taken: a map, and the places under it.
 *
 * Both, rather than a choice between them, because they answer different
 * questions. The map is how a trip is remembered — these three towns were the
 * same week — and the list is how one is found again, ordered by how much was
 * taken there. Neither ordering can be read off the other.
 *
 * Rendered inside the Browse tab rather than as a screen of its own: it is one
 * more way of looking at what is on the server, alongside Photos, Folders and
 * Albums, and it shares their header.
 */
export function PlacesBody({ serverUrl, topInset }: { serverUrl: string; topInset: number }) {
  const router = useRouter();
  const { width } = useWindowDimensions();

  const places = useResource<Place[]>(serverUrl, '/assets/places');

  const list = places.data ?? [];

  /**
   * One pin per place — not one per photo.
   *
   * A dot per photo puts thirty identical dots on the same rooftop, so the map
   * says nothing about where the pictures actually are, and the thing you are
   * trying to press is four millimetres wide. A place without coordinates —
   * the geocoder knew the name but not where to put it — simply has no pin, and
   * is still reachable from the cover below.
   *
   * Sorted smallest first so that where pins overlap, the one drawn on top is
   * the one with the most photos in it.
   */
  const markers = useMemo(
    () =>
      list
        .flatMap((place) =>
          place.city && place.latitude !== null && place.longitude !== null
            ? [
                {
                  city: place.city,
                  title: nameOf(place),
                  count: place.count,
                  latitude: place.latitude,
                  longitude: place.longitude,
                },
              ]
            : [],
        )
        .sort((a, b) => a.count - b.count),
    [list],
  );

  const frame = useMemo(() => frameOf(markers), [markers]);

  const size = Math.floor((width - 16 * 2 - 12) / 2);
  const loading = places.loading;

  if (loading && list.length === 0) {
    return (
      <View style={{ paddingTop: topInset }}>
        <Loading label="Finding your places…" />
      </View>
    );
  }

  if (list.length === 0) {
    return (
      <View style={{ paddingTop: topInset }}>
        <Empty
          icon="pin"
          title="No photos with a location"
          body="A photo carries coordinates only when the camera was allowed to record them. Anything that does will show up here."
        />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={{ paddingTop: topInset, paddingBottom: TAB_BAR_CLEARANCE }}
    >
      <View
        style={[
          {
            height: 320,
            marginTop: 14,
            marginHorizontal: 16,
            borderRadius: radius.lg,
            overflow: 'hidden',
            backgroundColor: colors.surface,
          },
          shadow(1),
        ]}
      >
        <MapOf
          markers={markers}
          frame={frame}
          onSelect={(marker) => router.push({ pathname: '/place/[city]', params: { city: marker.city, title: marker.title } })}
        />
      </View>

      <Text
        style={{
          color: colors.text,
          fontSize: 16,
          fontWeight: '700',
          letterSpacing: -0.2,
          paddingHorizontal: 16,
          marginTop: 22,
          marginBottom: 10,
        }}
      >
        {list.length} {list.length === 1 ? 'place' : 'places'}
      </Text>

      <View
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 16 }}
      >
        {list.map((place) => (
          <Touchable
            key={nameOf(place)}
            radius={radius.md}
            label={nameOf(place)}
            onPress={() =>
              router.push({
                pathname: '/place/[city]',
                params: { city: place.city ?? '', title: nameOf(place) },
              })
            }
          >
            <View
              style={[
                { width: size, height: size, borderRadius: radius.md, overflow: 'hidden' },
                shadow(1),
              ]}
            >
              <Image
                source={thumbnail(serverUrl, place.coverAssetId, places.token)}
                style={{ width: '100%', height: '100%', backgroundColor: colors.surface }}
                contentFit="cover"
                recyclingKey={place.coverAssetId}
                transition={120}
              />
              {/* The name sits on the picture rather than under it: at two
                  across, a caption line adds a third to the height of every
                  row for two words. */}
              <View
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  padding: 10,
                  backgroundColor: colors.overlay,
                }}
              >
                <Text numberOfLines={1} style={{ color: '#fff', fontSize: 14.5, fontWeight: '700' }}>
                  {nameOf(place)}
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12 }}>
                  {place.count.toLocaleString()} {place.count === 1 ? 'photo' : 'photos'}
                </Text>
              </View>
            </View>
          </Touchable>
        ))}
      </View>
    </ScrollView>
  );
}

/**
 * One map, drawn the same way everywhere.
 *
 * MapLibre renders from a style document rather than a vendor SDK, so iOS,
 * Android and the web client show an identical map — which is the whole reason
 * for not using each platform's native one.
 */
function MapOf({
  markers,
  frame,
  onSelect,
}: {
  markers: Pin[];
  frame: { bounds: [number, number, number, number]; zoom: number } | null;
  onSelect: (marker: Pin) => void;
}) {
  // Names are for when they can be read. Zoomed out to a continent the pins sit
  // on top of one another and the labels become a stack of illegible pills
  // covering the map, so each collapses to its count until there is room.
  const [zoom, setZoom] = useState(0);
  const named = zoom >= LABEL_ZOOM;

  if (!maplibre) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Icon name="pin" size={26} color={colors.faint} />
        <Text
          style={{
            color: colors.muted,
            fontSize: 13.5,
            textAlign: 'center',
            marginTop: 10,
            lineHeight: 19,
          }}
        >
          The map needs the full app. Your places are all listed below.
        </Text>
      </View>
    );
  }

  const { Camera, Map: MapLibre, Marker } = maplibre;

  return (
    <MapLibre
      style={{ flex: 1 }}
      mapStyle={mapStyleJson(resolvedDark())}
      // MapLibre's own logo is not this app's, and the tile licence is served
      // by the attribution control, which stays.
      logo={false}
      attributionPosition={{ bottom: 8, right: 8 }}
      // The map is a way of finding photos, not a cartography tool; tilting and
      // spinning it only ever gets in the way of reading the pins.
      touchRotate={false}
      touchPitch={false}
      onRegionIsChanging={(event) => setZoom(event.nativeEvent.zoom)}
    >
      {frame && <Camera initialViewState={{ bounds: frame.bounds, padding: { top: 40, right: 40, bottom: 40, left: 40 } }} />}
      {markers.map((marker) => (
        <Marker
          key={marker.city}
          id={marker.city}
          // Longitude first — GeoJSON order. Getting this the wrong way round
          // puts every European photo in the Indian Ocean.
          lngLat={[marker.longitude, marker.latitude]}
        >
          <Touchable radius={999} label={`${marker.title}, ${marker.count} photos`} onPress={() => onSelect(marker)}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                paddingHorizontal: named ? 9 : 7,
                paddingVertical: 3,
                borderRadius: 999,
                backgroundColor: colors.primary,
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.28)',
              }}
            >
              {named && (
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }} numberOfLines={1}>
                  {marker.city}
                </Text>
              )}
              <Text style={{ color: named ? 'rgba(255,255,255,0.78)' : '#fff', fontSize: 12, fontWeight: '700' }}>
                {marker.count.toLocaleString()}
              </Text>
            </View>
          </Touchable>
        </Marker>
      ))}
    </MapLibre>
  );
}
