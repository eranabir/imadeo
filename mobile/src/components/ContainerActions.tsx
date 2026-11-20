import { useEffect, useState } from 'react';
import { actions } from '../lib/actions';
import { useSelectionBar, useSelectionDock } from '../selection';
import { Dock, ToolbarAction } from './PhotoActions';
import { ConfirmSheet } from './sheets';

export type ContainerTarget = { kind: 'folder' | 'album'; id: string; name: string; shared?: boolean };
const same = (a: ContainerTarget, b: ContainerTarget) => a.kind === b.kind && a.id === b.id;

export function useContainerSelection(clearPhotos: () => void) {
  const [items, setItems] = useState<ContainerTarget[]>([]);
  const clear = () => setItems([]);
  const remove = (item: ContainerTarget) => setItems(old => old.filter(other => !same(other, item)));
  function bind(kind: ContainerTarget['kind'], data: { id: string; name: string }, readOnly = false) {
    const item = { id: data.id, name: data.name, kind };
    const toggle = () => {
      if (readOnly) return;
      clearPhotos();
      setItems(old => old.some(other => same(other, item))
        ? old.filter(other => !same(other, item)) : [...old, item]);
    };
    return {
      selected: items.length ? items.some(other => same(other, item)) : undefined,
      onSelect: items.length ? toggle : undefined,
      onLongPress: readOnly ? undefined : toggle,
    };
  }
  return { items, clear, remove, bind };
}

export function ContainerActions({ selection, serverUrl, reload, onOptions }: {
  selection: ReturnType<typeof useContainerSelection>;
  serverUrl: string; reload: () => unknown; onOptions?: (item: ContainerTarget) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const { setActive } = useSelectionBar();
  useEffect(() => { setActive(true); return () => setActive(false); }, [setActive]);
  const { items, clear, remove } = selection;
  useSelectionDock(<Dock count={items.length} onClear={clear}>
    {onOptions && items.length === 1 && <ToolbarAction icon="edit" label="Options" onPress={() => onOptions(items[0])} />}
    <ToolbarAction icon="trash" label="Trash" danger onPress={() => setConfirm(true)} />
  </Dock>, [items, onOptions]);
  return <ConfirmSheet open={confirm} title={`Move ${items.length} selected ${items.length === 1 ? 'item' : 'items'} to Trash?`}
    description="Selected folders, albums and their contents move to Trash. You can restore them for 30 days."
    confirmLabel="Move to Trash" onClose={() => setConfirm(false)}
    onConfirm={async () => {
      try {
        for (const item of items) {
          if (item.kind === 'folder') await actions.deleteFolder(serverUrl, item.id);
          else await actions.deleteAlbum(serverUrl, item.id);
          remove(item);
        }
      } finally { await reload(); }
    }} />;
}
