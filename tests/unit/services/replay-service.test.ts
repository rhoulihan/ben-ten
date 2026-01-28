import { describe, expect, it } from 'vitest';
import type { TranscriptEntry } from '../../../src/core/types.js';
import { LogLevel, createLogger } from '../../../src/infrastructure/logger.js';
import { isOk } from '../../../src/infrastructure/result.js';
import {
  type ReplayOptions,
  type ReplayResult,
  type StoppingPoint,
  createReplayService,
  estimateTokens,
  findAllStoppingPoints,
  isGitCommit,
  isSemanticMarker,
  isTaskCompletion,
} from '../../../src/services/replay-service.js';
import {
  createAssistantEntry,
  createTextBlock,
  createToolUseBlock,
  createUserEntry,
} from '../../fixtures/transcript-factory.js';

describe('ReplayService', () => {
  const logger = createLogger({ level: LogLevel.ERROR });
  const service = createReplayService({ logger });

  describe('estimateTokens', () => {
    it('estimates 1 token per 4 characters', () => {
      expect(estimateTokens('a'.repeat(4))).toBe(1);
      expect(estimateTokens('a'.repeat(8))).toBe(2);
      expect(estimateTokens('a'.repeat(100))).toBe(25);
    });

    it('handles empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('rounds down partial tokens', () => {
      expect(estimateTokens('abc')).toBe(0);
      expect(estimateTokens('abcde')).toBe(1);
    });
  });

  describe('isGitCommit', () => {
    it('detects git commit command in Bash tool', () => {
      const entry = createAssistantEntry([
        createTextBlock("I'll commit the changes"),
        createToolUseBlock('Bash', { command: 'git commit -m "Fix bug"' }),
      ]);

      expect(isGitCommit(entry)).toBe(true);
    });

    it('detects git commit with various formats', () => {
      const formats = [
        'git commit -m "message"',
        "git commit -m 'message'",
        'git add . && git commit -m "message"',
        'git commit --message="test"',
        'git commit -am "amend"',
      ];

      for (const cmd of formats) {
        const entry = createAssistantEntry([
          createToolUseBlock('Bash', { command: cmd }),
        ]);
        expect(isGitCommit(entry)).toBe(true);
      }
    });

    it('returns false for non-commit git commands', () => {
      const nonCommits = [
        'git status',
        'git log',
        'git diff',
        'git push',
        'git pull',
      ];

      for (const cmd of nonCommits) {
        const entry = createAssistantEntry([
          createToolUseBlock('Bash', { command: cmd }),
        ]);
        expect(isGitCommit(entry)).toBe(false);
      }
    });

    it('returns false for user entries', () => {
      const entry = createUserEntry('git commit -m "test"');
      expect(isGitCommit(entry)).toBe(false);
    });

    it('returns false for entries without Bash tool', () => {
      const entry = createAssistantEntry([
        createToolUseBlock('Read', { file_path: '/test.ts' }),
      ]);
      expect(isGitCommit(entry)).toBe(false);
    });
  });

  describe('isTaskCompletion', () => {
    it('detects task update to completed in tool call', () => {
      const entry = createAssistantEntry([
        createToolUseBlock('TaskUpdate', {
          taskId: '1',
          status: 'completed',
        }),
      ]);

      expect(isTaskCompletion(entry)).toBe(true);
    });

    it('returns false for task update to other status', () => {
      const entry = createAssistantEntry([
        createToolUseBlock('TaskUpdate', {
          taskId: '1',
          status: 'in_progress',
        }),
      ]);

      expect(isTaskCompletion(entry)).toBe(false);
    });

    it('returns false for non-task tools', () => {
      const entry = createAssistantEntry([
        createToolUseBlock('Bash', { command: 'echo test' }),
      ]);

      expect(isTaskCompletion(entry)).toBe(false);
    });
  });

  describe('isSemanticMarker', () => {
    it('detects "done" in assistant text', () => {
      const entry = createAssistantEntry(
        'Done! The feature is now implemented.',
      );

      expect(isSemanticMarker(entry)).toBe(true);
    });

    it('detects "complete" variations', () => {
      const phrases = [
        'The task is complete.',
        'I have completed the work.',
        "That's finished now.",
      ];

      for (const phrase of phrases) {
        const entry = createAssistantEntry(phrase);
        expect(isSemanticMarker(entry)).toBe(true);
      }
    });

    it('detects transition phrases', () => {
      const phrases = [
        'Moving on to the next task.',
        "Let's work on the tests now.",
        'Next up is the integration.',
        "Now let's implement the handler.",
      ];

      for (const phrase of phrases) {
        const entry = createAssistantEntry(phrase);
        expect(isSemanticMarker(entry)).toBe(true);
      }
    });

    it('returns false for unrelated text', () => {
      const entry = createAssistantEntry(
        "I'll read the file and check the implementation.",
      );

      expect(isSemanticMarker(entry)).toBe(false);
    });

    it('returns false for user entries', () => {
      const entry = createUserEntry("Done! Let's move on.");
      expect(isSemanticMarker(entry)).toBe(false);
    });
  });

  describe('findAllStoppingPoints', () => {
    it('finds all git commits', () => {
      const messages: TranscriptEntry[] = [
        createUserEntry('First'),
        createAssistantEntry([
          createToolUseBlock('Bash', { command: 'git commit -m "first"' }),
        ]),
        createUserEntry('Second'),
        createAssistantEntry([
          createToolUseBlock('Bash', { command: 'git commit -m "second"' }),
        ]),
        createUserEntry('Third'),
      ];

      const points = findAllStoppingPoints(messages);

      expect(points).toHaveLength(2);
      // Most recent first
      expect(points[0]?.index).toBe(3);
      expect(points[0]?.type).toBe('git_commit');
      expect(points[1]?.index).toBe(1);
      expect(points[1]?.type).toBe('git_commit');
    });

    it('finds mixed stopping point types', () => {
      const messages: TranscriptEntry[] = [
        createUserEntry('First'),
        createAssistantEntry('Done! First task complete.'), // semantic marker
        createUserEntry('Second'),
        createAssistantEntry([
          createToolUseBlock('TaskUpdate', {
            taskId: '1',
            status: 'completed',
          }),
        ]), // task completion
        createUserEntry('Third'),
        createAssistantEntry([
          createToolUseBlock('Bash', { command: 'git commit -m "test"' }),
        ]), // git commit
        createUserEntry('Fourth'),
      ];

      const points = findAllStoppingPoints(messages);

      expect(points).toHaveLength(3);
      // Ordered from most recent to oldest
      expect(points[0]?.type).toBe('git_commit');
      expect(points[1]?.type).toBe('task_completion');
      expect(points[2]?.type).toBe('semantic_marker');
    });

    it('returns empty array when no stopping points', () => {
      const messages: TranscriptEntry[] = [
        createUserEntry('Hello'),
        createAssistantEntry('Hi there'),
      ];

      const points = findAllStoppingPoints(messages);

      expect(points).toHaveLength(0);
    });
  });

  describe('generateReplay', () => {
    it('returns empty replay for empty messages', () => {
      const result = service.generateReplay([]);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.replay).toBe('');
        expect(result.value.messageCount).toBe(0);
        expect(result.value.stoppingPointType).toBeNull();
        expect(result.value.allStoppingPoints).toHaveLength(0);
        expect(result.value.currentStopIndex).toBe(-1);
      }
    });

    it('stops at git commit and includes messages after it', () => {
      const messages: TranscriptEntry[] = [
        createUserEntry('Start working on feature'),
        createAssistantEntry('Working on feature'),
        createUserEntry('Commit the changes'),
        createAssistantEntry([
          createTextBlock('Committing now'),
          createToolUseBlock('Bash', {
            command: 'git commit -m "Add feature"',
          }),
        ]),
        createUserEntry('Now add tests'),
        createAssistantEntry('Adding tests'),
      ];

      const result = service.generateReplay(messages);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.stoppingPointType).toBe('git_commit');
        // Should include messages AFTER the git commit
        expect(result.value.replay).toContain('Now add tests');
        expect(result.value.replay).toContain('Adding tests');
        // Should NOT include messages before or at the commit
        expect(result.value.replay).not.toContain('Start working on feature');
      }
    });

    it('respects token budget', () => {
      const longMessage = 'A'.repeat(1000);
      const messages: TranscriptEntry[] = [
        createUserEntry('First'),
        createAssistantEntry(longMessage),
        createUserEntry('Second'),
        createAssistantEntry(longMessage),
        createUserEntry('Third'),
        createAssistantEntry('Short response'),
      ];

      // Set a very small token budget
      const result = service.generateReplay(messages, { maxTokens: 100 });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        // Should not exceed budget
        expect(result.value.tokenCount).toBeLessThanOrEqual(100);
        expect(result.value.stoppingPointType).toBe('token_budget');
      }
    });

    it('includes messages after task completion', () => {
      const messages: TranscriptEntry[] = [
        createUserEntry('Work on task 1'),
        createAssistantEntry([
          createTextBlock('Completing task'),
          createToolUseBlock('TaskUpdate', {
            taskId: '1',
            status: 'completed',
          }),
        ]),
        createUserEntry('Now task 2'),
        createAssistantEntry('Starting task 2'),
      ];

      const result = service.generateReplay(messages);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.stoppingPointType).toBe('task_completion');
        expect(result.value.replay).toContain('Now task 2');
      }
    });

    it('uses semantic marker as fallback stopping point', () => {
      const messages: TranscriptEntry[] = [
        createUserEntry('First task'),
        createAssistantEntry('Done! The first task is complete.'),
        createUserEntry('Second task'),
        createAssistantEntry('Working on second task'),
      ];

      const result = service.generateReplay(messages, { maxTokens: 50000 });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.stoppingPointType).toBe('semantic_marker');
        expect(result.value.replay).toContain('Second task');
      }
    });

    it('prioritizes git commit over task completion', () => {
      const messages: TranscriptEntry[] = [
        createUserEntry('First'),
        createAssistantEntry([
          createToolUseBlock('TaskUpdate', {
            taskId: '1',
            status: 'completed',
          }),
        ]),
        createUserEntry('Second'),
        createAssistantEntry([
          createToolUseBlock('Bash', { command: 'git commit -m "test"' }),
        ]),
        createUserEntry('Third'),
        createAssistantEntry('Final'),
      ];

      const result = service.generateReplay(messages);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        // Should stop at git commit (most recent stopping point going backwards)
        expect(result.value.stoppingPointType).toBe('git_commit');
        expect(result.value.replay).toContain('Third');
        expect(result.value.replay).not.toContain('Second');
      }
    });

    it('uses full budget when no stopping point found', () => {
      const messages: TranscriptEntry[] = [
        createUserEntry('Question 1'),
        createAssistantEntry('Answer 1'),
        createUserEntry('Question 2'),
        createAssistantEntry('Answer 2'),
      ];

      const result = service.generateReplay(messages, { maxTokens: 50000 });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.stoppingPointType).toBeNull();
        // Should include all messages since no stopping point
        expect(result.value.replay).toContain('Question 1');
        expect(result.value.replay).toContain('Answer 2');
      }
    });

    it('includes allStoppingPoints in result', () => {
      const messages: TranscriptEntry[] = [
        createUserEntry('First'),
        createAssistantEntry([
          createToolUseBlock('Bash', { command: 'git commit -m "first"' }),
        ]),
        createUserEntry('Second'),
        createAssistantEntry([
          createToolUseBlock('Bash', { command: 'git commit -m "second"' }),
        ]),
        createUserEntry('Third'),
      ];

      const result = service.generateReplay(messages);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.allStoppingPoints).toHaveLength(2);
        expect(result.value.currentStopIndex).toBe(0);
        expect(result.value.startMessageIndex).toBe(4); // After second commit (index 3)
      }
    });

    it('uses stopPointIndex to go to previous stopping point', () => {
      const messages: TranscriptEntry[] = [
        createUserEntry('First'),
        createAssistantEntry([
          createToolUseBlock('Bash', { command: 'git commit -m "first"' }),
        ]),
        createUserEntry('Second'),
        createAssistantEntry([
          createToolUseBlock('Bash', { command: 'git commit -m "second"' }),
        ]),
        createUserEntry('Third'),
        createAssistantEntry('Third response'),
      ];

      // First call - uses most recent stopping point (index 0)
      const result1 = service.generateReplay(messages);
      expect(isOk(result1)).toBe(true);
      if (isOk(result1)) {
        expect(result1.value.currentStopIndex).toBe(0);
        expect(result1.value.replay).toContain('Third');
        expect(result1.value.replay).not.toContain('Second');
      }

      // Second call - uses previous stopping point (index 1)
      const result2 = service.generateReplay(messages, { stopPointIndex: 1 });
      expect(isOk(result2)).toBe(true);
      if (isOk(result2)) {
        expect(result2.value.currentStopIndex).toBe(1);
        expect(result2.value.replay).toContain('Second');
        expect(result2.value.replay).toContain('Third');
        expect(result2.value.replay).not.toContain('First');
      }
    });

    it('reuses provided stoppingPoints to avoid re-scanning', () => {
      const messages: TranscriptEntry[] = [
        createUserEntry('First'),
        createAssistantEntry([
          createToolUseBlock('Bash', { command: 'git commit -m "first"' }),
        ]),
        createUserEntry('Second'),
        createAssistantEntry([
          createToolUseBlock('Bash', { command: 'git commit -m "second"' }),
        ]),
        createUserEntry('Third'),
      ];

      // Get stopping points from first call
      const result1 = service.generateReplay(messages);
      expect(isOk(result1)).toBe(true);
      if (!isOk(result1)) return;

      const stoppingPoints = result1.value.allStoppingPoints;

      // Reuse stopping points in second call
      const result2 = service.generateReplay(messages, {
        stopPointIndex: 1,
        stoppingPoints,
      });

      expect(isOk(result2)).toBe(true);
      if (isOk(result2)) {
        expect(result2.value.allStoppingPoints).toBe(stoppingPoints); // Same reference
        expect(result2.value.currentStopIndex).toBe(1);
      }
    });

    it('handles stopPointIndex beyond available stopping points', () => {
      const messages: TranscriptEntry[] = [
        createUserEntry('First'),
        createAssistantEntry([
          createToolUseBlock('Bash', { command: 'git commit -m "only"' }),
        ]),
        createUserEntry('Second'),
      ];

      // Try to use stopPointIndex 5 when only 1 stopping point exists
      const result = service.generateReplay(messages, { stopPointIndex: 5 });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        // Should fall back to no stopping point behavior
        expect(result.value.currentStopIndex).toBe(-1);
        expect(result.value.stoppingPointType).toBeNull();
      }
    });

    it('tracks startMessageIndex correctly', () => {
      const messages: TranscriptEntry[] = [
        createUserEntry('0'),
        createAssistantEntry('1'),
        createUserEntry('2'),
        createAssistantEntry([
          createToolUseBlock('Bash', { command: 'git commit -m "test"' }),
        ]), // index 3
        createUserEntry('4'),
        createAssistantEntry('5'),
      ];

      const result = service.generateReplay(messages);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.startMessageIndex).toBe(4); // After commit at index 3
        expect(result.value.messageCount).toBe(2); // Messages at index 4 and 5
      }
    });
  });

  describe('formatReplay', () => {
    it('formats user messages with text content', () => {
      const messages: TranscriptEntry[] = [
        createUserEntry('How do I fix this bug?'),
      ];

      const result = service.generateReplay(messages);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.replay).toContain('**User:**');
        expect(result.value.replay).toContain('How do I fix this bug?');
      }
    });

    it('formats assistant messages with text and tool summary', () => {
      const messages: TranscriptEntry[] = [
        createAssistantEntry([
          createTextBlock('Let me check the file'),
          createToolUseBlock('Read', { file_path: '/src/index.ts' }),
        ]),
      ];

      const result = service.generateReplay(messages);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.replay).toContain('**Assistant:**');
        expect(result.value.replay).toContain('Let me check the file');
        expect(result.value.replay).toContain('[Read: /src/index.ts]');
      }
    });

    it('truncates long user messages', () => {
      const longMessage = 'A'.repeat(600);
      const messages: TranscriptEntry[] = [createUserEntry(longMessage)];

      const result = service.generateReplay(messages);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.replay.length).toBeLessThan(700);
        expect(result.value.replay).toContain('...');
      }
    });

    it('formats Bash tool with truncated command', () => {
      const longCommand = 'echo ' + 'test '.repeat(20);
      const messages: TranscriptEntry[] = [
        createAssistantEntry([
          createToolUseBlock('Bash', { command: longCommand }),
        ]),
      ];

      const result = service.generateReplay(messages);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.replay).toContain('[Bash:');
        // Command should be truncated
        expect(result.value.replay.length).toBeLessThan(longCommand.length);
      }
    });

    it('formats Edit tool with file path', () => {
      const messages: TranscriptEntry[] = [
        createAssistantEntry([
          createToolUseBlock('Edit', {
            file_path: '/src/utils/helper.ts',
            old_string: 'old',
            new_string: 'new',
          }),
        ]),
      ];

      const result = service.generateReplay(messages);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.replay).toContain('[Edit: /src/utils/helper.ts]');
      }
    });

    it('formats Write tool with file path', () => {
      const messages: TranscriptEntry[] = [
        createAssistantEntry([
          createToolUseBlock('Write', {
            file_path: '/src/new-file.ts',
            content: 'file content',
          }),
        ]),
      ];

      const result = service.generateReplay(messages);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.replay).toContain('[Write: /src/new-file.ts]');
      }
    });

    it('formats Glob tool with pattern', () => {
      const messages: TranscriptEntry[] = [
        createAssistantEntry([
          createToolUseBlock('Glob', { pattern: '**/*.ts' }),
        ]),
      ];

      const result = service.generateReplay(messages);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.replay).toContain('[Glob: **/*.ts]');
      }
    });

    it('formats Grep tool with pattern', () => {
      const messages: TranscriptEntry[] = [
        createAssistantEntry([
          createToolUseBlock('Grep', { pattern: 'TODO:' }),
        ]),
      ];

      const result = service.generateReplay(messages);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.replay).toContain('[Grep: TODO:]');
      }
    });

    it('formats Task tool with description', () => {
      const messages: TranscriptEntry[] = [
        createAssistantEntry([
          createToolUseBlock('Task', {
            description: 'Explore codebase',
            prompt: 'Find all API endpoints',
          }),
        ]),
      ];

      const result = service.generateReplay(messages);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.replay).toContain('[Task: Explore codebase]');
      }
    });

    it('omits thinking blocks', () => {
      const messages: TranscriptEntry[] = [
        createAssistantEntry([
          { type: 'thinking', thinking: 'Let me think about this...' },
          createTextBlock('Here is my answer'),
        ]),
      ];

      const result = service.generateReplay(messages);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.replay).not.toContain('think');
        expect(result.value.replay).toContain('Here is my answer');
      }
    });

    it('adds header to replay', () => {
      const messages: TranscriptEntry[] = [
        createUserEntry('Hello'),
        createAssistantEntry('Hi there!'),
      ];

      const result = service.generateReplay(messages);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.replay).toMatch(/^## Recent Conversation/);
      }
    });
  });
});
