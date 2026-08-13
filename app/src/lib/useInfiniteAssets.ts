import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from './api';
import type { Asset, Paginated } from '../types';

const PAGE_SIZE = 150;

/**
 * Keeps only the API pages reached by the scroll, rather than treating an
 * arbitrary first 500 photos as a library. The grid virtualizes the DOM; this
 * hook virtualizes the network payload behind it.
 */
export function useInfiniteAssets(
  queryKey: readonly unknown[],
  params: Record<string, string | number | boolean | undefined> = {},
) {
  return useInfiniteQuery({
    queryKey,
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      (
        await api.get<Paginated<Asset>>('/assets', {
          params: { ...params, page: pageParam, size: PAGE_SIZE },
        })
      ).data,
    getNextPageParam: (last) =>
      last.pagination.page < last.pagination.pages ? last.pagination.page + 1 : undefined,
  });
}
