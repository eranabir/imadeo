import type { Server } from 'node:http';

/**
 * Large originals can take hours over a remote or slow home connection.
 * Node's five-minute request deadline otherwise resets a healthy multipart
 * upload while Nginx and the browser are still streaming it.
 *
 * Header and proxy inactivity limits remain in place, so stalled clients are
 * still closed without imposing a total-duration limit on active uploads.
 */
export function allowLongRunningUploads(server: Server) {
  server.requestTimeout = 0;
}
