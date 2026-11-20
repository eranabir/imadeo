/** A stable, global index. Missing pages occupy positions without loading images. */
export interface IndexedCollection<T> {
  key: string;
  total: number;
  version: number;
  itemAt(index: number): T | undefined;
  loadRange(start: number, end: number): void;
  retain?(ids: readonly string[]): void;
}

export interface IndexPage<T> { items: T[]; total: number }

/** Random-access metadata cache. A distant jump never walks preceding pages. */
export class PageWindow<T extends { id: string }> {
  readonly pages = new Map<number, T[]>();
  readonly pending = new Map<number, AbortController>();
  readonly failed = new Map<number, string>();
  private retained = new Map<string, T>();
  private listeners = new Set<() => void>();
  private wanted: number[] = [];
  private range = { start: 0, end: 1 };
  private epoch = 0;
  total: number | null = null;
  error: string | null = null;
  version = 0;
  constructor(readonly fetchPage: (page: number, signal: AbortSignal) => Promise<IndexPage<T>>,
    readonly size = 60, readonly limit = 6, readonly concurrency = 2) {}

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit() { this.version++; this.listeners.forEach(fn => fn()); }
  itemAt = (index: number) => index < 0 || (this.total !== null && index >= this.total) ? undefined
    : this.pages.get(Math.floor(index / this.size) + 1)?.[index % this.size];
  get items() {
    const all = new Map<string, T>(this.retained);
    [...this.pages].sort(([a], [b]) => a - b).forEach(([, items]) => items.forEach(item => all.set(item.id, item)));
    return [...all.values()];
  }
  retain = (ids: readonly string[]) => {
    const all = new Map(this.items.map(item => [item.id, item]));
    this.retained = new Map(ids.flatMap(id => { const item = all.get(id); return item ? [[id, item] as const] : []; }));
  };

  loadRange = (start: number, end: number) => {
    this.range = { start, end };
    const last = this.total === null ? 1 : Math.max(1, Math.ceil(this.total / this.size));
    const firstPage = Math.min(last, Math.max(1, Math.floor(Math.max(0, start) / this.size) + 1));
    const endPage = Math.min(last, Math.max(firstPage, Math.ceil(Math.max(1, end) / this.size)));
    const center = (firstPage + endPage) / 2;
    // Visible pages first, then one adjacent page in either direction.
    const visible = Array.from({ length: Math.min(this.limit - 2, endPage - firstPage + 1) }, (_, i) => firstPage + i);
    this.wanted = [...visible.sort((a, b) => Math.abs(a - center) - Math.abs(b - center)),
      ...(firstPage > 1 ? [firstPage - 1] : []), ...(endPage < last ? [endPage + 1] : [])];
    for (const [page, controller] of this.pending) {
      if (!this.wanted.includes(page)) { controller.abort(); this.pending.delete(page); }
    }
    this.error = this.wanted.map(page => this.failed.get(page)).find(Boolean) ?? null;
    this.pump();
  };

  private pump() {
    while (this.pending.size < this.concurrency) {
      const page = this.wanted.find(p => !this.pages.has(p) && !this.pending.has(p) && !this.failed.has(p));
      if (page === undefined) return;
      const controller = new AbortController(), epoch = this.epoch;
      this.pending.set(page, controller);
      this.emit();
      void this.fetchPage(page, controller.signal).then(result => {
        if (controller.signal.aborted || epoch !== this.epoch) return;
        const totalChanged = this.total !== result.total;
        this.total = result.total;
        this.pages.delete(page); this.pages.set(page, result.items);
        while (this.pages.size > this.limit) {
          const victim = [...this.pages.keys()].find(p => !this.wanted.includes(p));
          if (victim === undefined) break;
          this.pages.delete(victim);
        }
        if (totalChanged) this.loadRange(this.range.start, this.range.end);
      }).catch(error => {
        if (controller.signal.aborted || epoch !== this.epoch) return;
        this.failed.set(page, error instanceof Error ? error.message : 'Could not load photos.');
        this.error = this.wanted.map(page => this.failed.get(page)).find(Boolean) ?? null;
      }).finally(() => {
        if (this.pending.get(page) !== controller) return;
        this.pending.delete(page);
        this.emit();
        this.pump();
      });
    }
  }
  reload = async () => {
    this.dispose(); this.pages.clear(); this.failed.clear(); this.error = null;
    this.loadRange(this.range.start, this.range.end);
    this.emit();
    if (this.pending.size) await new Promise<void>(resolve => {
      const unsubscribe = this.subscribe(() => { if (!this.pending.size) { unsubscribe(); resolve(); } });
    });
  };
  dispose = () => {
    this.epoch++;
    this.pending.forEach(controller => controller.abort()); this.pending.clear(); this.emit();
  };
}
