import { describe, expect, it, vi } from 'vitest';
import { DRAG_TYPE } from './dnd';
import { handleInternalDrop } from './useDropTarget';

function dragEvent(types: string[], payload = '') {
  return {
    dataTransfer: {
      types,
      getData: vi.fn().mockReturnValue(payload),
    },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.DragEvent;
}

describe('library drop targets', () => {
  it('leaves Finder and Explorer file drops for the global uploader', () => {
    const event = dragEvent(['Files']);
    const onDrop = vi.fn();

    expect(handleInternalDrop(event, onDrop)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('handles Imadeo items without letting them reach the uploader', () => {
    const payload = { kind: 'folder', ids: ['folder-id'], label: 'Birthdays' };
    const event = dragEvent([DRAG_TYPE], JSON.stringify(payload));
    const onDrop = vi.fn();

    expect(handleInternalDrop(event, onDrop)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(onDrop).toHaveBeenCalledWith(payload);
  });
});
