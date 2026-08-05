/**
 * Prisma 7 types `Bytes` columns as `Uint8Array<ArrayBuffer>`, while Node's
 * crypto and fs APIs hand back `Buffer`, which is `Uint8Array<ArrayBufferLike>`
 * and therefore not assignable. These two helpers are the only place that
 * mismatch is dealt with.
 */

/** Node Buffer (or any view) -> a plain Uint8Array Prisma will accept. */
export const toBytes = (data: Uint8Array): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(data) as Uint8Array<ArrayBuffer>;

/** Bytes read back from the database -> a Buffer, for hex/base64 formatting. */
export const fromBytes = (data: Uint8Array): Buffer => Buffer.from(data);
