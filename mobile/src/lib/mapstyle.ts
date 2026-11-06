/** OpenFreeMap supplies matching light/dark vector maps without an API key.
 * Deployments can still supply their own raster tile template.
 */
const OVERRIDE = process.env.EXPO_PUBLIC_MAP_TILES;
export const MAP_ATTRIBUTION = '© OpenStreetMap contributors';

export function mapStyle(dark: boolean) {
  if (!OVERRIDE) return `https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'positron'}`;
  return {
    version: 8 as const,
    sources: { base: { type: 'raster' as const, tiles: [OVERRIDE], tileSize: 256,
      attribution: MAP_ATTRIBUTION } },
    layers: [{ id: 'base', type: 'raster' as const, source: 'base' }],
  };
}

/** Native MapLibre accepts either a style URL or serialized style document. */
export const mapStyleJson = (dark: boolean) => {
  const style = mapStyle(dark);
  return typeof style === 'string' ? style : JSON.stringify(style);
};

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
