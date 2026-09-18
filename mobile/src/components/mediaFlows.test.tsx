import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshPages } from '../lib/pagedRefresh';
import { assertActionResults } from '../lib/actionResults';
import { clampViewerSafeBottom, containedMediaSize, viewerMediaViewport, viewerFilmstripBottom, viewerVideoControlsBottom, viewerDockHeight, viewerBottomPanelHeight, VIEWER_FILMSTRIP_HEIGHT, VIEWER_FILMSTRIP_GAP, VIEWER_ACTION_DOCK_HEIGHT } from './viewerGeometry';

const dimensions = vi.hoisted(() => vi.fn(() => ({ width: 402, height: 874, fontScale: 1, scale: 3 })));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' }, View: 'View', Text: 'Text', TextInput: 'TextInput', ScrollView: 'ScrollView', useWindowDimensions: dimensions }));
vi.mock('expo-image', () => ({ Image: 'Image' }));
vi.mock('./Icon', () => ({ Icon: 'Icon' }));
vi.mock('./ui', () => ({
  Sheet: ({ open, children, footer, ...props }: any) => open ? React.createElement('Sheet', props, children, footer) : null,
  Button: (props: any) => React.createElement('Button', props),
  Chip: (props: any) => React.createElement('Chip', props),
  Touchable: (props: any) => React.createElement('Touchable', props, props.children),
}));
vi.mock('../lib/actions', () => ({ actions: {} }));
vi.mock('../lib/api', () => ({
  useResource: (_server: string, path: string | null) => ({ loading: false, error: null,
    data: path?.startsWith('/folders') ? [{id:'folder', name:'Destination', children:[], depth:0}] : [{id:'album',name:'Copy album',assetCount:0}] }),
}));
import { ConfirmSheet, MoveSheet } from './sheets';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: ReactTestRenderer[] = [];
beforeEach(() => { dimensions.mockReturnValue({ width: 402, height: 874, fontScale: 1, scale: 3 }); });
async function render(element: React.ReactElement) {
  let result!: ReactTestRenderer;
  await act(async () => { result = create(element); });
  mounted.push(result);
  return result;
}
async function click(tree: ReactTestRenderer, label: string, type = 'Button') {
  const target = tree.root.findAll((node) => node.type === type && node.props.label === label)[0];
  expect(target, `${type}: ${label}`).toBeTruthy();
  await act(async () => { target.props.onPress(); });
}
afterEach(async () => { for (const tree of mounted.splice(0)) await act(async () => tree.unmount()); });

