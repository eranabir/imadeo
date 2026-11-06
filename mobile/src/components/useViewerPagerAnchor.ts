import { useLayoutEffect, useRef, type RefObject } from 'react';
import { AppState } from 'react-native';

interface Pager {
  scrollToOffset: (options: { offset: number; animated: boolean }) => void;
}

/** Keep the current media page when the window changes width or resumes. */
export function useViewerPagerAnchor(
  pager: RefObject<Pager | null>,
  width: number,
  index: RefObject<number>,
) {
  const anchoring = useRef(false);
  const previousWidth = useRef(width);

  useLayoutEffect(() => {
    let frame: number | undefined;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const anchor = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      if (settle !== undefined) clearTimeout(settle);
      anchoring.current = true;
      const position = () => {
        if (anchoring.current) pager.current?.scrollToOffset({ offset: index.current * width, animated: false });
      };
      frame = requestAnimationFrame(position);
      // The modal/list can finish a native layout after the first frame.
      settle = setTimeout(() => {
        position();
        anchoring.current = false;
      }, 250);
    };
    if (previousWidth.current !== width) {
      previousWidth.current = width;
      anchor();
    }
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') anchor();
    });
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      if (settle !== undefined) clearTimeout(settle);
      anchoring.current = false;
      subscription.remove();
    };
  }, [pager, width, index]);

  return anchoring;
}
