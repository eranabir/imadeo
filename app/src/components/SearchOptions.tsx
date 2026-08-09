import { useQuery } from '@tanstack/react-query';
import { ArrowRight, PawPrint, Search as SearchIcon, UserRound } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { Button, Dialog, Input, Radio } from '../ui';

export type SearchMode = 'context' | 'filename' | 'description' | 'place';

export interface SearchFilters {
  personIds: string[];
  mode: SearchMode;
  text: string;
  takenAfter: string;
  takenBefore: string;
}

export const emptyFilters: SearchFilters = {
  personIds: [],
  mode: 'context',
  text: '',
  takenAfter: '',
  takenBefore: '',
};

/** Turns the form into query parameters, dropping everything left blank. */
export function toParams(filters: SearchFilters) {
  return {
    // Context is answered by a different endpoint, so it is never a filter here.
    ...(filters.mode === 'context' || filters.mode === 'place'
      ? {}
      : { [filters.mode]: filters.text || undefined }),
    personIds: filters.personIds.length ? filters.personIds.join(',') : undefined,
    takenAfter: filters.takenAfter ? new Date(filters.takenAfter).toISOString() : undefined,
    takenBefore: filters.takenBefore ? new Date(filters.takenBefore).toISOString() : undefined,
    size: 500,
  };
}

export function countActive(filters: SearchFilters) {
  const { personIds, mode: _mode, ...rest } = filters;
  return personIds.length + Object.values(rest).filter((value) => value !== '').length;
}

interface Subject {
  id: string;
  name: string;
  thumbnailPath: string;
  kind: 'PERSON' | 'PET';
}

const SEARCH_TYPES: { value: SearchMode; label: string; field: string }[] = [
  { value: 'context', label: 'Context', field: 'Search by context' },
  { value: 'filename', label: 'File name or extension', field: 'Search by file name' },
  { value: 'description', label: 'Description', field: 'Search by description' },
  { value: 'place', label: 'Album or folder', field: 'Search albums and folders' },
];

export function SearchOptions({
  open,
  initial,
  onClose,
  onSearch,
}: {
  open: boolean;
  initial: SearchFilters;
  onClose: () => void;
  onSearch: (filters: SearchFilters) => void;
}) {
  const [filters, setFilters] = useState<SearchFilters>(initial);
  const [peopleFilter, setPeopleFilter] = useState('');
  const [showAllPeople, setShowAllPeople] = useState(false);

  const set = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const { data: subjects = [] } = useQuery({
    queryKey: ['people', 'search-picker'],
    queryFn: async () => (await api.get<Subject[]>('/people', { params: { minFaces: 1 } })).data,
    enabled: open,
  });

  const needle = peopleFilter.trim().toLowerCase();
  const matching = subjects.filter((s) => !needle || s.name.toLowerCase().includes(needle));
  // A single row until asked for more, so the form does not open two pages tall.
  const shownPeople = showAllPeople ? matching : matching.slice(0, 8);

  const togglePerson = (id: string) =>
    set(
      'personIds',
      filters.personIds.includes(id)
        ? filters.personIds.filter((entry) => entry !== id)
        : [...filters.personIds, id],
    );

  const current = SEARCH_TYPES.find((entry) => entry.value === filters.mode)!;

  return (
    <Dialog
      open={open}
      title="Search options"
      width="lg"
      onClose={onClose}
      footer={
        <>
          {/* Matched widths: a wider Search made Clear all look like an
              afterthought rather than the other half of a pair. */}
          <Button className="min-w-32" onClick={() => setFilters(emptyFilters)}>
            Clear all
          </Button>
          <Button
            className="min-w-32"
            variant="primary"
            icon={<SearchIcon size={15} />}
            onClick={() => onSearch(filters)}
          >
            Search
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {subjects.length > 0 && (
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">People &amp; pets</h3>
              <Input
                placeholder="Filter people and pets"
                adornment={<SearchIcon size={14} />}
                size="sm"
                value={peopleFilter}
                containerClassName="w-56"
                className="rounded-full bg-surface-sunken"
                onChange={(event) => setPeopleFilter(event.target.value)}
              />
            </div>

            <div className="flex flex-wrap gap-3">
              {shownPeople.map((subject) => {
                const picked = filters.personIds.includes(subject.id);
                return (
                  <button
                    key={subject.id}
                    type="button"
                    onClick={() => togglePerson(subject.id)}
                    className="w-[68px] text-center"
                  >
                    <span
                      className={`mx-auto block aspect-square w-full overflow-hidden rounded-full bg-surface-sunken ring-2 ring-offset-2 ring-offset-surface-overlay transition ${
                        picked ? 'ring-primary' : 'ring-transparent'
                      }`}
                    >
                      {subject.thumbnailPath ? (
                        <img
                          src={`/api/people/${subject.id}/thumbnail.jpg`}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="grid h-full w-full place-items-center text-content-muted">
                          {subject.kind === 'PET' ? <PawPrint size={18} /> : <UserRound size={18} />}
                        </span>
                      )}
                    </span>
                    <span className="mt-1.5 block truncate text-[11px] font-medium leading-tight">
                      {subject.name || <span className="text-content-muted">Unnamed</span>}
                    </span>
                  </button>
                );
              })}
            </div>

            {matching.length > shownPeople.length && (
              <button
                type="button"
                onClick={() => setShowAllPeople(true)}
                className="mx-auto mt-3 flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <ArrowRight size={14} />
                See all {matching.length}
              </button>
            )}
          </section>
        )}

        <section>
          <h3 className="mb-2 text-sm font-semibold">Search type</h3>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {SEARCH_TYPES.map((entry) => (
              <Radio
                key={entry.value}
                name="search-type"
                checked={filters.mode === entry.value}
                label={entry.label}
                onChange={() => set('mode', entry.value)}
              />
            ))}
          </div>

          <Input
            label={current.field}
            containerClassName="mt-3"
            size="lg"
            className="bg-surface-sunken"
            value={filters.text}
            placeholder={filters.mode === 'context' ? 'Sunrise on the beach' : 'IMG_1234'}
            onChange={(event) => set('text', event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onSearch(filters);
            }}
          />
        </section>

                        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Start date"
            type="date"
            size="lg"
            className="bg-surface-sunken"
            value={filters.takenAfter}
            onChange={(event) => set('takenAfter', event.target.value)}
          />
          <Input
            label="End date"
            type="date"
            size="lg"
            className="bg-surface-sunken"
            value={filters.takenBefore}
            onChange={(event) => set('takenBefore', event.target.value)}
          />
        </div>

             </div>
    </Dialog>
  );
}
