import { beforeEach, describe, expect, it } from 'vitest';
import {
  type FileSystem,
  createMemoryFs,
} from '../../../src/adapters/fs/memory-fs.js';
import type { ContextData } from '../../../src/core/types.js';
import { LogLevel, createLogger } from '../../../src/infrastructure/logger.js';
import { isErr, isOk } from '../../../src/infrastructure/result.js';
import {
  type BenTenServer,
  createBenTenServer,
} from '../../../src/mcp/server.js';
import {
  BEN10_DIR,
  CONTEXT_FILE,
  CONTEXT_FILE_LEGACY,
} from '../../../src/services/context-service.js';

describe('BenTenServer', () => {
  let fs: FileSystem;
  let server: BenTenServer;
  const projectDir = '/project';

  beforeEach(() => {
    fs = createMemoryFs();
    const logger = createLogger({ level: LogLevel.ERROR });
    server = createBenTenServer({ fs, logger, projectDir });
  });

  describe('getServerInfo', () => {
    it('returns server name and version', () => {
      const info = server.getServerInfo();

      expect(info.name).toBe('ben-ten');
      expect(info.version).toBe('1.0.0');
    });
  });

  describe('listTools', () => {
    it('includes ben_ten_status tool', () => {
      const tools = server.listTools();

      expect(tools).toContainEqual(
        expect.objectContaining({
          name: 'ben_ten_status',
        }),
      );
    });

    it('includes ben_ten_save tool', () => {
      const tools = server.listTools();

      expect(tools).toContainEqual(
        expect.objectContaining({
          name: 'ben_ten_save',
        }),
      );
    });

    it('includes ben_ten_load tool', () => {
      const tools = server.listTools();

      expect(tools).toContainEqual(
        expect.objectContaining({
          name: 'ben_ten_load',
        }),
      );
    });

    it('includes ben_ten_clear tool', () => {
      const tools = server.listTools();

      expect(tools).toContainEqual(
        expect.objectContaining({
          name: 'ben_ten_clear',
        }),
      );
    });
  });

  describe('callTool - ben_ten_status', () => {
    it('returns status when no context exists', async () => {
      const result = await server.callTool('ben_ten_status', {});

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.hasContext).toBe(false);
        expect(result.value.contextPath).toContain(BEN10_DIR);
      }
    });

    it('returns status with context info when context exists', async () => {
      const contextData: ContextData = {
        version: '1.0.0',
        createdAt: 1000,
        updatedAt: 2000,
        sessionId: 'test-session',
        summary: 'Test summary for status',
      };
      // Write to legacy JSON format for test fixture
      await fs.writeFile(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE_LEGACY}`,
        JSON.stringify(contextData),
      );

      const result = await server.callTool('ben_ten_status', {});

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.hasContext).toBe(true);
        expect(result.value.sessionId).toBe('test-session');
        expect(result.value.summaryLength).toBe(contextData.summary.length);
      }
    });
  });

  describe('callTool - ben_ten_save', () => {
    it('saves context with provided summary', async () => {
      const result = await server.callTool('ben_ten_save', {
        sessionId: 'new-session',
        summary: 'This is a new summary to save',
      });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.saved).toBe(true);
      }

      // Verify file was written
      const exists = await fs.exists(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE}`,
      );
      expect(exists).toBe(true);
    });

    it('preserves createdAt when updating existing context', async () => {
      const existingContext: ContextData = {
        version: '1.0.0',
        createdAt: 1000,
        updatedAt: 2000,
        sessionId: 'old-session',
        summary: 'Old summary',
      };
      // Write existing context to legacy format
      await fs.writeFile(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE_LEGACY}`,
        JSON.stringify(existingContext),
      );

      await server.callTool('ben_ten_save', {
        sessionId: 'updated-session',
        summary: 'Updated summary',
      });

      // Load the context through the service to verify createdAt was preserved
      const loadResult = await server.callTool('ben_ten_load', {});
      if (isOk(loadResult)) {
        expect(loadResult.value.createdAt).toBe(1000);
        expect(loadResult.value.sessionId).toBe('updated-session');
      }
    });
  });

  describe('callTool - ben_ten_load', () => {
    it('returns error when no context exists', async () => {
      const result = await server.callTool('ben_ten_load', {});

      expect(isErr(result)).toBe(true);
    });

    it('loads existing context', async () => {
      const contextData: ContextData = {
        version: '1.0.0',
        createdAt: 1000,
        updatedAt: 2000,
        sessionId: 'loaded-session',
        summary: 'Summary to load',
        keyFiles: ['src/index.ts'],
      };
      // Write to legacy JSON format for test fixture
      await fs.writeFile(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE_LEGACY}`,
        JSON.stringify(contextData),
      );

      const result = await server.callTool('ben_ten_load', {});

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.sessionId).toBe('loaded-session');
        expect(result.value.summary).toBe('Summary to load');
        expect(result.value.keyFiles).toEqual(['src/index.ts']);
      }
    });
  });

  describe('callTool - ben_ten_clear', () => {
    it('succeeds when no context exists', async () => {
      const result = await server.callTool('ben_ten_clear', {});

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.cleared).toBe(true);
      }
    });

    it('deletes existing context', async () => {
      const contextData: ContextData = {
        version: '1.0.0',
        createdAt: 1000,
        updatedAt: 2000,
        sessionId: 'to-clear',
        summary: 'Will be cleared',
      };
      // Write to legacy JSON format for test fixture
      await fs.writeFile(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE_LEGACY}`,
        JSON.stringify(contextData),
      );

      const result = await server.callTool('ben_ten_clear', {});

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.cleared).toBe(true);
      }

      // Both new and legacy formats should be deleted
      const newExists = await fs.exists(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE}`,
      );
      const legacyExists = await fs.exists(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE_LEGACY}`,
      );
      expect(newExists).toBe(false);
      expect(legacyExists).toBe(false);
    });
  });

  describe('callTool - unknown tool', () => {
    it('returns error for unknown tool', async () => {
      const result = await server.callTool('unknown_tool', {});

      expect(isErr(result)).toBe(true);
    });
  });

  describe('listResources', () => {
    it('includes context resource', () => {
      const resources = server.listResources();

      expect(resources).toContainEqual(
        expect.objectContaining({
          uri: expect.stringContaining('ben-ten://context'),
        }),
      );
    });
  });

  describe('readResource', () => {
    it('returns empty when no context exists', async () => {
      const result = await server.readResource('ben-ten://context');

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.contents).toContain('No context');
      }
    });

    it('returns context contents when context exists', async () => {
      const contextData: ContextData = {
        version: '1.0.0',
        createdAt: 1000,
        updatedAt: 2000,
        sessionId: 'resource-test',
        summary: 'Summary for resource test',
      };
      // Write to legacy JSON format for test fixture
      await fs.writeFile(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE_LEGACY}`,
        JSON.stringify(contextData),
      );

      const result = await server.readResource('ben-ten://context');

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.contents).toContain('Summary for resource test');
      }
    });

    it('returns error for unknown resource', async () => {
      const result = await server.readResource('ben-ten://unknown');

      expect(isErr(result)).toBe(true);
    });
  });
});
