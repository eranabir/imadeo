import { Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { rename, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

/**
 * Encryption at rest for vault content.
 *
 * AES-256-CTR rather than GCM. GCM is the better default, but it cannot be
 * decrypted from an arbitrary offset, and video playback depends on HTTP range
 * requests seeking into the middle of a file. CTR is seekable: the counter for
 * byte N is simply IV + floor(N / 16).
 *
 * The trade-off is that CTR gives confidentiality but not integrity — it does
 * not detect deliberate tampering with the ciphertext. That is the right call
 * here: the threat being defended against is someone reading files off the
 * disk, and an attacker who can *write* to the media directory has already won
 * in other ways. This is documented rather than silently assumed.
 *
 * The key never comes from the server config alone: it is the per-user content
 * key, which is unwrapped with the user's PIN and held only in memory. A stolen
 * disk plus a stolen .env still cannot decrypt vault content without the PIN.
 */
@Injectable()
export class VaultCryptoService {
  private readonly logger = new Logger(VaultCryptoService.name);

  private static readonly ALGORITHM = 'aes-256-ctr';
  private static readonly IV_BYTES = 16;
  private static readonly BLOCK = 16;

  newIv() {
    return randomBytes(VaultCryptoService.IV_BYTES);
  }

  /**
   * Advances the CTR counter so decryption can start at an arbitrary byte.
   * The counter is the IV read as a big-endian 128-bit integer.
   */
  private counterAt(iv: Uint8Array, byteOffset: number) {
    const blocks = BigInt(Math.floor(byteOffset / VaultCryptoService.BLOCK));
    const counter = BigInt(`0x${Buffer.from(iv).toString('hex')}`) + blocks;

    const hex = (counter & ((1n << 128n) - 1n)).toString(16).padStart(32, '0');
    return Buffer.from(hex, 'hex');
  }

  /** Encrypts a file in place, leaving the plaintext removed. */
  async encryptFile(path: string, key: Uint8Array, iv: Uint8Array) {
    const temporary = `${path}.enc`;
    const cipher = createCipheriv(VaultCryptoService.ALGORITHM, key, Buffer.from(iv));

    await pipeline(createReadStream(path), cipher, createWriteStream(temporary));
    await rename(temporary, path);
  }

  /** Decrypts a file in place, for taking something back out of the vault. */
  async decryptFile(path: string, key: Uint8Array, iv: Uint8Array) {
    const temporary = `${path}.dec`;
    const decipher = createDecipheriv(VaultCryptoService.ALGORITHM, key, Buffer.from(iv));

    await pipeline(createReadStream(path), decipher, createWriteStream(temporary));
    await rename(temporary, path);
  }

  /**
   * A readable stream of plaintext for a byte range of an encrypted file.
   * `start` is an offset into the *plaintext*, which for CTR is the same offset
   * in the ciphertext.
   */
  decryptStream(
    path: string,
    key: Uint8Array,
    iv: Uint8Array,
    range?: { start: number; end: number },
  ): Readable {
    const start = range?.start ?? 0;

    // The counter only advances per 16-byte block, so a range starting
    // mid-block has to begin at the block boundary and drop the extra bytes.
    const blockStart = Math.floor(start / VaultCryptoService.BLOCK) * VaultCryptoService.BLOCK;
    const discard = start - blockStart;

    const source = createReadStream(path, {
      start: blockStart,
      end: range?.end,
    });

    const decipher = createDecipheriv(
      VaultCryptoService.ALGORITHM,
      key,
      this.counterAt(iv, blockStart),
    );

    const plain = source.pipe(decipher);
    if (discard === 0) return plain;

    let remaining = discard;
    const { Transform } = require('node:stream') as typeof import('node:stream');

    return plain.pipe(
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          if (remaining > 0) {
            const drop = Math.min(remaining, chunk.length);
            remaining -= drop;
            chunk = chunk.subarray(drop);
          }
          callback(null, chunk.length > 0 ? chunk : undefined);
        },
      }),
    );
  }

  /** Best-effort cleanup of a half-written temporary file. */
  async discard(path: string) {
    await unlink(path).catch(() => undefined);
  }
}
