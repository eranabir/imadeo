export const formatBytes = (bytes: number | string | null | undefined): string => {
  const value = typeof bytes === 'string' ? Number(bytes) : (bytes ?? 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / 1024 ** exponent;
  return `${scaled.toFixed(exponent === 0 ? 0 : scaled >= 10 ? 0 : 1)} ${units[exponent]}`;
};

/** "00:01:23.456" from the API becomes "1:23". */
export const formatDuration = (duration: string | null): string => {
  if (!duration) return '';
  const [h, m, s] = duration.split(':');
  const seconds = Math.floor(Number.parseFloat(s ?? '0'));
  const minutes = Number.parseInt(m ?? '0', 10);
  const hours = Number.parseInt(h ?? '0', 10);

  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
};

/**
 * `localDateTime` is a wall-clock time — the moment shown on the camera in the
 * photo's own timezone — that Postgres stores in a UTC column. Rendering it in
 * the viewer's timezone would shift an 18:04 shot in Tokyo to whatever 18:04Z
 * happens to be locally, so these formatters pin the zone to UTC to read the
 * original wall time back out unchanged.
 */
export const formatDate = (iso: string, locale = 'en'): string =>
  new Date(iso).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

export const formatDateTime = (iso: string, locale = 'en'): string =>
  new Date(iso).toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });

/** For genuine instants (upload time, trash purge date) the viewer's zone is right. */
export const formatInstant = (iso: string, locale = 'en'): string =>
  new Date(iso).toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Groups a flat, date-sorted asset list into day headings for the timeline. */
export const groupByDay = <T extends { localDateTime: string }>(assets: T[]) => {
  const groups = new Map<string, T[]>();
  for (const asset of assets) {
    // localDateTime is already shifted into the photo's own zone by the server,
    // so slicing the date part is correct and avoids a second conversion here.
    const day = asset.localDateTime.slice(0, 10);
    const bucket = groups.get(day);
    if (bucket) bucket.push(asset);
    else groups.set(day, [asset]);
  }
  return [...groups.entries()].map(([day, items]) => ({ day, items }));
};
