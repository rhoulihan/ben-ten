import { beforeEach, describe, expect, it } from 'vitest';
import type { ContextData } from '../../../src/core/types.js';
import { ErrorCode } from '../../../src/infrastructure/errors.js';
import { isErr, isOk } from '../../../src/infrastructure/result.js';
import {
  COMPRESSION_TYPE,
  FORMAT_VERSION,
  MAGIC_HEADER,
  type SerializerService,
  createSerializerService,
} from '../../../src/services/serializer-service.js';

describe('SerializerService', () => {
  let service: SerializerService;

  beforeEach(() => {
    service = createSerializerService();
  });

  const createTestContext = (): ContextData => ({
    version: '2.0.0',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    sessionId: 'test-session-123',
    summary: 'This is a test summary with some content.',
    keyFiles: ['/src/index.ts', '/src/types.ts'],
    activeTasks: ['Task 1', 'Task 2'],
  });

  describe('serialize', () => {
    it('serializes context data to binary format', () => {
      const context = createTestContext();

      const result = service.serialize(context);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(Buffer.isBuffer(result.value)).toBe(true);
        expect(result.value.length).toBeGreaterThan(0);
      }
    });

    it('includes magic header in output', () => {
      const context = createTestContext();

      const result = service.serialize(context);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        const header = result.value.subarray(0, 4);
        expect(header.toString()).toBe(MAGIC_HEADER);
      }
    });

    it('includes format version in output', () => {
      const context = createTestContext();

      const result = service.serialize(context);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value[4]).toBe(FORMAT_VERSION);
      }
    });

    it('includes compression type in output', () => {
      const context = createTestContext();

      const result = service.serialize(context);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value[5]).toBe(COMPRESSION_TYPE.LZ4);
      }
    });

    it('handles minimal context data', () => {
      const minimalContext: ContextData = {
        version: '2.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sessionId: 'test',
        summary: '',
      };

      const result = service.serialize(minimalContext);

      expect(isOk(result)).toBe(true);
    });

    it('handles context with large summary', () => {
      const context = createTestContext();
      context.summary = 'A'.repeat(100000);

      const result = service.serialize(context);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        // Should achieve compression
        const jsonSize = JSON.stringify(context).length;
        expect(result.value.length).toBeLessThan(jsonSize);
      }
    });
  });

  describe('deserialize', () => {
    it('deserializes binary format back to context data', () => {
      const original = createTestContext();

      const serializeResult = service.serialize(original);
      expect(isOk(serializeResult)).toBe(true);
      if (!isOk(serializeResult)) return;

      const deserializeResult = service.deserialize(serializeResult.value);

      expect(isOk(deserializeResult)).toBe(true);
      if (isOk(deserializeResult)) {
        expect(deserializeResult.value).toEqual(original);
      }
    });

    it('returns error for invalid magic header', () => {
      const invalidData = Buffer.from('XXXX' + '\x01\x01\x00\x00\x00\x00');

      const result = service.deserialize(invalidData);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe(ErrorCode.DESERIALIZE_FAILED);
        expect(result.error.message).toContain('magic header');
      }
    });

    it('returns error for unsupported format version', () => {
      const data = Buffer.concat([
        Buffer.from(MAGIC_HEADER),
        Buffer.from([0xff]), // Unsupported version
        Buffer.from([0x01, 0x00, 0x00, 0x00, 0x00]),
      ]);

      const result = service.deserialize(data);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe(ErrorCode.DESERIALIZE_FAILED);
        expect(result.error.message).toContain('version');
      }
    });

    it('returns error for unsupported compression type', () => {
      const data = Buffer.concat([
        Buffer.from(MAGIC_HEADER),
        Buffer.from([FORMAT_VERSION]),
        Buffer.from([0xff]), // Unsupported compression
        Buffer.from([0x00, 0x00, 0x00, 0x00]),
      ]);

      const result = service.deserialize(data);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe(ErrorCode.DESERIALIZE_FAILED);
        expect(result.error.message).toContain('compression');
      }
    });

    it('returns error for truncated data', () => {
      const result = service.deserialize(Buffer.from('BT'));

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe(ErrorCode.DESERIALIZE_FAILED);
      }
    });

    it('returns error for corrupted compressed data', () => {
      const data = Buffer.concat([
        Buffer.from(MAGIC_HEADER),
        Buffer.from([FORMAT_VERSION]),
        Buffer.from([COMPRESSION_TYPE.LZ4]),
        Buffer.from([0x64, 0x00, 0x00, 0x00]), // Size: 100
        Buffer.from('not valid lz4 compressed data'),
      ]);

      const result = service.deserialize(data);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe(ErrorCode.DESERIALIZE_FAILED);
      }
    });
  });

  describe('detectFormat', () => {
    it('detects compressed format', () => {
      const context = createTestContext();
      const serializeResult = service.serialize(context);
      expect(isOk(serializeResult)).toBe(true);
      if (!isOk(serializeResult)) return;

      const format = service.detectFormat(serializeResult.value);

      expect(format).toBe('compressed');
    });

    it('detects JSON format', () => {
      const jsonData = Buffer.from(JSON.stringify(createTestContext()));

      const format = service.detectFormat(jsonData);

      expect(format).toBe('json');
    });

    it('returns unknown for other formats', () => {
      const randomData = Buffer.from([0x00, 0x01, 0x02, 0x03]);

      const format = service.detectFormat(randomData);

      expect(format).toBe('unknown');
    });

    it('handles empty buffer', () => {
      const format = service.detectFormat(Buffer.alloc(0));

      expect(format).toBe('unknown');
    });
  });

  describe('deserializeJson', () => {
    it('deserializes JSON format', () => {
      const original = createTestContext();
      const jsonData = Buffer.from(JSON.stringify(original));

      const result = service.deserializeJson(jsonData);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toEqual(original);
      }
    });

    it('returns error for invalid JSON', () => {
      const invalidJson = Buffer.from('{ invalid json }');

      const result = service.deserializeJson(invalidJson);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe(ErrorCode.DESERIALIZE_FAILED);
      }
    });

    it('returns error for JSON with invalid context structure', () => {
      const invalidContext = Buffer.from(JSON.stringify({ foo: 'bar' }));

      const result = service.deserializeJson(invalidContext);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe(ErrorCode.DESERIALIZE_FAILED);
      }
    });
  });

  describe('round-trip', () => {
    it('preserves all context fields', () => {
      const original: ContextData = {
        version: '2.0.0',
        createdAt: 1234567890,
        updatedAt: 1234567891,
        sessionId: 'session-abc',
        summary: 'Test summary',
        transcriptExcerpt: 'Some transcript',
        keyFiles: ['/a.ts', '/b.ts'],
        activeTasks: ['Task A', 'Task B'],
        conversation: {
          messages: [],
          messageCount: 0,
        },
        files: [{ path: '/test.ts', lastAccessed: 1234567890, accessCount: 5 }],
        toolHistory: [
          { toolName: 'Read', timestamp: 1234567890, success: true },
        ],
        preferences: { theme: 'dark' },
        isPreCompactionSnapshot: true,
        compactionTrigger: 'auto',
        preCompactionTokenCount: 50000,
      };

      const serializeResult = service.serialize(original);
      expect(isOk(serializeResult)).toBe(true);
      if (!isOk(serializeResult)) return;

      const deserializeResult = service.deserialize(serializeResult.value);

      expect(isOk(deserializeResult)).toBe(true);
      if (isOk(deserializeResult)) {
        expect(deserializeResult.value).toEqual(original);
      }
    });

    it('achieves compression for typical context data', () => {
      const context = createTestContext();
      context.summary = 'This is a summary. '.repeat(100);

      const serializeResult = service.serialize(context);
      expect(isOk(serializeResult)).toBe(true);
      if (!isOk(serializeResult)) return;

      const jsonSize = JSON.stringify(context).length;
      const compressedSize = serializeResult.value.length;

      // Should achieve at least 30% compression
      expect(compressedSize).toBeLessThan(jsonSize * 0.7);
    });
  });
});
