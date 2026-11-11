import { Children, isValidElement, type ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { DARK, radius } from '../theme';
import { Glass } from './Glass';
import { ViewerAction, ViewerActionGroup } from './ViewerButton';
import { filmstripViewportWidth } from './filmstripGeometry';
import { ViewerFilmstrip, type ViewerFilmstripItem } from './ViewerFilmstrip';
import {
  VIEWER_FILMSTRIP_HEIGHT,
  VIEWER_HEADER_HEIGHT,
  viewerChromeFrame,
  viewerHeaderTop,
  viewerRailFrame,
} from './viewerGeometry';

interface ChromeProps {
  visible: boolean;
  width: number;
  height: number;
  insets: { top: number; left: number; right: number };
}

/** Metadata is centered over the photo; navigation belongs to the side rail. */
export function ViewerHeader({ visible, width, insets, title, subtitle }: ChromeProps & {
  title: string;
  subtitle: string;
}) {
  const frame = viewerChromeFrame(width, insets.left, insets.right);
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: viewerHeaderTop(insets.top), ...frame,
      height: VIEWER_HEADER_HEIGHT, display: visible ? 'flex' : 'none', alignItems: 'center' }}>
      <Glass radius={radius.pill}
        style={{ maxWidth: '100%', alignItems: 'center', justifyContent: 'center', height: VIEWER_HEADER_HEIGHT, paddingHorizontal: 20 }}>
        <Text numberOfLines={1} style={{ color: DARK.text, fontSize: 14, fontWeight: '700' }}>{title}</Text>
        {!!subtitle && <Text numberOfLines={1} style={{ color: DARK.muted, fontSize: 11.5, marginTop: 2 }}>{subtitle}</Text>}
      </Glass>
    </View>
  );
}

/** One trailing axis for navigation, grouped actions and deletion, as in Photos. */
export function ViewerDock({ visible, width, height, insets, safeBottom, items, current, onSelect, onClose, children }: ChromeProps & {
  safeBottom: number;
  items: ViewerFilmstripItem[];
  current: number;
  onSelect: (index: number) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const rail = viewerRailFrame(width, height, insets, safeBottom);
  const frame = viewerChromeFrame(width, insets.left, Math.max(insets.right, rail.right + rail.width));
  const stripWidth = filmstripViewportWidth(frame.width, items.length);
  const stripFrame = { left: frame.left + (frame.width - stripWidth) / 2, width: stripWidth };
  const actions = Children.toArray(children);
  const icon = (node: ReactNode) => isValidElement<{ icon?: string }>(node) ? node.props.icon : undefined;
  const deviceActions = actions.some(node => ['backup', 'cloud-done'].includes(icon(node) ?? ''));
  const primaryIcons = ['shared', 'download', 'backup', 'cloud-done', ...(deviceActions ? ['info'] : [])];
  const primary = actions.filter(node => primaryIcons.includes(icon(node) ?? ''));
  const tools = actions.filter(node => ![...primaryIcons, 'trash'].includes(icon(node) ?? ''));
  const trash = actions.filter(node => icon(node) === 'trash');
  return <>
    <View style={{ position: 'absolute', bottom: safeBottom + 12, ...stripFrame,
      height: VIEWER_FILMSTRIP_HEIGHT, display: visible ? 'flex' : 'none' }}>
      <ViewerFilmstrip width={stripWidth} items={items} current={current} onSelect={onSelect} />
    </View>
    <View pointerEvents="box-none" style={{ position: 'absolute', ...rail, display: visible ? 'flex' : 'none' }}>
      <ScrollView showsVerticalScrollIndicator={false} bounces={false}
        contentInsetAdjustmentBehavior="never" contentContainerStyle={{ flexGrow: 1, gap: 12, alignItems: 'center' }}>
        <ViewerActionGroup><ViewerAction icon="back" label="Close" onPress={onClose} /></ViewerActionGroup>
        {primary.length > 0 && <ViewerActionGroup>{primary}</ViewerActionGroup>}
        <View pointerEvents="none" style={{ flexGrow: 1 }} />
        {tools.length > 0 && <ViewerActionGroup>{tools}</ViewerActionGroup>}
        {trash.length > 0 && <ViewerActionGroup>{trash}</ViewerActionGroup>}
      </ScrollView>
    </View>
  </>;
}
