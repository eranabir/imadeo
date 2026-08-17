import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * The panel a selection raises, kept where it can cover the tab bar.
 *
 * The screen that owns a selection cannot draw over the tab bar: on both
 * platforms the bar is a sibling of the screen's view and is composited above
 * it, so a panel rendered inside the screen always comes out underneath, and
 * the two collide at the bottom edge.
 *
 * The native bar is hidden while selection is active and the active route
 * draws the replacement panel. This context carries that shared state without
 * placing a stateful visual wrapper above the native tab controller.
 */
const SelectionContext = createContext<{
  active: boolean;
  setActive: (active: boolean) => void;
  dock: ReactNode;
  publish: (dock: ReactNode) => void;
}>({ active: false, setActive: () => {}, dock: null, publish: () => {} });

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  const [dock, setDock] = useState<ReactNode>(null);

  // Stable for the life of the provider: it is a dependency of the publishing
  // effect, and a fresh function each render would re-run it forever.
  const publish = useCallback((next: ReactNode) => setDock(() => next), []);

  const value = useMemo(() => ({ active, setActive, dock, publish }), [active, dock, publish]);
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export const useSelectionBar = () => useContext(SelectionContext);

/** What the active route should draw while its native tab bar is hidden. */
export function useSelectionDock(dock: ReactNode, deps: unknown[]) {
  const { publish } = useSelectionBar();

  useEffect(() => {
    publish(dock);
    return () => publish(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publish, ...deps]);
}
