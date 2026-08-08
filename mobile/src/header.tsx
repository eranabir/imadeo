import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { LayoutAnimation } from 'react-native';
import type { IconName } from './components/Icon';

export interface HeaderConfig {
  title: string;
  subtitle?: string;
  icon?: IconName;
  action?: ReactNode;
  /** Anything that hangs under the title — a segmented control, a search field. */
  below?: ReactNode;
  /** Set by a pushed screen, the only kind with somewhere to go back to. */
  onBack?: () => void;
}

type Slots = Partial<Record<string, HeaderConfig>>;

const SlotContext = createContext<{
  publish: (id: string, config: HeaderConfig | null) => void;
  slots: Slots;
} | null>(null);

/**
 * One bar, filled in by whichever tab is showing.
 *
 * The bar used to live inside each tab, which meant there were five of them and
 * a swipe carried whichever two were involved across the screen. Holding it
 * still by undoing the pager's translation only made the movement invisible;
 * there were still two bars cross-fading in the same place, and it read as
 * exactly what it was.
 *
 * So the bar is rendered once, by the shell, outside the pager where nothing
 * can move it. A tab does not draw it; it says what should be in it, and the
 * shell shows whichever tab is in front.
 */
export function HeaderSlots({ children }: { children: ReactNode }) {
  const [slots, setSlots] = useState<Slots>({});

  /**
   * Stable for the life of the provider.
   *
   * It is a dependency of every publishing effect, so a fresh function on each
   * render would re-run them all, set state and render again — which is exactly
   * the loop React reports as a maximum update depth.
   */
  const publish = useCallback((id: string, config: HeaderConfig | null) => {
    setSlots((current) => {
      if (current[id] === (config ?? undefined)) return current;

      /*
       * A screen arriving or leaving, rather than one changing its mind.
       *
       * A push does not bring a new bar — the screen publishes into the one
       * already there — so what changes is that bar's contents and its height:
       * People & Pets carries a segmented control, a person a back chevron and
       * two buttons. Measured before and after and interpolated by the
       * platform, it reads as the bar becoming the next thing rather than being
       * replaced by it.
       *
       * Only on the first and last publish of a slot. Library's subtitle counts
       * up through a backup, and animating the bar every four seconds for that
       * would be a tic.
       */
      const arriving = config !== null && current[id] === undefined;
      const leaving = config === null && current[id] !== undefined;
      if (arriving || leaving) {
        LayoutAnimation.configureNext({
          duration: 240,
          update: { type: LayoutAnimation.Types.easeInEaseOut },
          create: {
            type: LayoutAnimation.Types.easeInEaseOut,
            property: LayoutAnimation.Properties.opacity,
          },
          delete: {
            type: LayoutAnimation.Types.easeInEaseOut,
            property: LayoutAnimation.Properties.opacity,
          },
        });
      }

      return { ...current, [id]: config ?? undefined };
    });
  }, []);

  const value = useMemo(() => ({ publish, slots }), [publish, slots]);

  return <SlotContext.Provider value={value}>{children}</SlotContext.Provider>;
}

/**
 * Says what this screen's bar should contain.
 *
 * `deps` is the list the config is rebuilt from — the same discipline as any
 * effect. Getting it wrong shows a stale title, not a broken screen.
 */
export function useHeaderSlot(
  id: string,
  config: HeaderConfig,
  deps: unknown[],
  /**
   * Off when this screen is not the one filling the bar.
   *
   * Browse is both a tab and, pushed, a folder — and a pushed screen covers the
   * shell's bar and draws its own, so it must not also be writing into it.
   */
  enabled = true,
) {
  const context = useContext(SlotContext);
  const publish = context?.publish;

  useEffect(() => {
    if (!publish || !enabled) return;
    publish(id, config);
    return () => publish(id, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publish, id, enabled, ...deps]);
}

/** What the shell should put in the bar right now. */
export function useHeaderSlots(): Slots {
  return useContext(SlotContext)?.slots ?? {};
}
