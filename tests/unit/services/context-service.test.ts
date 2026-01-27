import { beforeEach, describe, expect, it } from 'vitest';
import {
  type FileSystem,
  createMemoryFs,
} from '../../../src/adapters/fs/memory-fs.js';
import type { ContextData } from '../../../src/core/types.js';
import { ErrorCode } from '../../../src/infrastructure/errors.js';
import { LogLevel, createLogger } from '../../../src/infrastructure/logger.js';
import { isErr, isOk } from '../../../src/infrastructure/result.js';
import {
  BEN10_DIR,
  CONTEXT_FILE,
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
      expect(BEN10_DIR).toBe('.ben10');
      expect(CONTEXT_FILE).toBe('context.json');
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
      await fs.writeFile(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE}`,
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

  describe('getBen10Dir', () => {
    it('returns the full path to .ben10 directory', () => {
      const path = service.getBen10Dir();

      expect(path).toBe(`${projectDir}/${BEN10_DIR}`);
    });
  });
});
