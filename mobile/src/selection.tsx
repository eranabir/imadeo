import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Whether a selection bar is currently showing, anywhere in the app.
 *
 * The bar and the tab bar occupy the same corner of the screen, and matching
 * their heights so one hides the other is a losing game — the tab bar carries
 * labels and the selection bar does not, so they are never the same size and a
 * sliver of tabs shows above the actions.
 *
 * So the tabs step aside instead. This is the smallest possible channel for
 * saying so: the screen that owns the selection is several levels below the
 * bar that has to react to it, and threading a boolean through every screen's
 * props to reach it would touch far more code than it is worth.
 */
const SelectionContext = createContext<{
  active: boolean;
  setActive: (active: boolean) => void;
}>({ active: false, setActive: () => {} });

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  const value = useMemo(() => ({ active, setActive }), [active]);
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export const useSelectionBar = () => useContext(SelectionContext);
