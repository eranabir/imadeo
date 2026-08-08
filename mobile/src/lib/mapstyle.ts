/**
 * The map's look, shared by every platform.
 *
 * MapLibre draws from a style document rather than from a vendor's SDK, which
 * is what lets iOS, Android and the web client render an identical map with no
 * key and no bill. This is the smallest style that does anything: one raster
 * source of tiles, one layer drawing it. Keep it in step with
 * `app/src/lib/mapstyle.ts` — the point of the exercise is that the two agree.
 *
 * The tiles are CARTO's Positron and Dark Matter rather than OpenStreetMap's
 * own, for two reasons. Their labels are in English worldwide, where the
 * standard OSM tiles are labelled in each country's own language — a map of
 * your holiday is no use if you cannot read the town names. And they come as a
 * matched light and dark pair, which is what lets the map follow the theme
 * rather than sitting on the page as a black rectangle.
 *
 * Free to use with attribution. Anyone running Imadeo at scale should still
 * point `EXPO_PUBLIC_MAP_TILES` at their own tile server or a paid plan, which
 * is why it is a setting rather than a constant buried in a component.
 */
const OVERRIDE = process.env.EXPO_PUBLIC_MAP_TILES;

/** CARTO serves the same tiles from four hosts; using all of them parallelises the fetches. */
const tiles = (sheet: 'dark_all' | 'light_all') =>
  OVERRIDE
    ? [OVERRIDE]
    : ['a', 'b', 'c', 'd'].map(
        (host) => `https://${host}.basemaps.cartocdn.com/${sheet}/{z}/{x}/{y}@2x.png`,
      );

/** Required by the tile licence, and shown on the map itself. */
export const MAP_ATTRIBUTION = '© OpenStreetMap contributors © CARTO';

/**
 * The style document for one theme.
 *
 * It was pinned to the dark sheet, written when this app was dark throughout.
 * Once Appearance grew a Light option that left the Places card as a black
 * rectangle on a white page — the one surface in the app that ignored the
 * setting.
 */
export function mapStyle(dark: boolean) {
  return {
    version: 8 as const,
    sources: {
      base: {
        type: 'raster' as const,
        tiles: tiles(dark ? 'dark_all' : 'light_all'),
        tileSize: 256,
        attribution: MAP_ATTRIBUTION,
      },
    },
    layers: [{ id: 'base', type: 'raster' as const, source: 'base' }],
  };
}

/** The same document as a string, which is what the native view wants. */
export const mapStyleJson = (dark: boolean) => JSON.stringify(mapStyle(dark));

export function frameOf(points: { latitude: number; longitude: number }[]) {
  if (points.length === 0) return null;

  const lat = points.map((p) => p.latitude);
  const lng = points.map((p) => p.longitude);
  const span = Math.max(Math.max(...lat) - Math.min(...lat), Math.max(...lng) - Math.min(...lng));

  return {
    /** West, south, east, north — GeoJSON order, which is what `Camera` wants. */
    bounds: [Math.min(...lng), Math.min(...lat), Math.max(...lng), Math.max(...lat)] as [
      number,
      number,
      number,
      number,
    ],
    centre: [
      (Math.max(...lng) + Math.min(...lng)) / 2,
      (Math.max(...lat) + Math.min(...lat)) / 2,
    ] as [number, number],
    // Approximate on purpose: it only has to open somewhere sensible, and the
    // map is draggable the moment it appears.
    zoom: span > 40 ? 1.5 : span > 10 ? 3.5 : span > 2 ? 6.5 : span > 0.2 ? 9.5 : 12,
  };
}
