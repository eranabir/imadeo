import { usePagedResource, type Asset } from './api';

export function useDeviceAssets(serverUrl: string, deviceId: string, sort: 'date' | 'name' | 'type', order: 'asc' | 'desc') {
  return usePagedResource<Asset>(serverUrl,
    `/assets?deviceId=${encodeURIComponent(deviceId)}&sortBy=${sort}&order=${order}`);
}
