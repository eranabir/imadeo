import { create } from 'zustand';

const STORAGE_KEY = 'imadeo.expandedFolders';
const REMEMBER_KEY = 'imadeo.rememberExpanded';

const load = (): Set<string> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
};

interface TreeState {
  expanded: Set<string>;
  /** When off, the tree starts collapsed on every visit. */
  remember: boolean;
  isExpanded: (id: string) => boolean;
  toggle: (id: string) => void;
  /** Opens a folder and every ancestor, so the current folder is always visible. */
  expandPath: (ids: string[]) => void;
  setRemember: (remember: boolean) => void;
}

/**
 * Which folders are open in the sidebar.
 *
 * Kept here rather than in each row's local state so the tree survives
 * navigation — otherwise every route change collapsed everything the person had
 * just opened.
 */
export const useTree = create<TreeState>((set, get) => {
  const remember = localStorage.getItem(REMEMBER_KEY) !== 'false';

  const persist = (expanded: Set<string>) => {
    if (get().remember) localStorage.setItem(STORAGE_KEY, JSON.stringify([...expanded]));
  };

  return {
    expanded: remember ? load() : new Set(),
    remember,

    isExpanded: (id) => get().expanded.has(id),

    toggle(id) {
      set((state) => {
        const expanded = new Set(state.expanded);
        if (expanded.has(id)) expanded.delete(id);
        else expanded.add(id);
        persist(expanded);
        return { expanded };
      });
    },

    expandPath(ids) {
      set((state) => {
        const expanded = new Set(state.expanded);
        let changed = false;
        for (const id of ids) {
          if (!expanded.has(id)) {
            expanded.add(id);
            changed = true;
          }
        }
        if (!changed) return state;
        persist(expanded);
        return { expanded };
      });
    },

    setRemember(remember) {
      localStorage.setItem(REMEMBER_KEY, String(remember));
      if (!remember) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify([...get().expanded]));
      set({ remember });
    },
  };
});
