import * as lz4 from 'lz4js';
import {
  type BenTenError,
  ErrorCode,
  createError,
} from '../infrastructure/errors.js';
import { type Result, err, ok } from '../infrastructure/result.js';

/**
 * Service for compressing and decompressing binary data using LZ4.
 */
export interface CompressionService {
  /**
   * Compresses data using LZ4 algorithm.
   *
   * @param data - The data to compress
   * @returns Compressed buffer or error
   */
  compress(data: Buffer): Result<Buffer, BenTenError>;

  /**
   * Decompresses LZ4-compressed data.
   *
   * @param data - The compressed data
   * @returns Decompressed buffer or error
   */
  decompress(data: Buffer): Result<Buffer, BenTenError>;
}

/**
 * Creates a compression service using LZ4 algorithm.
 *
 * @returns A CompressionService instance
 * @example
 * const compression = createCompressionService();
 * const compressed = compression.compress(Buffer.from('hello'));
 * if (compressed.ok) {
 *   const decompressed = compression.decompress(compressed.value);
 * }
 */
export const createCompressionService = (): CompressionService => {
  const service: CompressionService = {
    compress(data) {
      try {
        // Handle empty buffer
        if (data.length === 0) {
          return ok(Buffer.alloc(0));
        }

        // lz4js expects Uint8Array
        const input = new Uint8Array(data);
        const compressed = lz4.compress(input);

        return ok(Buffer.from(compressed));
      } catch (e) {
        return err(
          createError(ErrorCode.SERIALIZE_FAILED, 'Failed to compress data', {
            error: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    },

    decompress(data) {
      try {
        // Handle empty buffer
        if (data.length === 0) {
          return ok(Buffer.alloc(0));
        }

        // lz4js expects Uint8Array
        const input = new Uint8Array(data);
        const decompressed = lz4.decompress(input);

        return ok(Buffer.from(decompressed));
      } catch (e) {
        return err(
          createError(
            ErrorCode.DESERIALIZE_FAILED,
            'Failed to decompress data',
            { error: e instanceof Error ? e.message : String(e) },
          ),
        );
      }
    },
  };

  return service;
};
