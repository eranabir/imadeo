import type { SegmentedProps } from './Segmented';

export type BrowseTabsProps<T extends string> = SegmentedProps<T> & {
  /** Inline control height, excluding a bottom tab bar's extra edge gutter. */
  height?: number;
  onHeightChange?: (height: number) => void;
};
