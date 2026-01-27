import { beforeEach, describe, expect, it } from 'vitest';
import type { FileSystem } from '../../../src/adapters/fs/memory-fs.js';
import type { ContextData, ContextMetadata } from '../../../src/core/types.js';
import type { Logger } from '../../../src/infrastructure/logger.js';
import { isOk } from '../../../src/infrastructure/result.js';
import {
  type BenTenServer,
  createBenTenServer,
} from '../../../src/mcp/server.js';
import {
  BEN10_DIR,
  CONTEXT_FILE,
  METADATA_FILE,
} from '../../../src/services/context-service.js';
import { createContextData } from '../../fixtures/context-factory.js';
import {
  createTestEnv,
  setupContextFile,
  setupTranscriptFile,
} from '../../fixtures/test-helpers.js';
import {
  createAssistantEntry,
  createSummaryEntry,
  createTranscript,
  createUserEntry,
} from '../../fixtures/transcript-factory.js';

describe('MCP Server integration', () => {
  let fs: FileSystem;
  let logger: Logger;
  let server: BenTenServer;
  const projectDir = '/project';

  beforeEach(() => {
    const env = createTestEnv({ projectDir });
    fs = env.fs;
    logger = env.logger;
    server = createBenTenServer({ fs, logger, projectDir });
  });

  describe('ben_ten_save with optional fields', () => {
    it('saves keyFiles when provided', async () => {
      const result = await server.callTool('ben_ten_save', {
        sessionId: 'key-files-test',
        summary: 'Test summary',
        keyFiles: ['src/index.ts', 'src/main.ts', 'README.md'],
      });

      expect(isOk(result)).toBe(true);

      const fileResult = await fs.readFile(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE}`,
      );
      expect(isOk(fileResult)).toBe(true);
      if (isOk(fileResult)) {
        const saved = JSON.parse(fileResult.value) as ContextData;
        expect(saved.keyFiles).toEqual([
          'src/index.ts',
          'src/main.ts',
          'README.md',
        ]);
      }
    });

    it('saves activeTasks when provided', async () => {
      const result = await server.callTool('ben_ten_save', {
        sessionId: 'tasks-test',
        summary: 'Test summary',
        activeTasks: ['Implement feature X', 'Write tests', 'Update docs'],
      });

      expect(isOk(result)).toBe(true);

      const fileResult = await fs.readFile(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE}`,
      );
      expect(isOk(fileResult)).toBe(true);
      if (isOk(fileResult)) {
        const saved = JSON.parse(fileResult.value) as ContextData;
        expect(saved.activeTasks).toEqual([
          'Implement feature X',
          'Write tests',
          'Update docs',
        ]);
      }
    });

    it('handles empty arrays', async () => {
      const result = await server.callTool('ben_ten_save', {
        sessionId: 'empty-arrays-test',
        summary: 'Test summary',
        keyFiles: [],
        activeTasks: [],
      });

      expect(isOk(result)).toBe(true);

      const fileResult = await fs.readFile(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE}`,
      );
      expect(isOk(fileResult)).toBe(true);
      if (isOk(fileResult)) {
        const saved = JSON.parse(fileResult.value) as ContextData;
        expect(saved.keyFiles).toEqual([]);
        expect(saved.activeTasks).toEqual([]);
      }
    });

    it('saves both keyFiles and activeTasks together', async () => {
      const result = await server.callTool('ben_ten_save', {
        sessionId: 'both-fields-test',
        summary: 'Complete context',
        keyFiles: ['src/app.ts'],
        activeTasks: ['Task 1', 'Task 2'],
      });

      expect(isOk(result)).toBe(true);

      const fileResult = await fs.readFile(
        `${projectDir}/${BEN10_DIR}/${CONTEXT_FILE}`,
      );
      expect(isOk(fileResult)).toBe(true);
      if (isOk(fileResult)) {
        const saved = JSON.parse(fileResult.value) as ContextData;
        expect(saved.keyFiles).toEqual(['src/app.ts']);
        expect(saved.activeTasks).toEqual(['Task 1', 'Task 2']);
      }
    });
  });

  describe('context resource formatting', () => {
    it('formats markdown with keyFiles section', async () => {
      const context = createContextData({
        summary: 'Project summary',
        keyFiles: ['src/index.ts', 'package.json'],
      });
      await setupContextFile(fs, projectDir, context);

      const result = await server.readResource('ben-ten://context');

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.contents).toContain('Project summary');
        expect(result.value.contents).toContain('src/index.ts');
        expect(result.value.contents).toContain('package.json');
      }
    });

    it('formats markdown with activeTasks section', async () => {
      const context = createContextData({
        summary: 'Working on features',
        activeTasks: ['Complete API', 'Add tests'],
      });
      await setupContextFile(fs, projectDir, context);

      const result = await server.readResource('ben-ten://context');

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.contents).toContain('Working on features');
        expect(result.value.contents).toContain('Complete API');
        expect(result.value.contents).toContain('Add tests');
      }
    });

    it('handles multi-line summaries', async () => {
      const multiLineSummary = `Line 1 of summary
Line 2 with more details
Line 3 with conclusion`;
      const context = createContextData({
        summary: multiLineSummary,
      });
      await setupContextFile(fs, projectDir, context);

      const result = await server.readResource('ben-ten://context');

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.contents).toContain('Line 1 of summary');
        expect(result.value.contents).toContain('Line 2 with more details');
        expect(result.value.contents).toContain('Line 3 with conclusion');
      }
    });

    it('handles special characters in summary', async () => {
      const context = createContextData({
        summary: 'Code: `const x = 1;` and **bold** text',
      });
      await setupContextFile(fs, projectDir, context);

      const result = await server.readResource('ben-ten://context');

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.contents).toContain('`const x = 1;`');
        expect(result.value.contents).toContain('**bold**');
      }
    });
  });

  describe('full save-load-clear cycle', () => {
    it('completes full lifecycle correctly', async () => {
      // Step 1: Save context
      const saveResult = await server.callTool('ben_ten_save', {
        sessionId: 'lifecycle-test',
        summary: 'Full lifecycle test summary',
        keyFiles: ['src/app.ts'],
        activeTasks: ['Task A'],
      });
      expect(isOk(saveResult)).toBe(true);

      // Step 2: Verify status shows context exists
      const statusResult = await server.callTool('ben_ten_status', {});
      expect(isOk(statusResult)).toBe(true);
      if (isOk(statusResult)) {
        expect(statusResult.value.hasContext).toBe(true);
        expect(statusResult.value.sessionId).toBe('lifecycle-test');
      }

      // Step 3: Load and verify context
      const loadResult = await server.callTool('ben_ten_load', {});
      expect(isOk(loadResult)).toBe(true);
      if (isOk(loadResult)) {
        expect(loadResult.value.sessionId).toBe('lifecycle-test');
        expect(loadResult.value.summary).toBe('Full lifecycle test summary');
        expect(loadResult.value.keyFiles).toEqual(['src/app.ts']);
        expect(loadResult.value.activeTasks).toEqual(['Task A']);
      }

      // Step 4: Clear context
      const clearResult = await server.callTool('ben_ten_clear', {});
      expect(isOk(clearResult)).toBe(true);
      if (isOk(clearResult)) {
        expect(clearResult.value.cleared).toBe(true);
      }

      // Step 5: Verify status shows no context
      const finalStatus = await server.callTool('ben_ten_status', {});
      expect(isOk(finalStatus)).toBe(true);
      if (isOk(finalStatus)) {
        expect(finalStatus.value.hasContext).toBe(false);
      }
    });

    it('handles multiple save cycles preserving createdAt', async () => {
      // First save
      await server.callTool('ben_ten_save', {
        sessionId: 'session-1',
        summary: 'First save',
      });

      // Get first context to check createdAt
      let loadResult = await server.callTool('ben_ten_load', {});
      expect(isOk(loadResult)).toBe(true);
      const firstCreatedAt = isOk(loadResult) ? loadResult.value.createdAt : 0;

      // Second save (should preserve createdAt)
      await server.callTool('ben_ten_save', {
        sessionId: 'session-2',
        summary: 'Second save',
      });

      // Verify createdAt preserved
      loadResult = await server.callTool('ben_ten_load', {});
      expect(isOk(loadResult)).toBe(true);
      if (isOk(loadResult)) {
        expect(loadResult.value.createdAt).toBe(firstCreatedAt);
        expect(loadResult.value.sessionId).toBe('session-2');
        expect(loadResult.value.summary).toBe('Second save');
      }

      // Third save
      await server.callTool('ben_ten_save', {
        sessionId: 'session-3',
        summary: 'Third save',
        keyFiles: ['new-file.ts'],
      });

      // Verify createdAt still preserved
      loadResult = await server.callTool('ben_ten_load', {});
      expect(isOk(loadResult)).toBe(true);
      if (isOk(loadResult)) {
        expect(loadResult.value.createdAt).toBe(firstCreatedAt);
        expect(loadResult.value.sessionId).toBe('session-3');
        expect(loadResult.value.keyFiles).toEqual(['new-file.ts']);
      }
    });
  });

  describe('edge cases', () => {
    it('handles very long summaries', async () => {
      const longSummary = 'A'.repeat(10000);
      const result = await server.callTool('ben_ten_save', {
        sessionId: 'long-summary-test',
        summary: longSummary,
      });

      expect(isOk(result)).toBe(true);

      const loadResult = await server.callTool('ben_ten_load', {});
      expect(isOk(loadResult)).toBe(true);
      if (isOk(loadResult)) {
        expect(loadResult.value.summary.length).toBe(10000);
      }
    });

    it('handles many keyFiles', async () => {
      const manyFiles = Array.from(
        { length: 100 },
        (_, i) => `src/file${i}.ts`,
      );
      const result = await server.callTool('ben_ten_save', {
        sessionId: 'many-files-test',
        summary: 'Test',
        keyFiles: manyFiles,
      });

      expect(isOk(result)).toBe(true);

      const loadResult = await server.callTool('ben_ten_load', {});
      expect(isOk(loadResult)).toBe(true);
      if (isOk(loadResult)) {
        expect(loadResult.value.keyFiles).toHaveLength(100);
      }
    });

    it('handles unicode in summary and tasks', async () => {
      const result = await server.callTool('ben_ten_save', {
        sessionId: 'unicode-test',
        summary: 'Summary with émojis 🚀 and 日本語',
        activeTasks: ['Task avec accénts', '任务一'],
      });

      expect(isOk(result)).toBe(true);

      const loadResult = await server.callTool('ben_ten_load', {});
      expect(isOk(loadResult)).toBe(true);
      if (isOk(loadResult)) {
        expect(loadResult.value.summary).toBe(
          'Summary with émojis 🚀 and 日本語',
        );
        expect(loadResult.value.activeTasks).toEqual([
          'Task avec accénts',
          '任务一',
        ]);
      }
    });
  });

  describe('enriched save with transcript parsing', () => {
    const transcriptPath = '/home/user/.claude/session.jsonl';

    beforeEach(async () => {
      // Set up metadata with transcript path (simulating what hook handler does)
      const metadata: ContextMetadata = {
        directory: projectDir,
        directoryHash: 'abc123',
        lastSessionId: 'test-session',
        sessionCount: 1,
        lastSavedAt: Date.now(),
        transcriptPath,
      };
      await fs.mkdir(`${projectDir}/${BEN10_DIR}`, { recursive: true });
      await fs.writeFile(
        `${projectDir}/${BEN10_DIR}/${METADATA_FILE}`,
        JSON.stringify(metadata),
      );
    });

    it('saves v2.0.0 context with conversation history from transcript', async () => {
      // Create a transcript file
      const transcript = createTranscript([
        createUserEntry('Hello, can you help me?'),
        createAssistantEntry('Of course! What do you need?'),
        createUserEntry('Read `src/index.ts` please'),
        createAssistantEntry('Using Read tool to read the file'),
      ]);
      await setupTranscriptFile(fs, transcriptPath, transcript);

      // Save context
      const result = await server.callTool('ben_ten_save', {
        sessionId: 'enriched-test',
        summary: 'User asked for help with index.ts',
      });

      expect(isOk(result)).toBe(true);

      // Load and verify enriched context
      const loadResult = await server.callTool('ben_ten_load', {});
      expect(isOk(loadResult)).toBe(true);
      if (isOk(loadResult)) {
        const ctx = loadResult.value as ContextData;
        expect(ctx.version).toBe('2.0.0');
        expect(ctx.summary).toBe('User asked for help with index.ts');

        // Verify conversation was parsed
        expect(ctx.conversation).toBeDefined();
        expect(ctx.conversation?.messages).toHaveLength(4);
        expect(ctx.conversation?.messageCount).toBe(4);

        // Verify file references extracted
        expect(ctx.files).toBeDefined();
        expect(ctx.files?.some((f) => f.path === 'src/index.ts')).toBe(true);

        // Verify tool history extracted
        expect(ctx.toolHistory).toBeDefined();
        expect(ctx.toolHistory?.some((t) => t.toolName === 'Read')).toBe(true);
      }
    });

    it('saves v2.0.0 even without transcript', async () => {
      // No transcript file exists
      const result = await server.callTool('ben_ten_save', {
        sessionId: 'no-transcript-test',
        summary: 'Context without transcript',
        keyFiles: ['src/main.ts'],
      });

      expect(isOk(result)).toBe(true);

      const loadResult = await server.callTool('ben_ten_load', {});
      expect(isOk(loadResult)).toBe(true);
      if (isOk(loadResult)) {
        const ctx = loadResult.value as ContextData;
        expect(ctx.version).toBe('2.0.0');
        expect(ctx.summary).toBe('Context without transcript');
        expect(ctx.keyFiles).toEqual(['src/main.ts']);
        // No conversation since transcript doesn't exist
        expect(ctx.conversation).toBeUndefined();
      }
    });

    it('merges user-provided keyFiles with extracted file references', async () => {
      const transcript = createTranscript([
        createAssistantEntry('Looking at `src/extracted.ts`'),
      ]);
      await setupTranscriptFile(fs, transcriptPath, transcript);

      const result = await server.callTool('ben_ten_save', {
        sessionId: 'merge-files-test',
        summary: 'Test file merging',
        keyFiles: ['src/provided.ts'],
      });

      expect(isOk(result)).toBe(true);

      const loadResult = await server.callTool('ben_ten_load', {});
      expect(isOk(loadResult)).toBe(true);
      if (isOk(loadResult)) {
        const ctx = loadResult.value as ContextData;
        // User-provided keyFiles should be preserved
        expect(ctx.keyFiles).toContain('src/provided.ts');
        // Extracted files should be in the files array
        expect(ctx.files?.some((f) => f.path === 'src/extracted.ts')).toBe(
          true,
        );
      }
    });

    it('handles malformed transcript lines gracefully', async () => {
      // Mix valid and invalid lines
      const content = [
        JSON.stringify(createUserEntry('Valid message')),
        'not valid json at all',
        JSON.stringify(createAssistantEntry('Another valid message')),
      ].join('\n');
      await setupTranscriptFile(fs, transcriptPath, content);

      const result = await server.callTool('ben_ten_save', {
        sessionId: 'malformed-test',
        summary: 'Should handle malformed lines',
      });

      expect(isOk(result)).toBe(true);

      const loadResult = await server.callTool('ben_ten_load', {});
      expect(isOk(loadResult)).toBe(true);
      if (isOk(loadResult)) {
        const ctx = loadResult.value as ContextData;
        // Only valid messages should be parsed
        expect(ctx.conversation?.messages).toHaveLength(2);
      }
    });
  });
});
