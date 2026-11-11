import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { DARK, radius } from '../theme';
import { Glass } from './Glass';
import { ViewerAction } from './ViewerButton';
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

/** Floating metadata and native navigation over the full-screen photo. */
export function ViewerHeader({ visible, width, insets, title, subtitle, onClose }: ChromeProps & {
  title: string;
  subtitle: string;
  onClose: () => void;
}) {
  const frame = viewerChromeFrame(width, insets.left, insets.right);
  return (
    <View style={{ position: 'absolute', top: viewerHeaderTop(insets.top), ...frame,
      height: VIEWER_HEADER_HEIGHT, display: visible ? 'flex' : 'none' }}>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <ViewerAction icon="back" label="Close" onPress={onClose} />
        <Glass colorScheme="dark" tint="transparent" radius={radius.pill}
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', height: VIEWER_HEADER_HEIGHT, paddingHorizontal: 16 }}>
          <Text numberOfLines={1} style={{ color: DARK.text, fontSize: 14, fontWeight: '700' }}>{title}</Text>
          {!!subtitle && <Text numberOfLines={1} style={{ color: DARK.muted, fontSize: 11.5, marginTop: 2 }}>{subtitle}</Text>}
        </Glass>
        <View pointerEvents="none" style={{ width: 44 }} />
      </View>
    </View>
  );
}

/** Thumbnails float above independent native action buttons. */
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
      <View style={{ flex: 1 }}>
        <ViewerFilmstrip width={frame.width} items={items} current={current} onSelect={onSelect} />
        <View style={{ marginTop: VIEWER_FILMSTRIP_GAP, height: VIEWER_ACTION_DOCK_HEIGHT,
          paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {children}
        </View>
      </View>
    </View>
  );
}
