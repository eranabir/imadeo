import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Props<T> {
  items: T[];
  renderItem: (item: T) => ReactNode;
  getKey: (item: T) => string;
  /** The narrowest useful card width. */
  minItemWidth: number;
  /** Fixed or width-derived card height. */
  itemHeight: number | ((width: number) => number);
  /** Force a specific column count, for example one column for a virtual list. */
  columnCount?: number;
  gap?: number;
  className?: string;
}

function findScrollParent(element: HTMLElement) {
  let parent = element.parentElement;
  while (parent) {
    const overflow = getComputedStyle(parent).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return parent;
    parent = parent.parentElement;
  }
  return null;
}

/**
 * A responsive card grid which only mounts the rows around the visible page.
 * It is used for albums and folders, where a normal CSS grid creates a DOM
 * node (and an album-cover image) for every item before the first scroll.
 */
export function VirtualGrid<T>({
  items,
  renderItem,
  getKey,
  minItemWidth,
  itemHeight,
  columnCount,
  gap = 12,
  className,
}: Props<T>) {
  const element = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [range, setRange] = useState({ start: 0, end: items.length });
  const columns = columnCount ?? Math.max(1, Math.floor((width + gap) / (minItemWidth + gap)));
  const cardWidth = width > 0
    ? (width - gap * (columns - 1)) / columns
    : columnCount
      ? 0
      : minItemWidth;
  const height = typeof itemHeight === 'function' ? itemHeight(cardWidth) : itemHeight;
  const rows = Math.ceil(items.length / columns);
  const totalHeight = rows === 0 ? 0 : rows * height + Math.max(0, rows - 1) * gap;

  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    setWidth(node.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const node = element.current;
    if (!node || items.length === 0) return;
    const parent = findScrollParent(node);
    const update = () => {
      const nodeRect = node.getBoundingClientRect();
      const parentRect = parent?.getBoundingClientRect();
      const scrollTop = parent ? parent.scrollTop : window.scrollY;
      const viewportHeight = parent ? parent.clientHeight : window.innerHeight;
      const gridTop = parent
        ? parent.scrollTop + nodeRect.top - (parentRect?.top ?? 0)
        : window.scrollY + nodeRect.top;
      const rowSpan = height + gap;
      const start = Math.max(0, Math.floor((scrollTop - gridTop - viewportHeight * 1.5) / rowSpan));
      const end = Math.min(rows, Math.ceil((scrollTop - gridTop + viewportHeight * 2.5) / rowSpan));
      const next = { start: start * columns, end: Math.min(items.length, end * columns) };
      setRange((current) => (current.start === next.start && current.end === next.end ? current : next));
    };
    update();
    parent?.addEventListener('scroll', update, { passive: true });
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      parent?.removeEventListener('scroll', update);
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [items.length, columns, height, gap, rows]);

  return (
    <div ref={element} className={`relative w-full ${className ?? ''}`} style={{ height: totalHeight }}>
      {items.slice(range.start, range.end).map((item, index) => {
        const at = range.start + index;
        const column = at % columns;
        const row = Math.floor(at / columns);
        return (
          <div
            key={getKey(item)}
            className="absolute"
            style={{
              width: cardWidth,
              height,
              left: column * (cardWidth + gap),
              top: row * (height + gap),
            }}
          >
            {renderItem(item)}
          </div>
        );
      })}
    </div>
  );
}
