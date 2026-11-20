import { useCallback, useMemo } from 'react';
import { Platform } from 'react-native';
import { Query, AssetField, MediaType, type AssetMetadata } from 'expo-media-library';
import * as Legacy from 'expo-media-library/legacy';
import { usePageWindow } from './usePageWindow';
import { readLocalDevicePage } from './localDeviceMedia';

const SIZE = 60;
function legacyAsset(item: AssetMetadata): Legacy.Asset {
  const id = Platform.OS === 'ios' ? item.id.replace(/^ph:\/\//, '') : item.id;
  return { id, filename: item.filename ?? item.id,
    uri: Platform.OS === 'ios' ? `ph://${id}` : item.id,
    mediaType: item.mediaType === MediaType.VIDEO ? 'video' : 'photo',
    mediaSubtypes: [], width: item.width ?? 0, height: item.height ?? 0,
    creationTime: item.creationTime ?? 0, modificationTime: item.modificationTime ?? 0,
    duration: (item.duration ?? 0) / 1000 };
}

/** PhotoKit offset queries read the requested metadata, never preceding images. */
export function useLocalPhotoIndex(enabled: boolean, sort: 'date' | 'name' | 'type', order: 'asc' | 'desc',
  excluded: Set<string>, exclusionRevision: number) {
  const loader = useMemo(() => {
    let index: Promise<Legacy.Asset[]> | null = null;
    const query = () => {
      const q = new Query().within(AssetField.MEDIA_TYPE, [MediaType.IMAGE, MediaType.VIDEO]);
      if (sort === 'type') q.orderBy({ key: AssetField.MEDIA_TYPE, ascending: order === 'asc' });
      return q.orderBy({ key: AssetField.CREATION_TIME, ascending: sort === 'type' ? false : order === 'asc' });
    };
    return { reset: () => { index = null; }, fetch: async (page: number, signal: AbortSignal) => {
      if (signal.aborted) throw new Error('Cancelled');
      // Photos cannot natively order by filename or filter our app exclusions.
      // Those cases need a lightweight metadata index, not decoded images.
      if (sort === 'name' || excluded.size > 0 || Platform.OS !== 'ios') {
        index ??= (async () => {
          let items: Legacy.Asset[];
          if (Platform.OS === 'ios') items = (await query().exeForMetadata()).map(legacyAsset).filter(item => !excluded.has(item.id));
          else {
            const first = await readLocalDevicePage(Legacy.getAssetsAsync, 'name', order, 1000, undefined, () => !signal.aborted, excluded);
            items = first?.assets ?? [];
          }
          const direction = order === 'asc' ? 1 : -1;
          if (sort === 'name') items.sort((a, b) => direction * a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: 'base' }));
          if (Platform.OS !== 'ios' && sort !== 'name') items.sort((a, b) => sort === 'date'
            ? direction * (a.creationTime - b.creationTime) : direction * a.mediaType.localeCompare(b.mediaType) || b.creationTime - a.creationTime);
          return items;
        })();
        const items = await index;
        return { items: items.slice((page - 1) * SIZE, page * SIZE), total: items.length };
      }
      const [items, count] = await Promise.all([
        query().offset((page - 1) * SIZE).limit(SIZE).exeForMetadata(),
        Legacy.getAssetsAsync({ first: 1, mediaType: ['photo', 'video'] }),
      ]);
      return { items: items.map(legacyAsset), total: count.totalCount };
    } };
  }, [sort, order, excluded, exclusionRevision]);
  const resource = usePageWindow(`phone-${sort}-${order}-${exclusionRevision}`, loader.fetch, enabled, SIZE);
  const reload = useCallback(async () => { loader.reset(); await resource.reload(); }, [loader, resource.reload]);
  return { ...resource, reload };
}
