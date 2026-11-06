/** Inline glass control, excluding UIKit's bottom-edge tab-bar gutter. */
export const BROWSE_TAB_HEIGHT = 64;
// UITabBar already supplies its own floating-platter side margins.
export const BROWSE_TAB_INSET = 0;
// UIKit's 20pt platter gutter sits 4pt past the heading's 16pt inset.
export const BROWSE_TAB_LEADING_OFFSET = -4;
export const BROWSE_TAB_GAP = 4;

/** iPad's inline symbols and titles need wider slots than phone controls. */
export function browseTabMaxWidth(compactWidth: number, isPad: boolean): number {
  return compactWidth * (isPad ? 1.5 : 1);
}
