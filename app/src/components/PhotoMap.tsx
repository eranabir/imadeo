import * as maplibregl from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { frameOf, mapStyle } from '../lib/mapstyle';
import { useTheme } from '../store/theme';

/** Below this the pins show only their count; above it, the place name too. */
const LABEL_ZOOM = 5;

const PIN_CLASS =
  'flex items-center gap-1.5 rounded-full border border-white/25 bg-primary px-2 py-0.5 text-xs font-semibold text-white shadow-lg transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export interface MapPin {
  /** What the pin navigates to, and what it is labelled. */
  city: string;
  count: number;
  latitude: number;
  longitude: number;
}

/**
 * Where the photos were taken, as one labelled pin per place.
 *
 * MapLibre owns its canvas, so this is one of the few places in the client that
 * reaches for a ref and an effect instead of rendering markup: React is told to
 * leave the node alone, and the map is driven imperatively underneath it.
 */
export function PhotoMap({
  pins,
  onSelect,
  className,
}: {
  pins: MapPin[];
  onSelect?: (city: string) => void;
  className?: string;
}) {
  const isDark = useTheme((state) => state.isDark);
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const labels = useRef<HTMLElement[]>([]);
  const framed = useRef(false);

  useEffect(() => {
    if (!holder.current || map.current) return;

    map.current = new maplibregl.Map({
      container: holder.current,
      style: mapStyle(isDark),
      center: [0, 20],
      zoom: 1.2,
      // The map is a way of finding photos, not a cartography tool; tilting and
      // spinning it only ever gets in the way of reading the pins.
      pitchWithRotate: false,
      dragRotate: false,
      attributionControl: { compact: true },
    });

    map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    return () => {
      map.current?.remove();
      map.current = null;
      framed.current = false;
    };
    // Only on mount: the theme is handled below by swapping the style on the
    // live map, which keeps the camera where it was. Rebuilding the map would
    // throw away wherever it had been panned to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    map.current?.setStyle(mapStyle(isDark));
  }, [isDark]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;

    for (const marker of markers.current) marker.remove();
    labels.current = [];
    // Smallest first, so that where pins overlap — five towns in one metropolis,
    // at a zoom where they are one dot apart — the one left on top is the one
    // with the most photos in it, not whichever happened to be last in the list.
    markers.current = [...pins].sort((a, b) => a.count - b.count).map((pin) => {
      /**
       * One pin per place, labelled — not one per photo.
       *
       * A dot per photo puts thirty identical dots on the same rooftop, so the
       * map says nothing about where the pictures actually are, and the thing
       * you are trying to hit is four millimetres wide. A labelled pill is
       * legible at a glance and big enough to press on a phone.
       */
      const button = document.createElement('button');
      button.type = 'button';
      button.className = PIN_CLASS;

      const name = document.createElement('span');
      name.textContent = pin.city;
      const count = document.createElement('span');
      count.className = 'tabular-nums opacity-75';
      count.textContent = pin.count.toLocaleString();
      button.append(name, count);

      button.setAttribute('aria-label', `${pin.city}, ${pin.count} photos`);
      labels.current.push(name);

      // MapLibre starts a pan from any mousedown inside the map, and a pan that
      // moves by a pixel eats the click that would have followed. The pin is a
      // control, not part of the canvas, so it keeps its own presses.
      button.addEventListener('mousedown', (event) => event.stopPropagation());
      button.addEventListener('touchstart', (event) => event.stopPropagation());
      if (onSelect) button.addEventListener('click', () => onSelect(pin.city));

      // Longitude first — GeoJSON order. Getting this the wrong way round puts
      // every European photo in the Indian Ocean.
      return new maplibregl.Marker({ element: button })
        .setLngLat([pin.longitude, pin.latitude])
        .addTo(instance);
    });

    // Framed once, on the first load that has pins, rather than on every
    // change: reframing after a pan would yank the map back from wherever it
    // was dragged to. `fitBounds` rather than a computed zoom because only the
    // map knows how big it ended up on screen.
    const frame = frameOf(pins);
    if (frame && !framed.current) {
      framed.current = true;
      instance.fitBounds(frame.bounds, { padding: 56, maxZoom: 13, animate: false });
    }

    /**
     * Names are for when they can be read.
     *
     * Zoomed out to a continent the pins sit on top of one another and the
     * labels turn into a stack of illegible pills covering the map. Below the
     * threshold each pin collapses to its count — still a real target, still
     * says how much is there, and the map underneath stays visible. The name
     * comes back as soon as there is room for it.
     */
    const relabel = () => {
      const named = instance.getZoom() >= LABEL_ZOOM;
      for (const label of labels.current) label.style.display = named ? '' : 'none';
    };

    relabel();
    instance.on('zoom', relabel);
    return () => {
      instance.off('zoom', relabel);
    };
  }, [pins, onSelect]);

  return <div ref={holder} className={className} />;
}
