/**
 * The map's look, shared by every platform.
 *
 * MapLibre draws from a style document rather than from a vendor's SDK, which
 * is what lets the web client and the mobile app render an identical map with
 * no key and no bill. This is the smallest style that does anything: one raster
 * source of tiles, one layer drawing it. Keep it in step with
 * `mobile/src/lib/mapstyle.ts` — the point of the exercise is that the two
 * agree.
 *
 * The tiles are CARTO's Positron and Dark Matter rather than OpenStreetMap's
 * own, for two reasons. Their labels are in English worldwide, where the
 * standard OSM tiles are labelled in each country's own language — a map of
 * your holiday is no use if you cannot read the town names. And they come as a
 * matched light and dark pair of near-greys, which is what lets the map follow
 * the theme and sit at the same weight as the surfaces around it, instead of
 * being a lit panel in a dark room.
 *
 * Both are free to use with attribution. Anyone running Imadeo at scale should
 * still point `VITE_MAP_TILES` at their own tile server or a paid plan; that is
 * why it is a setting rather than a constant buried in a component.
 */
const OVERRIDE = import.meta.env.VITE_MAP_TILES;

/** CARTO serves the same tiles from four hosts; using all of them parallelises the fetches. */
const cartoTiles = (name: string) =>
  ['a', 'b', 'c', 'd'].map((host) => `https://${host}.basemaps.cartocdn.com/${name}/{z}/{x}/{y}{ratio}.png`);

/** Required by the tile licence, and shown on the map itself. */
export const MAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

/**
 * The style document for one theme.
 *
 * `{ratio}` is filled in here rather than left to MapLibre: CARTO spells the
 * retina variant `@2x`, and asking for it on an ordinary screen only wastes
 * bandwidth.
 */
export function mapStyle(dark: boolean) {
  const ratio = typeof window !== 'undefined' && window.devicePixelRatio > 1.5 ? '@2x' : '';
  const tiles = (OVERRIDE ? [OVERRIDE] : cartoTiles(dark ? 'dark_all' : 'light_all')).map((url) =>
    url.replace('{ratio}', ratio),
  );

  return {
    version: 8 as const,
    sources: {
      base: {
        type: 'raster' as const,
        tiles,
        tileSize: 256,
        attribution: MAP_ATTRIBUTION,
      },
    },
    layers: [{ id: 'base', type: 'raster' as const, source: 'base' }],
  };
}

/**
 * A camera that frames whatever points there are.
 *
 * A map opening on a fixed coordinate shows an ocean and invites you to go and
 * find your own holiday. Shared with the mobile client so both open the same
 * way.
 */
export function frameOf(points: { latitude: number; longitude: number }[]) {
  if (points.length === 0) return null;

  const lat = points.map((p) => p.latitude);
  const lng = points.map((p) => p.longitude);
  const span = Math.max(Math.max(...lat) - Math.min(...lat), Math.max(...lng) - Math.min(...lng));

  return {
    bounds: [
      [Math.min(...lng), Math.min(...lat)],
      [Math.max(...lng), Math.max(...lat)],
    ] as [[number, number], [number, number]],
    centre: [
      (Math.max(...lng) + Math.min(...lng)) / 2,
      (Math.max(...lat) + Math.min(...lat)) / 2,
    ] as [number, number],
    // Approximate on purpose: it only has to open somewhere sensible, and the
    // map is draggable the moment it appears.
    zoom: span > 40 ? 1.5 : span > 10 ? 3.5 : span > 2 ? 6.5 : span > 0.2 ? 9.5 : 12,
  };
}
