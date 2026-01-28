import type { ContextData } from '../core/types.js';
import { parseContextData } from '../core/types.js';
import {
  type BenTenError,
  ErrorCode,
  createError,
} from '../infrastructure/errors.js';
import { type Result, err, ok } from '../infrastructure/result.js';
import { createCompressionService } from './compression-service.js';

/** Magic header identifying Ben-Ten compressed format: "BT10" */
export const MAGIC_HEADER = 'BT10';

/** Current format version */
export const FORMAT_VERSION = 0x01;

/** Compression type identifiers */
export const COMPRESSION_TYPE = {
  NONE: 0x00,
  LZ4: 0x01,
  ZSTD: 0x02,
} as const;

/** Header size in bytes: 4 (magic) + 1 (version) + 1 (compression) + 4 (size) = 10 */
const HEADER_SIZE = 10;

/** Detected format types */
export type FormatType = 'compressed' | 'json' | 'unknown';

/**
 * Service for serializing and deserializing context data.
 */
export interface SerializerService {
  /**
   * Serializes context data to compressed binary format.
   *
   * @param data - The context data to serialize
   * @returns Compressed binary buffer with header or error
   */
  serialize(data: ContextData): Result<Buffer, BenTenError>;

  /**
   * Deserializes compressed binary format back to context data.
   *
   * @param buffer - The compressed binary data with header
   * @returns Context data or error
   */
  deserialize(buffer: Buffer): Result<ContextData, BenTenError>;

  /**
   * Deserializes JSON format to context data.
   *
   * @param buffer - The JSON data as buffer
   * @returns Context data or error
   */
  deserializeJson(buffer: Buffer): Result<ContextData, BenTenError>;

  /**
   * Detects the format of the given buffer.
   *
   * @param buffer - The data to check
   * @returns The detected format type
   */
  detectFormat(buffer: Buffer): FormatType;
}

/**
 * Creates a serializer service for context data.
 *
 * File format:
 * - Bytes 0-3: Magic header "BT10"
 * - Byte 4: Format version (0x01)
 * - Byte 5: Compression type (0x01 = LZ4)
 * - Bytes 6-9: Uncompressed size (uint32 LE)
 * - Bytes 10+: Compressed data
 *
 * @returns A SerializerService instance
 * @example
 * const serializer = createSerializerService();
 * const result = serializer.serialize(contextData);
 * if (result.ok) {
 *   await fs.writeFileBuffer('context.ctx', result.value);
 * }
 */
