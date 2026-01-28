/**
 * Entry types for Claude Code transcripts.
 * Matches the actual Claude Code JSONL transcript format.
 */
export interface SummaryEntry {
  type: 'summary';
  summary: string;
}

export interface ContentBlockText {
  type: 'text';
  text: string;
}

export interface ContentBlockThinking {
  type: 'thinking';
  thinking: string;
}

export interface ContentBlockToolUse {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export type ContentBlock =
  | ContentBlockText
  | ContentBlockThinking
  | ContentBlockToolUse;

export interface AssistantEntry {
  type: 'assistant';
  message: {
    role: 'assistant';
    content: ContentBlock[];
  };
  uuid?: string;
  timestamp?: string;
}

export interface UserEntry {
  type: 'user';
  message: {
    role: 'user';
    content: string;
  };
  uuid?: string;
  timestamp?: string;
}

export interface ProgressEntry {
  type: 'progress';
  data: unknown;
}

export interface FileHistorySnapshotEntry {
  type: 'file-history-snapshot';
  snapshot: unknown;
}

export type TranscriptEntry =
  | SummaryEntry
  | AssistantEntry
  | UserEntry
  | ProgressEntry
  | FileHistorySnapshotEntry;

/**
 * Creates a summary entry for a transcript.
 * Summary entries are created during compaction.
 *
 * @param summary - The summary text
 * @returns A summary entry object
 */
export const createSummaryEntry = (summary: string): SummaryEntry => ({
  type: 'summary',
  summary,
});

/**
 * Creates a text content block for an assistant message.
 *
 * @param text - The text content
 * @returns A text content block
 */
export const createTextBlock = (text: string): ContentBlockText => ({
  type: 'text',
  text,
});

/**
 * Creates a thinking content block for an assistant message.
 *
 * @param thinking - The thinking content
 * @returns A thinking content block
 */
export const createThinkingBlock = (
  thinking: string,
): ContentBlockThinking => ({
  type: 'thinking',
  thinking,
});

/**
 * Creates a tool_use content block for an assistant message.
 *
 * @param name - The tool name
 * @param input - The tool input
 * @param id - Optional tool use ID
 * @returns A tool_use content block
 */
export const createToolUseBlock = (
  name: string,
  input: unknown = {},
  id = `tool_${Date.now()}`,
): ContentBlockToolUse => ({
  type: 'tool_use',
  id,
  name,
  input,
});

/**
 * Creates an assistant entry for a transcript.
 * These are the main conversation messages.
 *
 * @param content - The assistant message content (string or content blocks)
 * @param options - Optional uuid and timestamp
 * @returns An assistant entry object
 */
export const createAssistantEntry = (
  content: string | ContentBlock[],
  options: { uuid?: string; timestamp?: string } = {},
): AssistantEntry => ({
  type: 'assistant',
  message: {
    role: 'assistant',
    content: typeof content === 'string' ? [createTextBlock(content)] : content,
  },
  ...(options.uuid && { uuid: options.uuid }),
  ...(options.timestamp && { timestamp: options.timestamp }),
});

/**
 * Creates a user entry for a transcript.
 * These are user messages in the conversation.
 *
 * @param content - The user message content
 * @param options - Optional uuid and timestamp
 * @returns A user entry object
 */
export const createUserEntry = (
  content: string,
  options: { uuid?: string; timestamp?: string } = {},
): UserEntry => ({
  type: 'user',
  message: {
    role: 'user',
    content,
  },
  ...(options.uuid && { uuid: options.uuid }),
  ...(options.timestamp && { timestamp: options.timestamp }),
});

/**
 * Creates a progress entry for a transcript.
 * These track hook execution and tool progress.
 *
 * @param data - The progress data
 * @returns A progress entry object
 */
export const createProgressEntry = (data: unknown = {}): ProgressEntry => ({
  type: 'progress',
  data,
});

/**
 * Creates a file history snapshot entry.
 *
 * @param snapshot - The snapshot data
 * @returns A file history snapshot entry
 */
export const createFileHistorySnapshotEntry = (
  snapshot: unknown = {},
): FileHistorySnapshotEntry => ({
  type: 'file-history-snapshot',
  snapshot,
});

/**
 * Creates a JSONL transcript from entries.
 * Each entry is serialized as a single line of JSON.
 *
 * @param entries - Array of transcript entries
 * @returns JSONL formatted string
 * @example
 * const transcript = createTranscript([
 *   createUserEntry('Hello'),
 *   createAssistantEntry('Hi there!'),
 *   createSummaryEntry('User greeted'),
 * ]);
 */
export const createTranscript = (entries: TranscriptEntry[]): string => {
  if (entries.length === 0) {
    return '';
  }
  return entries.map((entry) => JSON.stringify(entry)).join('\n');
};
