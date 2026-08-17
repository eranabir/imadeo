import { libraryChanged, request } from './api';

/**
 * Every write the app can make, in one place.
 *
 * These are the same endpoints the web client's context menus call, so an
 * action means the same thing on both. Anything that changes the library goes
 * through here rather than being spelled out at the call site — a selection bar
 * and a long-press menu that each built their own request would drift apart the
 * first time one of them gained a confirmation step.
 */
const writes = {
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

  rotateAsset: (server: string, id: string, rotation: 0 | 90 | 180 | 270) =>
    request(server, `/assets/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ rotation }),
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

  share: (server: string, ids: string[], userIds: string[]) =>
    request(server, '/assets/share', {
      method: 'POST',
      body: JSON.stringify({ ids, userIds }),
    }),

  shareAlbum: (server: string, albumId: string, userIds: string[]) =>
    request(server, `/albums/${albumId}/users`, {
      method: 'PUT',
      body: JSON.stringify({ albumUsers: userIds.map((userId) => ({ userId, role: 'VIEWER' })) }),
    }),
  shareFolder: (server: string, folderId: string, userIds: string[]) =>
    request(server, `/folders/${folderId}/users`, {
      method: 'POST',
      body: JSON.stringify({ userIds }),
    }),

  // -- people and pets ------------------------------------------------------

  /**
   * Says these photos are of someone.
   *
   * Sends photos, not detections: the server moves a detection when there is
   * one and records a manual link when there is not, which is what makes this
   * usable on exactly the photos recognition failed on.
   */
  assignSubject: (server: string, subjectId: string, assetIds: string[]) =>
    request(server, `/people-and-pets/${subjectId}/assets`, {
      method: 'POST',
      body: JSON.stringify({ assetIds }),
    }),

  /** Moves known detections instead of adding a second link to the photo. */
  reassignSubject: (server: string, subjectId: string, faceIds: string[]) =>
    request(server, '/people-and-pets/faces/reassign', {
      method: 'POST',
      body: JSON.stringify({ faceIds, personId: subjectId }),
    }),

  createSubject: (server: string, name: string, kind: 'PERSON' | 'PET') =>
    request<{ id: string }>(server, '/people-and-pets', {
      method: 'POST',
      body: JSON.stringify({ name, kind }),
    }),

  renameSubject: (server: string, id: string, name: string) =>
    request(server, `/people-and-pets/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),

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

/**
 * The same writes, each announcing that the library has moved on.
 *
 * Wrapped rather than written into every one of them. There are a dozen here
 * and there will be more, and the one that gets forgotten is the one whose
 * effect never shows up on the screen next door — which is exactly the bug this
 * is here to stop. Only on success: a request that failed changed nothing.
 */
export const actions = Object.fromEntries(
  Object.entries(writes).map(([name, write]) => [
    name,
    async (...args: never[]) => {
      const result = await (write as (...a: never[]) => Promise<unknown>)(...args);
      libraryChanged();
      return result;
    },
  ]),
) as typeof writes;
