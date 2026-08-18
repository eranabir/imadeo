import axios, { AxiosError, type AxiosAdapter } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

const originalAdapter = api.defaults.adapter;

afterEach(() => {
  api.defaults.adapter = originalAdapter;
  vi.restoreAllMocks();
});

describe('session refresh', () => {
  it('refreshes an expired access cookie during the startup session probe', async () => {
    let attempts = 0;
    api.defaults.adapter = (async (config) => {
      attempts += 1;
      if (attempts === 1) {
        throw new AxiosError('Unauthorized', AxiosError.ERR_BAD_REQUEST, config, undefined, {
          status: 401,
          statusText: 'Unauthorized',
          headers: {},
          config,
          data: { message: 'Authentication required' },
        });
      }
      return { status: 200, statusText: 'OK', headers: {}, config, data: { id: 'user-1' } };
    }) satisfies AxiosAdapter;
    const refresh = vi.spyOn(axios, 'post').mockResolvedValue({ data: { successful: true } });

    const response = await api.get('/users/me');

    expect(response.data).toEqual({ id: 'user-1' });
    expect(attempts).toBe(2);
    expect(refresh).toHaveBeenCalledWith('/api/auth/refresh', undefined, expect.objectContaining({
      withCredentials: true,
    }));
  });
});
