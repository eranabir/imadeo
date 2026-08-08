/**
 * Grouping photographs by the day they were taken.
 *
 * Shared, because the device grid and the server grid are the same idea and had
 * already been written twice — once over `MediaLibrary`'s millisecond
 * `creationTime`, once not at all. Browse had no day headings whatsoever, which
 * left the larger of the two libraries as an undifferentiated wall.
 */

/** Anything a photo might carry a date as. */
export type When = number | string | Date | null | undefined;

/**
 * Below this, a timestamp is a missing date rather than an old photograph.
 *
 * A device asset with no creation time comes back as `0` or a handful of
 * milliseconds, which formats as "January 1, 1970" and sat at the top of the
 * Library looking like a real day. The obvious floor — some date early in the
 * century — is worse than useless here: those are *negative* timestamps, so
 * zero sails straight past them. The epoch itself is the thing to exclude.
 */
const PLAUSIBLE = new Date('1971-01-01').getTime();

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** The day something was taken, or null if it does not say. */
export function dayOf(at: When): Date | null {
  if (at === null || at === undefined || at === '') return null;
  const date = at instanceof Date ? at : new Date(at);
  const time = date.getTime();
  if (!Number.isFinite(time) || time < PLAUSIBLE) return null;
  return date;
}

/** "Today", "Yesterday", "4 June", "4 June 2019" — or "No date". */
export function dayLabel(at: When): string {
  const taken = dayOf(at);
  if (!taken) return 'No date';

  const now = new Date();
  const days = Math.round((midnight(now) - midnight(taken)) / 86_400_000);

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';

  return taken.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    ...(taken.getFullYear() === now.getFullYear() ? null : { year: 'numeric' }),
  });
}

/**
 * Splits a list into days, each already cut into rows of `columns`.
 *
 * Rows rather than loose items because a `SectionList` cannot lay out columns
 * itself — a section's data is one row per entry, and the grid is built from
 * the arrays inside it.
 *
 * The order of the input is kept exactly. These lists arrive from the server
 * already sorted, and re-sorting here would quietly override whatever the
 * screen asked for.
 */
export function intoDays<T>(
  items: T[],
  at: (item: T) => When,
  columns: number,
): { title: string; data: T[][] }[] {
  const days: { title: string; data: T[][] }[] = [];

  for (const item of items) {
    const title = dayLabel(at(item));
    let day = days[days.length - 1];
    if (!day || day.title !== title) {
      day = { title, data: [] };
      days.push(day);
    }
    const row = day.data[day.data.length - 1];
    if (!row || row.length === columns) day.data.push([item]);
    else row.push(item);
  }

  return days;
}
