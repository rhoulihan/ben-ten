import { describe, expect, it } from 'vitest';
import type { ContextData } from '../../src/core/types.js';
import { isOk } from '../../src/infrastructure/result.js';
import {
  BEN10_DIR,
  CONTEXT_FILE_LEGACY,
} from '../../src/services/context-service.js';
import { createContextData } from './context-factory.js';
import {
  createTestEnv,
  setupContextFile,
  setupTranscriptFile,
} from './test-helpers.js';

describe('test-helpers', () => {
  describe('createTestEnv', () => {
    it('returns fs, logger, and projectDir', () => {
      const env = createTestEnv();

      expect(env.fs).toBeDefined();
      expect(env.logger).toBeDefined();
      expect(env.projectDir).toBe('/project');
    });

    it('allows custom projectDir', () => {
      const env = createTestEnv({ projectDir: '/custom/path' });

      expect(env.projectDir).toBe('/custom/path');
    });

    it('fs is a working memory filesystem', async () => {
      const { fs } = createTestEnv();

      await fs.writeFile('/test.txt', 'hello');
      const result = await fs.readFile('/test.txt');

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBe('hello');
      }
    });
  });

  describe('setupContextFile', () => {
    it('creates context file at correct path', async () => {
      const { fs, projectDir } = createTestEnv();
      const context = createContextData({ sessionId: 'setup-test' });

      await setupContextFile(fs, projectDir, context);

      const exists = await fs.exists(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE_LEGACY}`,
      );
      expect(exists).toBe(true);
    });

    it('writes valid JSON context data', async () => {
      const { fs, projectDir } = createTestEnv();
      const context = createContextData({ sessionId: 'json-test' });

      await setupContextFile(fs, projectDir, context);

      const result = await fs.readFile(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE_LEGACY}`,
      );
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        const parsed = JSON.parse(result.value) as ContextData;
        expect(parsed.sessionId).toBe('json-test');
      }
    });
  });

  describe('setupTranscriptFile', () => {
    it('creates transcript file at specified path', async () => {
      const { fs } = createTestEnv();
      const transcriptPath = '/home/user/.claude/sessions/test.jsonl';

      await setupTranscriptFile(fs, transcriptPath, 'line1\nline2');

      const exists = await fs.exists(transcriptPath);
      expect(exists).toBe(true);
    });

    it('writes content correctly', async () => {
      const { fs } = createTestEnv();
      const transcriptPath = '/transcripts/session.jsonl';
      const content = '{"type":"summary","summary":"test"}';

      await setupTranscriptFile(fs, transcriptPath, content);

      const result = await fs.readFile(transcriptPath);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBe(content);
      }
    });
  });
});
