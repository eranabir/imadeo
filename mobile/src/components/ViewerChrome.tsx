import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { DARK, radius } from '../theme';
import { Glass } from './Glass';
import { Icon } from './Icon';
import { Touchable } from './ui';
import { ViewerFilmstrip, type ViewerFilmstripItem } from './ViewerFilmstrip';
import {
  VIEWER_ACTION_DOCK_HEIGHT,
  VIEWER_FILMSTRIP_GAP,
  VIEWER_FILMSTRIP_HEIGHT,
  VIEWER_HEADER_HEIGHT,
  viewerChromeFrame,
  viewerHeaderTop,
} from './viewerGeometry';

interface ChromeProps {
  visible: boolean;
  width: number;
  insets: { top: number; left: number; right: number };
}

/** The viewer always has a dark letterbox, independent of the app's theme. */
export function ViewerHeader({ visible, width, insets, title, subtitle, onClose }: ChromeProps & {
  title: string;
  subtitle: string;
  onClose: () => void;
}) {
  const frame = viewerChromeFrame(width, insets.left, insets.right);
  return (
    <View style={{ position: 'absolute', top: viewerHeaderTop(insets.top), ...frame,
      height: VIEWER_HEADER_HEIGHT, display: visible ? 'flex' : 'none' }}>
      <Glass colorScheme="dark" tint="transparent" interactive radius={radius.lg}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 }}>
        <Touchable onPress={onClose} radius={radius.pill} label="Close" style={{ width: 44, height: 44 }}>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="close" size={24} color={DARK.text} />
          </View>
        </Touchable>
        <View pointerEvents="none" style={{ flex: 1, alignItems: 'center', paddingHorizontal: 8 }}>
          <Text numberOfLines={1} style={{ color: DARK.text, fontSize: 14, fontWeight: '700' }}>{title}</Text>
          {!!subtitle && <Text numberOfLines={1} style={{ color: DARK.muted, fontSize: 11.5, marginTop: 2 }}>{subtitle}</Text>}
        </View>
        <View pointerEvents="none" style={{ width: 44 }} />
      </Glass>
    </View>
  );
}

/** One material groups navigation through media and the actions on that media. */
export function ViewerDock({ visible, width, insets, safeBottom, items, current, onSelect, children }: ChromeProps & {
  safeBottom: number;
  items: ViewerFilmstripItem[];
  current: number;
  onSelect: (index: number) => void;
  children: ReactNode;
}) {
  const frame = viewerChromeFrame(width, insets.left, insets.right);
  return (
    <View style={{ position: 'absolute', bottom: safeBottom, ...frame,
      height: VIEWER_FILMSTRIP_HEIGHT + VIEWER_FILMSTRIP_GAP + VIEWER_ACTION_DOCK_HEIGHT,
      display: visible ? 'flex' : 'none' }}>
      <Glass colorScheme="dark" tint="transparent" interactive radius={radius.lg} style={{ flex: 1 }}>
        <ViewerFilmstrip width={frame.width} items={items} current={current} onSelect={onSelect} />
        <View style={{ marginTop: VIEWER_FILMSTRIP_GAP, height: VIEWER_ACTION_DOCK_HEIGHT,
          paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {children}
        </View>
      </Glass>
    </View>
  );
}
