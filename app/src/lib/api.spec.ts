import axios, { AxiosError, type AxiosAdapter } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ensureFreshBrowserSession } from './api';

const originalAdapter = api.defaults.adapter;

afterEach(() => {
  api.defaults.adapter = originalAdapter;
  vi.restoreAllMocks();
});

describe('session refresh', () => {
  it('refreshes once before concurrent uploads and reuses the fresh session', async () => {
    const refresh = vi.spyOn(axios, 'post').mockResolvedValue({ data: { successful: true } });

    await Promise.all([
      ensureFreshBrowserSession(0),
      ensureFreshBrowserSession(0),
      ensureFreshBrowserSession(0),
    ]);
    await ensureFreshBrowserSession();

    expect(refresh).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledWith('/api/auth/refresh', undefined, expect.objectContaining({
      withCredentials: true,
    }));
  });

  it('does not end the signed-in session when refresh is interrupted by the network', async () => {
    const interrupted = new AxiosError('Network interrupted', AxiosError.ERR_NETWORK);
    vi.spyOn(axios, 'post').mockRejectedValue(interrupted);

    await expect(ensureFreshBrowserSession(0)).rejects.toBe(interrupted);
  });

  it('keeps a valid access session when another tab already rotated the refresh token', async () => {
    const rejected = new AxiosError('Forbidden', AxiosError.ERR_BAD_REQUEST, undefined, undefined, {
      status: 403,
      statusText: 'Forbidden',
      headers: {},
      config: {} as never,
      data: { message: 'Session expired' },
    });
    vi.spyOn(axios, 'post').mockRejectedValue(rejected);
    const accessProbe = vi.spyOn(axios, 'get').mockResolvedValue({ data: { id: 'user-1' } });

    await expect(ensureFreshBrowserSession(0)).resolves.toBeUndefined();

    expect(accessProbe).toHaveBeenCalledWith('/api/users/me', expect.objectContaining({
      withCredentials: true,
    }));
  });

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
