import { beforeEach, describe, expect, it } from 'vitest';
import {
  type FileSystem,
  createMemoryFs,
} from '../../../src/adapters/fs/memory-fs.js';
import { ErrorCode } from '../../../src/infrastructure/errors.js';
import { LogLevel, createLogger } from '../../../src/infrastructure/logger.js';
import { isErr, isOk } from '../../../src/infrastructure/result.js';
import {
  type TranscriptService,
  createTranscriptService,
} from '../../../src/services/transcript-service.js';
import { setupTranscriptFile } from '../../fixtures/test-helpers.js';
import {
  createAssistantEntry,
  createSummaryEntry,
  createSystemEntry,
  createTranscript,
  createUserEntry,
} from '../../fixtures/transcript-factory.js';

describe('TranscriptService', () => {
  let fs: FileSystem;
  let service: TranscriptService;
  const transcriptPath = '/home/user/.claude/projects/test/session.jsonl';

  beforeEach(() => {
    fs = createMemoryFs();
    const logger = createLogger({ level: LogLevel.ERROR });
    service = createTranscriptService({ fs, logger });
  });

  describe('parseTranscript', () => {
    it('parses a valid JSONL transcript', async () => {
      const content = createTranscript([
        createUserEntry('Hello'),
        createAssistantEntry('Hi there!'),
        createSummaryEntry('User greeted assistant'),
      ]);
      await setupTranscriptFile(fs, transcriptPath, content);

      const result = await service.parseTranscript(transcriptPath);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.messages).toHaveLength(3);
        expect(result.value.messageCount).toBe(3);
        expect(result.value.messages[0].type).toBe('user');
        expect(result.value.messages[1].type).toBe('assistant');
        expect(result.value.messages[2].type).toBe('summary');
      }
    });

    it('returns error when transcript file does not exist', async () => {
      const result = await service.parseTranscript('/nonexistent/path.jsonl');

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe(ErrorCode.TRANSCRIPT_NOT_FOUND);
      }
    });

    it('handles empty transcript file', async () => {
      await setupTranscriptFile(fs, transcriptPath, '');

      const result = await service.parseTranscript(transcriptPath);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.messages).toHaveLength(0);
        expect(result.value.messageCount).toBe(0);
      }
    });

    it('skips malformed lines gracefully', async () => {
      const content = [
        JSON.stringify(createUserEntry('Valid message')),
        'not valid json',
        JSON.stringify(createAssistantEntry('Another valid message')),
      ].join('\n');
      await setupTranscriptFile(fs, transcriptPath, content);

      const result = await service.parseTranscript(transcriptPath);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.messages).toHaveLength(2);
        expect(result.value.messageCount).toBe(2);
      }
    });

    it('skips lines with unknown entry types', async () => {
      const content = [
        JSON.stringify(createUserEntry('Valid')),
        JSON.stringify({ type: 'unknown', data: 'something' }),
        JSON.stringify(createAssistantEntry('Also valid')),
      ].join('\n');
      await setupTranscriptFile(fs, transcriptPath, content);

      const result = await service.parseTranscript(transcriptPath);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.messages).toHaveLength(2);
      }
    });

    it('parses system entries', async () => {
      const content = createTranscript([
        createUserEntry('Run the build'),
        createSystemEntry('Build completed successfully'),
        createAssistantEntry('The build succeeded!'),
      ]);
      await setupTranscriptFile(fs, transcriptPath, content);

      const result = await service.parseTranscript(transcriptPath);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.messages).toHaveLength(3);
        expect(result.value.messages[1].type).toBe('system');
      }
    });
  });

  describe('extractFileReferences', () => {
    it('extracts file paths from backticks', () => {
      const history = {
        messages: [
          {
            type: 'assistant' as const,
            content: 'I read `src/index.ts` and `src/types.ts`',
          },
          { type: 'user' as const, content: 'Check `tests/unit/foo.test.ts`' },
        ],
        messageCount: 2,
      };

      const files = service.extractFileReferences(history);

      expect(files).toContain('src/index.ts');
      expect(files).toContain('src/types.ts');
      expect(files).toContain('tests/unit/foo.test.ts');
    });

    it('deduplicates file references', () => {
      const history = {
        messages: [
          { type: 'assistant' as const, content: 'Reading `src/index.ts`' },
          {
            type: 'assistant' as const,
            content: 'Still working on `src/index.ts`',
          },
        ],
        messageCount: 2,
      };

      const files = service.extractFileReferences(history);

      expect(files.filter((f) => f === 'src/index.ts')).toHaveLength(1);
    });

    it('returns empty array for no file references', () => {
      const history = {
        messages: [
          { type: 'user' as const, content: 'Hello' },
          { type: 'assistant' as const, content: 'Hi there' },
        ],
        messageCount: 2,
      };

      const files = service.extractFileReferences(history);

      expect(files).toHaveLength(0);
    });

    it('handles summary entries without crashing', () => {
      const history = {
        messages: [
          {
            type: 'summary' as const,
            summary: 'Session summary with `file.ts`',
          },
        ],
        messageCount: 1,
      };

      const files = service.extractFileReferences(history);

      expect(files).toContain('file.ts');
    });
  });

  describe('extractToolCalls', () => {
    it('extracts tool calls from assistant content', () => {
      const history = {
        messages: [
          {
            type: 'assistant' as const,
            content: 'Using Read tool to read the file',
          },
          { type: 'assistant' as const, content: 'Using Write tool to save' },
        ],
        messageCount: 2,
      };

      const tools = service.extractToolCalls(history);

      expect(tools.some((t) => t.toolName === 'Read')).toBe(true);
      expect(tools.some((t) => t.toolName === 'Write')).toBe(true);
    });

    it('returns empty array when no tool calls found', () => {
      const history = {
        messages: [
          { type: 'user' as const, content: 'Hello' },
          { type: 'assistant' as const, content: 'Hi there' },
        ],
        messageCount: 2,
      };

      const tools = service.extractToolCalls(history);

      expect(tools).toHaveLength(0);
    });

    it('extracts common tool names', () => {
      const history = {
        messages: [
          { type: 'assistant' as const, content: 'Using Bash to run command' },
          { type: 'assistant' as const, content: 'Using Edit to modify file' },
          { type: 'assistant' as const, content: 'Using Glob to find files' },
          { type: 'assistant' as const, content: 'Using Grep to search' },
        ],
        messageCount: 4,
      };

      const tools = service.extractToolCalls(history);

      expect(tools.some((t) => t.toolName === 'Bash')).toBe(true);
      expect(tools.some((t) => t.toolName === 'Edit')).toBe(true);
      expect(tools.some((t) => t.toolName === 'Glob')).toBe(true);
      expect(tools.some((t) => t.toolName === 'Grep')).toBe(true);
    });
  });

  describe('getLatestSummary', () => {
    it('returns the latest summary from transcript', async () => {
      const content = createTranscript([
        createUserEntry('Hello'),
        createSummaryEntry('First summary'),
        createAssistantEntry('Working...'),
        createSummaryEntry('Latest summary after compaction'),
      ]);
      await setupTranscriptFile(fs, transcriptPath, content);

      const result = await service.getLatestSummary(transcriptPath);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBe('Latest summary after compaction');
      }
    });

    it('returns null when no summary exists', async () => {
      const content = createTranscript([
        createUserEntry('Hello'),
        createAssistantEntry('Hi'),
      ]);
      await setupTranscriptFile(fs, transcriptPath, content);

      const result = await service.getLatestSummary(transcriptPath);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBeNull();
      }
    });

    it('returns error when transcript does not exist', async () => {
      const result = await service.getLatestSummary('/nonexistent.jsonl');

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe(ErrorCode.TRANSCRIPT_NOT_FOUND);
      }
    });
  });
});
