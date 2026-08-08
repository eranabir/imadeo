import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { AppConfig } from '../../config/configuration';

export interface Place {
  city: string | null;
  state: string | null;
  country: string | null;
}

/** What Nominatim sends back. Only the fields worth reading are named. */
interface NominatimReply {
  address?: {
    city?: string;
    town?: string;
    village?: string;
    hamlet?: string;
    municipality?: string;
    suburb?: string;
    state?: string;
    region?: string;
    county?: string;
    country?: string;
  };
}

/**
 * Turns coordinates into the name of a place.
 *
 * Photos carry latitude and longitude and nothing else — no EXIF tag says "New
 * York". Somebody has to be asked, and this asks Nominatim, OpenStreetMap's own
 * service. It needs no key and costs nothing, which is why it is the default,
 * but it is a shared public service with a usage policy attached, and this class
 * exists mostly to honour that policy rather than to make one HTTP call.
 *
 * Worth being plain about the trade: a coordinate leaves the server on every
 * lookup. For a self-hosted photo app that is a real disclosure — approximately
 * where a photo was taken, to a third party — and the reason an offline dataset
 * is the alternative. It is disabled by one setting when that matters.
 */
@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);

  /**
   * Results by rounded coordinate.
   *
   * Three decimal places is about 110 metres. Every photo from one afternoon in
   * a park lands in the same bucket, so a holiday's worth of pictures asks once
   * rather than four hundred times — which is the difference between a backfill
   * finishing and one that would take six minutes per hundred photos.
   */
  private readonly cache = new Map<string, Place>();

  /** Resolves when the next request is allowed to go out. */
  private nextSlot = Promise.resolve();

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  get enabled(): boolean {
    return this.config.get('geocoding.enabled', { infer: true });
  }

  /**
   * The place at these coordinates, or null if nothing could be determined.
   *
   * Never throws. A photo whose location cannot be named is still a photo, and
   * a geocoder being down is not a reason for an upload to fail.
   */
  async lookup(latitude: number, longitude: number): Promise<Place | null> {
    if (!this.enabled) return null;

    const key = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    try {
      const reply = await this.request(latitude, longitude);
      const address = reply?.address;
      if (!address) return null;

      const place: Place = {
        // Nominatim names the same thing differently depending on how big it
        // is, and a photo taken in a village should say the village.
        city:
          address.city ??
          address.town ??
          address.village ??
          address.municipality ??
          address.hamlet ??
          address.suburb ??
          null,
        state: address.state ?? address.region ?? address.county ?? null,
        country: address.country ?? null,
      };

      this.cache.set(key, place);
      return place;
    } catch (error) {
      this.logger.warn(
        `Could not look up ${key}: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }

  /**
   * One request, no sooner than a second after the last one.
   *
   * Nominatim's usage policy allows one request per second from an application,
   * and enforces it by blocking the ones that do not comply. Each call chains
   * onto the previous, so however many photos are being processed at once, they
   * queue behind each other rather than arriving together and getting the whole
   * server banned.
   */
  private async request(latitude: number, longitude: number): Promise<NominatimReply | null> {
    const wait = this.nextSlot;
    let release!: () => void;
    this.nextSlot = new Promise<void>((resolve) => {
      release = resolve;
    });
    await wait;

    const started = Date.now();
    try {
      const { data } = await axios.get<NominatimReply>(
        `${this.config.get('geocoding.url', { infer: true })}/reverse`,
        {
          params: {
            lat: latitude,
            lon: longitude,
            format: 'jsonv2',
            // 10 is roughly city level. Asking for more detail returns a house
            // number nobody wants to see under a photograph.
            zoom: 10,
            addressdetails: 1,
          },
          headers: {
            // The policy requires an application to identify itself. An
            // anonymous caller is the kind that gets blocked.
            'User-Agent': this.config.get('geocoding.userAgent', { infer: true }),
            'Accept-Language': this.config.get('geocoding.language', { infer: true }),
          },
          timeout: 10_000,
        },
      );
      return data;
    } finally {
      // Held for the rest of the second whether the call worked or not: a
      // failure that retried immediately would be the fastest way to be banned.
      const spent = Date.now() - started;
      const gap = this.config.get('geocoding.minIntervalMs', { infer: true });
      setTimeout(release, Math.max(0, gap - spent));
    }
  }
}
