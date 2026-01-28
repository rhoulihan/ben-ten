import { beforeEach, describe, expect, it } from 'vitest';
import {
  type FileSystem,
  createMemoryFs,
} from '../../../src/adapters/fs/memory-fs.js';
import type { ContextData, ContextMetadata } from '../../../src/core/types.js';
import { ErrorCode } from '../../../src/infrastructure/errors.js';
import { LogLevel, createLogger } from '../../../src/infrastructure/logger.js';
import { isErr, isOk } from '../../../src/infrastructure/result.js';
import {
  BEN10_DIR,
  CONTEXT_FILE,
  CONTEXT_FILE_LEGACY,
  type ContextService,
  METADATA_FILE,
  createContextService,
} from '../../../src/services/context-service.js';

describe('ContextService', () => {
  let fs: FileSystem;
  let service: ContextService;
  const projectDir = '/project';

  beforeEach(() => {
    fs = createMemoryFs();
    const logger = createLogger({ level: LogLevel.ERROR }); // Quiet during tests
    service = createContextService({ fs, logger, projectDir });
  });

  describe('constants', () => {
    it('exports correct directory and file names', () => {
      expect(BEN10_DIR).toBe('.ben-ten');
      expect(CONTEXT_FILE).toBe('context.ctx');
      expect(CONTEXT_FILE_LEGACY).toBe('context.json');
      expect(METADATA_FILE).toBe('metadata.json');
    });
  });

  describe('hasContext', () => {
    it('returns false when no context exists', async () => {
      const result = await service.hasContext();

      expect(result).toBe(false);
    });

    it('returns true when context file exists', async () => {
      const contextData: ContextData = {
        version: '1.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sessionId: 'test-123',
        summary: 'Test context',
      };
      await fs.writeFile(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE}`,
        JSON.stringify(contextData),
      );

      const result = await service.hasContext();

      expect(result).toBe(true);
    });
  });

  describe('loadContext', () => {
    it('returns error when no context exists', async () => {
      const result = await service.loadContext();

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe(ErrorCode.CONTEXT_NOT_FOUND);
      }
    });

    it('loads existing context successfully', async () => {
      const contextData: ContextData = {
        version: '1.0.0',
        createdAt: 1000,
        updatedAt: 2000,
        sessionId: 'test-123',
        summary: 'Test summary content',
        keyFiles: ['src/index.ts'],
      };
      // Write to legacy JSON path for this test
      await fs.writeFile(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE_LEGACY}`,
        JSON.stringify(contextData),
      );

      const result = await service.loadContext();

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.sessionId).toBe('test-123');
        expect(result.value.summary).toBe('Test summary content');
        expect(result.value.keyFiles).toEqual(['src/index.ts']);
      }
    });

    it('returns error for corrupted context file', async () => {
      await fs.writeFile(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE}`,
        'not valid json',
      );

      const result = await service.loadContext();

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe(ErrorCode.CONTEXT_CORRUPTED);
      }
    });

    it('returns error for invalid context structure', async () => {
      await fs.writeFile(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE}`,
        JSON.stringify({ invalid: 'structure' }),
      );

      const result = await service.loadContext();

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe(ErrorCode.CONTEXT_CORRUPTED);
      }
    });
  });

  describe('saveContext', () => {
    it('saves context successfully', async () => {
      const contextData: ContextData = {
        version: '1.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sessionId: 'test-456',
        summary: 'New context summary',
      };

      const result = await service.saveContext(contextData);

      expect(isOk(result)).toBe(true);

      // Verify file was written
      const fileExists = await fs.exists(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE}`,
      );
      expect(fileExists).toBe(true);
    });

    it('creates .ben10 directory if it does not exist', async () => {
      const contextData: ContextData = {
        version: '1.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sessionId: 'test-789',
        summary: 'Test',
      };

      await service.saveContext(contextData);

      const dirExists = await fs.exists(`${projectDir}/${BEN10_DIR}`);
      expect(dirExists).toBe(true);
    });

    it('overwrites existing context', async () => {
      const first: ContextData = {
        version: '1.0.0',
        createdAt: 1000,
        updatedAt: 1000,
        sessionId: 'first',
        summary: 'First summary',
      };
      const second: ContextData = {
        version: '1.0.0',
        createdAt: 1000,
        updatedAt: 2000,
        sessionId: 'second',
        summary: 'Second summary',
      };

      await service.saveContext(first);
      await service.saveContext(second);

      const loadResult = await service.loadContext();
      expect(isOk(loadResult)).toBe(true);
      if (isOk(loadResult)) {
        expect(loadResult.value.sessionId).toBe('second');
        expect(loadResult.value.summary).toBe('Second summary');
      }
    });

    it('saved context can be loaded back', async () => {
      const contextData: ContextData = {
        version: '1.0.0',
        createdAt: 1234567890,
        updatedAt: 1234567899,
        sessionId: 'roundtrip-test',
        summary: 'This is a roundtrip test',
        keyFiles: ['a.ts', 'b.ts'],
        activeTasks: ['Task 1', 'Task 2'],
      };

      await service.saveContext(contextData);
      const loadResult = await service.loadContext();

      expect(isOk(loadResult)).toBe(true);
      if (isOk(loadResult)) {
        expect(loadResult.value).toEqual(contextData);
      }
    });
  });

  describe('deleteContext', () => {
    it('deletes existing context', async () => {
      const contextData: ContextData = {
        version: '1.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sessionId: 'to-delete',
        summary: 'Will be deleted',
      };
      await service.saveContext(contextData);

      const result = await service.deleteContext();

      expect(isOk(result)).toBe(true);
      expect(await service.hasContext()).toBe(false);
    });

    it('succeeds even if no context exists', async () => {
      const result = await service.deleteContext();

      expect(isOk(result)).toBe(true);
    });
  });

  describe('getContextPath', () => {
    it('returns the full path to context file', () => {
      const path = service.getContextPath();

      expect(path).toBe(`${projectDir}/${BEN10_DIR}/${CONTEXT_FILE}`);
    });
  });

  describe('getBenTenDir', () => {
    it('returns the full path to .ben-ten directory', () => {
      const path = service.getBenTenDir();

      expect(path).toBe(`${projectDir}/${BEN10_DIR}`);
    });
  });

  describe('saveMetadata', () => {
    it('saves metadata successfully', async () => {
      const metadata: ContextMetadata = {
        directory: projectDir,
        directoryHash: 'abc123',
        lastSessionId: 'session-1',
        sessionCount: 1,
        lastSavedAt: Date.now(),
        transcriptPath: '/home/user/.claude/transcript.jsonl',
      };

      const result = await service.saveMetadata(metadata);

      expect(isOk(result)).toBe(true);

      // Verify file was written
      const fileExists = await fs.exists(
        `${projectDir}/${BEN10_DIR}/${METADATA_FILE}`,
      );
      expect(fileExists).toBe(true);
    });

    it('creates .ben-ten directory if needed', async () => {
      const metadata: ContextMetadata = {
        directory: projectDir,
        directoryHash: 'abc123',
        lastSessionId: 'session-1',
        sessionCount: 1,
        lastSavedAt: Date.now(),
      };

      await service.saveMetadata(metadata);

      const dirExists = await fs.exists(`${projectDir}/${BEN10_DIR}`);
      expect(dirExists).toBe(true);
    });
  });

  describe('loadMetadata', () => {
    it('loads existing metadata successfully', async () => {
      const metadata: ContextMetadata = {
        directory: projectDir,
        directoryHash: 'abc123',
        lastSessionId: 'session-1',
        sessionCount: 5,
        lastSavedAt: 1234567890,
        transcriptPath: '/path/to/transcript.jsonl',
      };
      await fs.mkdir(`${projectDir}/${BEN10_DIR}`, { recursive: true });
      await fs.writeFile(
        `${projectDir}/${BEN10_DIR}/${METADATA_FILE}`,
        JSON.stringify(metadata),
      );

      const result = await service.loadMetadata();

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.lastSessionId).toBe('session-1');
        expect(result.value.sessionCount).toBe(5);
        expect(result.value.transcriptPath).toBe('/path/to/transcript.jsonl');
      }
    });

    it('returns error when no metadata exists', async () => {
      const result = await service.loadMetadata();

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe(ErrorCode.CONTEXT_NOT_FOUND);
      }
    });

    it('returns error for invalid metadata', async () => {
      await fs.mkdir(`${projectDir}/${BEN10_DIR}`, { recursive: true });
      await fs.writeFile(
        `${projectDir}/${BEN10_DIR}/${METADATA_FILE}`,
        JSON.stringify({ invalid: 'structure' }),
      );

      const result = await service.loadMetadata();

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe(ErrorCode.CONTEXT_CORRUPTED);
      }
    });
  });

  describe('hasMetadata', () => {
    it('returns false when no metadata exists', async () => {
      const result = await service.hasMetadata();

      expect(result).toBe(false);
    });

    it('returns true when metadata file exists', async () => {
      const metadata: ContextMetadata = {
        directory: projectDir,
        directoryHash: 'abc123',
        lastSessionId: 'session-1',
        sessionCount: 1,
        lastSavedAt: Date.now(),
      };
      await service.saveMetadata(metadata);

      const result = await service.hasMetadata();

      expect(result).toBe(true);
    });
  });

  describe('compression', () => {
    it('saves context in compressed binary format', async () => {
      const contextData: ContextData = {
        version: '2.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sessionId: 'test-compression',
        summary: 'A'.repeat(1000), // Compressible data
      };

      await service.saveContext(contextData);

      // File should be at .ctx path, not .json
      const ctxExists = await fs.exists(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE}`,
      );
      expect(ctxExists).toBe(true);

      // Read raw file and check it starts with magic header
      const rawResult = await fs.readFileBuffer(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE}`,
      );
      expect(isOk(rawResult)).toBe(true);
      if (isOk(rawResult)) {
        const magic = rawResult.value.subarray(0, 4).toString('ascii');
        expect(magic).toBe('BT10');
      }
    });

    it('achieves compression for large context', async () => {
      const contextData: ContextData = {
        version: '2.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sessionId: 'test-compression-ratio',
        summary: 'This is a test. '.repeat(500),
      };

      await service.saveContext(contextData);

      const statResult = await fs.stat(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE}`,
      );
      expect(isOk(statResult)).toBe(true);
      if (isOk(statResult)) {
        const jsonSize = JSON.stringify(contextData).length;
        // Compressed file should be smaller than JSON
        expect(statResult.value.size).toBeLessThan(jsonSize);
      }
    });

    it('loads compressed context correctly', async () => {
      const contextData: ContextData = {
        version: '2.0.0',
        createdAt: 1234567890,
        updatedAt: 1234567899,
        sessionId: 'test-load-compressed',
        summary: 'Test compressed roundtrip',
        keyFiles: ['/a.ts', '/b.ts'],
      };

      await service.saveContext(contextData);
      const loadResult = await service.loadContext();

      expect(isOk(loadResult)).toBe(true);
      if (isOk(loadResult)) {
        expect(loadResult.value).toEqual(contextData);
      }
    });
  });

  describe('legacy JSON migration', () => {
    it('loads legacy JSON format and returns context', async () => {
      const legacyContext: ContextData = {
        version: '1.0.0',
        createdAt: 1000,
        updatedAt: 2000,
        sessionId: 'legacy-session',
        summary: 'Legacy context content',
      };

      // Write to legacy JSON path
      await fs.mkdir(`${projectDir}/${BEN10_DIR}`, { recursive: true });
      await fs.writeFile(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE_LEGACY}`,
        JSON.stringify(legacyContext),
      );

      const loadResult = await service.loadContext();

      expect(isOk(loadResult)).toBe(true);
      if (isOk(loadResult)) {
        expect(loadResult.value.sessionId).toBe('legacy-session');
      }
    });

    it('prefers compressed format over legacy JSON when both exist', async () => {
      const legacyContext: ContextData = {
        version: '1.0.0',
        createdAt: 1000,
        updatedAt: 2000,
        sessionId: 'legacy-session',
        summary: 'Legacy content',
      };
      const newContext: ContextData = {
        version: '2.0.0',
        createdAt: 3000,
        updatedAt: 4000,
        sessionId: 'new-session',
        summary: 'New content',
      };

      // Write legacy JSON
      await fs.mkdir(`${projectDir}/${BEN10_DIR}`, { recursive: true });
      await fs.writeFile(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE_LEGACY}`,
        JSON.stringify(legacyContext),
      );

      // Write new compressed format
      await service.saveContext(newContext);

      const loadResult = await service.loadContext();

      expect(isOk(loadResult)).toBe(true);
      if (isOk(loadResult)) {
        expect(loadResult.value.sessionId).toBe('new-session');
      }
    });

    it('hasContext returns true for legacy JSON format', async () => {
      const legacyContext: ContextData = {
        version: '1.0.0',
        createdAt: 1000,
        updatedAt: 2000,
        sessionId: 'legacy',
        summary: 'Legacy',
      };

      await fs.mkdir(`${projectDir}/${BEN10_DIR}`, { recursive: true });
      await fs.writeFile(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE_LEGACY}`,
        JSON.stringify(legacyContext),
      );

      const result = await service.hasContext();

      expect(result).toBe(true);
    });

    it('deleteContext removes both legacy and new format files', async () => {
      const context: ContextData = {
        version: '2.0.0',
        createdAt: 1000,
        updatedAt: 2000,
        sessionId: 'to-delete',
        summary: 'Delete me',
      };

      // Create both files
      await fs.mkdir(`${projectDir}/${BEN10_DIR}`, { recursive: true });
      await fs.writeFile(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE_LEGACY}`,
        JSON.stringify(context),
      );
      await service.saveContext(context);

      await service.deleteContext();

      const legacyExists = await fs.exists(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE_LEGACY}`,
      );
      const newExists = await fs.exists(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE}`,
      );
      expect(legacyExists).toBe(false);
      expect(newExists).toBe(false);
    });
  });
});