describe('Move and copy flow', () => {
  it('confirms in the existing sheet, keeps selection until saved, and supports Back', async () => {
    const save = vi.fn().mockResolvedValue(true), close = vi.fn();
    const tree = await render(<MoveSheet open serverUrl="test" count={2} allowAlbums onSelect={save} onClose={close} />);
    await click(tree, 'Destination', 'Touchable');
    expect(tree.root.findAllByType('Sheet' as any)).toHaveLength(1);
    expect(save).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
    await click(tree, 'Back');
    await click(tree, 'Destination', 'Touchable');
    await click(tree, 'Move');
    expect(save).toHaveBeenCalledWith({kind:'folder',id:'folder',name:'Destination'}, false);
    expect(close).toHaveBeenCalledOnce();
  });
  it('copy offers albums and preserves source by passing copy=true', async () => {
    const save=vi.fn().mockResolvedValue(true);
    const tree=await render(<MoveSheet open serverUrl="test" count={1} allowAlbums onSelect={save} onClose={vi.fn()} />);
    await click(tree,'Copy to album','Chip');
    expect(tree.root.findAll((n)=>(n.type as unknown)==='Touchable' && n.props.label==='Destination')).toHaveLength(0);
    await click(tree,'Copy album','Touchable'); await click(tree,'Add to album');
    expect(save).toHaveBeenCalledWith({kind:'album',id:'album',name:'Copy album'},true);
  });
  it('failed move stays open and retries without losing destination', async () => {
    const save=vi.fn().mockRejectedValueOnce(Error('Offline')).mockResolvedValueOnce(true), close=vi.fn();
    const tree=await render(<MoveSheet open serverUrl="test" count={1} allowAlbums onSelect={save} onClose={close} />);
    await click(tree,'Destination','Touchable'); await click(tree,'Move');
    expect(close).not.toHaveBeenCalled(); expect(JSON.stringify(tree.toJSON())).toContain('Offline');
    await click(tree,'Move'); expect(close).toHaveBeenCalledOnce();
  });
});
describe('Destructive confirmation', () => {
  it('has no empty scroll body or uneven button frames at normal phone sizes', async () => {
    const tree = await render(<ConfirmSheet open title="Remove?" description="Not backed up" confirmLabel="Remove" onConfirm={vi.fn()} onClose={vi.fn()} />);
    const sheet = tree.root.findByType('Sheet' as any);
    expect(sheet.props.children[0]).toBeNull();
    const buttons = tree.root.findAllByType('Button' as any);
    expect(sheet.props.children[1].props.style.flexDirection).toBe('row');
    expect(buttons[0].props.style).toEqual({ flex: 1 });
    expect(buttons[1].props.style[0]).toEqual({ flex: 1 });
  });
  it.each([[320, 1], [375, 1], [402, 1.5], [1024, 2]])('stacks actions at width %s and font scale %s', async (width, fontScale) => {
    dimensions.mockReturnValue({ width, fontScale, height: 874, scale: 3 });
    const tree = await render(<ConfirmSheet open title="Remove?" description="Not backed up" confirmLabel="Remove" onConfirm={vi.fn()} onClose={vi.fn()} />);
    const cancel = tree.root.findAllByType('Button' as any)[0];
    expect(tree.root.findByType('Sheet' as any).props.children[1].props.style.flexDirection).toBe('column-reverse');
    expect(cancel.props.style).toBeUndefined();
  });
  it('waits for save, prevents double submission and cancellation during mutation', async () => {
    let resolve!: (value:boolean)=>void;
    const save=vi.fn(()=>new Promise<boolean>(done=>resolve=done)), close=vi.fn();
    const tree=await render(<ConfirmSheet open title="Trash?" description="Recoverable" confirmLabel="Trash" onConfirm={save} onClose={close} />);
    await click(tree,'Trash'); await click(tree,'Saving…');
    await click(tree,'Cancel'); expect(close).not.toHaveBeenCalled(); expect(save).toHaveBeenCalledOnce();
    await act(async()=>resolve(true)); expect(close).toHaveBeenCalledOnce();
  });
  it('does not close on partial/failing bulk changes', async () => {
    const close=vi.fn();
    const tree=await render(<ConfirmSheet open title="Lock?" description="Private" confirmLabel="Lock" onConfirm={async()=>false} onClose={close} />);
    await click(tree,'Lock'); expect(close).not.toHaveBeenCalled();
    expect(JSON.stringify(tree.toJSON())).toContain('could not be saved');
  });
});
describe('Refresh and bulk result safety', () => {
  it('refreshes previously loaded pages without collapsing the list', async () => {
    const fetch=vi.fn(async(page:number)=>({items:[page*2-1,page*2],pagination:{page,size:2,total:8}}));
    expect((await refreshPages(3,fetch)).items).toEqual([1,2,3,4,5,6]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('stops when deletions leave fewer pages', async () => {
    const fetch=vi.fn(async(page:number)=>({items:[1],pagination:{page,size:2,total:1}}));
    expect((await refreshPages(4,fetch)).items).toEqual([1]); expect(fetch).toHaveBeenCalledOnce();
  });
  it('does not publish a partial refresh if a later page fails', async () => {
    await expect(refreshPages(2, async(page)=>{if(page===2)throw Error('Offline');return {items:[1],pagination:{page,size:1,total:2}};})).rejects.toThrow('Offline');
  });
  it('accepts duplicate album membership but rejects permission failures', () => {
    expect(()=>assertActionResults([{success:false,error:'duplicate'}])).not.toThrow();
    expect(()=>assertActionResults([{success:true},{success:false,error:'no_permission'}])).toThrow('1 item');
  });
});
describe('Viewer layout matrix', () => {
  it('lowers the iPhone dock and recovers media height without shrinking touch targets or row gaps', () => {
    const bottom = clampViewerSafeBottom(34, true);
    expect(bottom).toBe(12);
    expect(VIEWER_ACTION_DOCK_HEIGHT).toBe(48);
    for (const video of [false, true]) {
      expect(viewerBottomPanelHeight(34, video) - viewerBottomPanelHeight(bottom, video)).toBe(22);
      expect(viewerMediaViewport(874, 62, bottom, video).height - viewerMediaViewport(874, 62, 34, video).height).toBe(22);
    }
    expect(clampViewerSafeBottom(20, true)).toBe(12);
    expect(clampViewerSafeBottom(0, true)).toBe(0);
    expect(clampViewerSafeBottom(48, false)).toBe(48);
    // With 24pt icons in a 48pt target, their bottom edge is 24pt above
    // the screen edge: clear of the home indicator without a blank footer.
    expect(bottom + (VIEWER_ACTION_DOCK_HEIGHT - 24) / 2).toBe(24);
    expect(viewerBottomPanelHeight(bottom, true)).toBe(184);
    expect(viewerBottomPanelHeight(bottom, false)).toBe(128);
  });
  for(const [width,height,top,bottom] of [[320,568,20,0],[375,812,44,34],[402,874,62,34],[440,956,62,34],[1024,1366,24,20],[1366,1024,24,20]]) {
    for(const [mw,mh] of [[4032,3024],[3024,4032],[1920,1080],[1080,1920],[640,640],[8000,1500],[1000,5000]]) {
      it(`fits ${mw}×${mh} in ${width}×${height} with even bottom gaps`, () => {
        const v=viewerMediaViewport(height,top,bottom); const media=containedMediaSize(width,v.height,mw,mh);
        expect(media.width).toBeLessThanOrEqual(width+0.001); expect(media.height).toBeLessThanOrEqual(v.height+0.001);
        expect(media.width/media.height).toBeCloseTo(mw/mh,5);
        expect(v.top).toBeGreaterThanOrEqual(top + 52);
        expect(v.bottom).toBeLessThanOrEqual(height-viewerFilmstripBottom(bottom)-VIEWER_FILMSTRIP_HEIGHT);
        const video = viewerMediaViewport(height,top,bottom,true);
        expect(video.bottom).toBeLessThanOrEqual(height-viewerVideoControlsBottom(bottom)-48);
        expect(VIEWER_ACTION_DOCK_HEIGHT).toBe(48);
        expect(viewerFilmstripBottom(bottom)-viewerDockHeight(bottom)).toBe(VIEWER_FILMSTRIP_GAP);
        expect(viewerVideoControlsBottom(bottom)-viewerFilmstripBottom(bottom)-VIEWER_FILMSTRIP_HEIGHT).toBe(VIEWER_FILMSTRIP_GAP);
      });
    }
  }
});
