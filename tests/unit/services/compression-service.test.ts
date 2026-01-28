import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode } from '../../../src/infrastructure/errors.js';
import { isErr, isOk } from '../../../src/infrastructure/result.js';
import {
  type CompressionService,
  createCompressionService,
} from '../../../src/services/compression-service.js';

describe('CompressionService', () => {
  let service: CompressionService;

  beforeEach(() => {
    service = createCompressionService();
  });

  describe('compress', () => {
    it('compresses data and returns smaller buffer for compressible data', () => {
      // Repeated data compresses well
      const input = Buffer.from('a'.repeat(1000));

      const result = service.compress(input);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(Buffer.isBuffer(result.value)).toBe(true);
        expect(result.value.length).toBeLessThan(input.length);
      }
    });

    it('handles empty buffer', () => {
      const input = Buffer.alloc(0);

      const result = service.compress(input);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(Buffer.isBuffer(result.value)).toBe(true);
      }
    });

    it('handles small data', () => {
      const input = Buffer.from('hello');

      const result = service.compress(input);

      expect(isOk(result)).toBe(true);
    });

    it('handles binary data with null bytes', () => {
      const input = Buffer.from([0x00, 0x01, 0x02, 0xff, 0x00, 0xfe]);

      const result = service.compress(input);

      expect(isOk(result)).toBe(true);
    });
  });

  describe('decompress', () => {
    it('decompresses data back to original', () => {
      const original = Buffer.from('Hello, World! This is a test string.');

      const compressResult = service.compress(original);
      expect(isOk(compressResult)).toBe(true);
      if (!isOk(compressResult)) return;

      const decompressResult = service.decompress(compressResult.value);

      expect(isOk(decompressResult)).toBe(true);
      if (isOk(decompressResult)) {
        expect(decompressResult.value).toEqual(original);
      }
    });

    it('handles empty compressed buffer', () => {
      const original = Buffer.alloc(0);

      const compressResult = service.compress(original);
      expect(isOk(compressResult)).toBe(true);
      if (!isOk(compressResult)) return;

      const decompressResult = service.decompress(compressResult.value);

      expect(isOk(decompressResult)).toBe(true);
      if (isOk(decompressResult)) {
        expect(decompressResult.value.length).toBe(0);
      }
    });

    it('returns error for invalid compressed data', () => {
      const invalidData = Buffer.from('not valid lz4 data');

      const result = service.decompress(invalidData);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe(ErrorCode.DESERIALIZE_FAILED);
      }
    });

    it('handles binary data round-trip', () => {
      const original = Buffer.from([0x00, 0x01, 0x02, 0xff, 0x00, 0xfe]);

      const compressResult = service.compress(original);
      expect(isOk(compressResult)).toBe(true);
      if (!isOk(compressResult)) return;

      const decompressResult = service.decompress(compressResult.value);

      expect(isOk(decompressResult)).toBe(true);
      if (isOk(decompressResult)) {
        expect(decompressResult.value).toEqual(original);
      }
    });
  });

  describe('round-trip', () => {
    it('preserves large JSON data', () => {
      const data = {
        messages: Array.from({ length: 100 }, (_, i) => ({
          id: `msg-${i}`,
          content: 'A'.repeat(100),
          timestamp: Date.now(),
        })),
      };
      const original = Buffer.from(JSON.stringify(data));

      const compressResult = service.compress(original);
      expect(isOk(compressResult)).toBe(true);
      if (!isOk(compressResult)) return;

      const decompressResult = service.decompress(compressResult.value);

      expect(isOk(decompressResult)).toBe(true);
      if (isOk(decompressResult)) {
        expect(decompressResult.value.toString()).toBe(original.toString());
      }
    });

    it('achieves good compression ratio for repetitive data', () => {
      // Simulate context data with repetitive patterns
      const repetitiveData = Buffer.from(
        JSON.stringify({
          summary: 'test summary',
          messages: Array.from({ length: 50 }, (_, i) => ({
            role: i % 2 === 0 ? 'user' : 'assistant',
            content: 'This is a message with common words and patterns.',
          })),
        }),
      );

      const compressResult = service.compress(repetitiveData);
      expect(isOk(compressResult)).toBe(true);
      if (!isOk(compressResult)) return;

      const ratio = compressResult.value.length / repetitiveData.length;
      // LZ4 should achieve at least 50% compression on repetitive data
      expect(ratio).toBeLessThan(0.5);
    });
  });
});
