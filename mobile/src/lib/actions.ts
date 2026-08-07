import { request } from './api';

/**
 * Every write the app can make, in one place.
 *
 * These are the same endpoints the web client's context menus call, so an
 * action means the same thing on both. Anything that changes the library goes
 * through here rather than being spelled out at the call site — a selection bar
 * and a long-press menu that each built their own request would drift apart the
 * first time one of them gained a confirmation step.
 */
export const actions = {
  // -- photos ---------------------------------------------------------------

  favorite: (server: string, ids: string[], isFavorite: boolean) =>
    request(server, '/assets/bulk', {
      method: 'PUT',
      body: JSON.stringify({ ids, isFavorite }),
    }),

  archive: (server: string, ids: string[], archived: boolean) =>
    request(server, '/assets/bulk', {
      method: 'PUT',
      body: JSON.stringify({ ids, visibility: archived ? 'ARCHIVE' : 'TIMELINE' }),
    }),

  /** Recoverable for 30 days. Permanent deletion is a web-only action for now. */
  trash: (server: string, ids: string[]) =>
    request(server, '/assets', { method: 'DELETE', body: JSON.stringify({ ids }) }),

  renameAsset: (server: string, id: string, name: string) =>
    request(server, `/assets/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ originalFileName: name }),
    }),

  /**
   * Files photos under a folder, or takes them out of one.
   *
   * The root is not a folder with an id, so moving there is a bulk edit that
   * clears the field rather than a call to a folder's own endpoint.
   */
  toFolder: (server: string, folderId: string | null, ids: string[]) =>
    folderId
      ? request(server, `/folders/${folderId}/assets`, {
          method: 'PUT',
          body: JSON.stringify({ assetIds: ids }),
        })
      : request(server, '/assets/bulk', {
          method: 'PUT',
          body: JSON.stringify({ ids, folderId: null }),
        }),

  toAlbum: (server: string, albumId: string, ids: string[]) =>
    request(server, `/albums/${albumId}/assets`, {
      method: 'PUT',
      body: JSON.stringify({ assetIds: ids }),
    }),

  // -- people and pets ------------------------------------------------------

  /**
   * Says these photos are of someone.
   *
   * Sends photos, not detections: the server moves a detection when there is
   * one and records a manual link when there is not, which is what makes this
   * usable on exactly the photos recognition failed on.
   */
  assignSubject: (server: string, personId: string, assetIds: string[]) =>
    request(server, `/people/${personId}/assets`, {
      method: 'POST',
      body: JSON.stringify({ assetIds }),
    }),

  createSubject: (server: string, name: string, kind: 'PERSON' | 'PET') =>
    request<{ id: string }>(server, '/people', {
      method: 'POST',
      body: JSON.stringify({ name, kind }),
    }),

  renameSubject: (server: string, id: string, name: string) =>
    request(server, `/people/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),

  // -- folders --------------------------------------------------------------

  createFolder: (server: string, name: string, parentId: string | null) =>
    request(server, '/folders', {
      method: 'POST',
      body: JSON.stringify({ name, parentId: parentId ?? undefined }),
    }),

  renameFolder: (server: string, id: string, name: string) =>
    request(server, `/folders/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),

  moveFolder: (server: string, id: string, parentId: string | null) =>
    request(server, `/folders/${id}/move`, { method: 'PUT', body: JSON.stringify({ parentId }) }),

  deleteFolder: (server: string, id: string) =>
    request(server, `/folders/${id}`, { method: 'DELETE' }),

  // -- albums ---------------------------------------------------------------

  createAlbum: (server: string, albumName: string, folderId: string | null) =>
    request(server, '/albums', { method: 'POST', body: JSON.stringify({ albumName, folderId }) }),

  renameAlbum: (server: string, id: string, albumName: string) =>
    request(server, `/albums/${id}`, { method: 'PUT', body: JSON.stringify({ albumName }) }),

  moveAlbum: (server: string, id: string, folderId: string | null) =>
    request(server, `/albums/${id}`, { method: 'PUT', body: JSON.stringify({ folderId }) }),

  deleteAlbum: (server: string, id: string) =>
    request(server, `/albums/${id}`, { method: 'DELETE' }),
};