export const createSerializerService = (): SerializerService => {
  const compression = createCompressionService();

  const service: SerializerService = {
    serialize(data) {
      try {
        // Convert to JSON
        const json = JSON.stringify(data);
        const jsonBuffer = Buffer.from(json, 'utf-8');
        const uncompressedSize = jsonBuffer.length;

        // Compress with LZ4
        const compressResult = compression.compress(jsonBuffer);
        if (!compressResult.ok) {
          return compressResult;
        }

        // Build header
        const header = Buffer.alloc(HEADER_SIZE);
        header.write(MAGIC_HEADER, 0, 4, 'ascii');
        header[4] = FORMAT_VERSION;
        header[5] = COMPRESSION_TYPE.LZ4;
        header.writeUInt32LE(uncompressedSize, 6);

        // Combine header and compressed data
        return ok(Buffer.concat([header, compressResult.value]));
      } catch (e) {
        return err(
          createError(
            ErrorCode.SERIALIZE_FAILED,
            'Failed to serialize context data',
            {
              error: e instanceof Error ? e.message : String(e),
            },
          ),
        );
      }
    },

    deserialize(buffer) {
      try {
        // Check minimum size
        if (buffer.length < HEADER_SIZE) {
          return err(
            createError(
              ErrorCode.DESERIALIZE_FAILED,
              'Data too short: missing header',
              { size: buffer.length, minSize: HEADER_SIZE },
            ),
          );
        }

        // Validate magic header
        const magic = buffer.subarray(0, 4).toString('ascii');
        if (magic !== MAGIC_HEADER) {
          return err(
            createError(
              ErrorCode.DESERIALIZE_FAILED,
              `Invalid magic header: expected "${MAGIC_HEADER}", got "${magic}"`,
              { expected: MAGIC_HEADER, actual: magic },
            ),
          );
        }

        // Validate format version
        const version = buffer[4];
        if (version !== FORMAT_VERSION) {
          return err(
            createError(
              ErrorCode.DESERIALIZE_FAILED,
              `Unsupported format version: ${version}`,
              { expected: FORMAT_VERSION, actual: version },
            ),
          );
        }

        // Validate compression type
        const compressionType = buffer[5];
        if (compressionType !== COMPRESSION_TYPE.LZ4) {
          return err(
            createError(
              ErrorCode.DESERIALIZE_FAILED,
              `Unsupported compression type: ${compressionType}`,
              { expected: COMPRESSION_TYPE.LZ4, actual: compressionType },
            ),
          );
        }

        // Read uncompressed size
        const uncompressedSize = buffer.readUInt32LE(6);

        // Extract compressed data
        const compressedData = buffer.subarray(HEADER_SIZE);

        // Decompress
        const decompressResult = compression.decompress(compressedData);
        if (!decompressResult.ok) {
          return err(
            createError(
              ErrorCode.DESERIALIZE_FAILED,
              'Failed to decompress data',
              { originalError: decompressResult.error.message },
            ),
          );
        }

        // Verify size
        if (decompressResult.value.length !== uncompressedSize) {
          return err(
            createError(
              ErrorCode.DESERIALIZE_FAILED,
              'Size mismatch after decompression',
              {
                expected: uncompressedSize,
                actual: decompressResult.value.length,
              },
            ),
          );
        }

        // Parse JSON
        const json = decompressResult.value.toString('utf-8');
        let parsed: unknown;
        try {
          parsed = JSON.parse(json);
        } catch (e) {
          return err(
            createError(
              ErrorCode.DESERIALIZE_FAILED,
              'Invalid JSON in decompressed data',
              { error: e instanceof Error ? e.message : String(e) },
            ),
          );
        }

        // Validate context structure
        const validateResult = parseContextData(parsed);
        if (!validateResult.ok) {
          return err(
            createError(
              ErrorCode.DESERIALIZE_FAILED,
              'Invalid context data structure',
              { validationErrors: validateResult.error.details },
            ),
          );
        }

        return ok(validateResult.value);
      } catch (e) {
        return err(
          createError(
            ErrorCode.DESERIALIZE_FAILED,
            'Failed to deserialize context data',
            { error: e instanceof Error ? e.message : String(e) },
          ),
        );
      }
    },

    deserializeJson(buffer) {
      try {
        const json = buffer.toString('utf-8');
        let parsed: unknown;
        try {
          parsed = JSON.parse(json);
        } catch (e) {
          return err(
            createError(ErrorCode.DESERIALIZE_FAILED, 'Invalid JSON format', {
              error: e instanceof Error ? e.message : String(e),
            }),
          );
        }

        // Validate context structure
        const validateResult = parseContextData(parsed);
        if (!validateResult.ok) {
          return err(
            createError(
              ErrorCode.DESERIALIZE_FAILED,
              'Invalid context data structure',
              { validationErrors: validateResult.error.details },
            ),
          );
        }

        return ok(validateResult.value);
      } catch (e) {
        return err(
          createError(
            ErrorCode.DESERIALIZE_FAILED,
            'Failed to deserialize JSON',
            { error: e instanceof Error ? e.message : String(e) },
          ),
        );
      }
    },

    detectFormat(buffer) {
      // Check for empty buffer
      if (buffer.length === 0) {
        return 'unknown';
      }

      // Check for magic header
      if (buffer.length >= 4) {
        const magic = buffer.subarray(0, 4).toString('ascii');
        if (magic === MAGIC_HEADER) {
          return 'compressed';
        }
      }

      // Check for JSON (starts with '{')
      if (buffer[0] === 0x7b) {
        return 'json';
      }

      return 'unknown';
    },
  };

  return service;
};
