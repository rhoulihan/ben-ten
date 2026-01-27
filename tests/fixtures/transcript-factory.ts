/**
 * Entry types for Claude Code transcripts.
 */
export interface SummaryEntry {
  type: 'summary';
  summary: string;
}

export interface AssistantEntry {
  type: 'assistant';
  content: string;
}

export interface UserEntry {
  type: 'user';
  content: string;
}

export interface SystemEntry {
  type: 'system';
  content: string;
}

export type TranscriptEntry =
  | SummaryEntry
  | AssistantEntry
  | UserEntry
  | SystemEntry;

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
 * Creates an assistant entry for a transcript.
 * These are the main conversation messages.
 *
 * @param content - The assistant message content
 * @returns An assistant entry object
 */
export const createAssistantEntry = (content: string): AssistantEntry => ({
  type: 'assistant',
  content,
});

/**
 * Creates a user entry for a transcript.
 * These are user messages in the conversation.
 *
 * @param content - The user message content
 * @returns A user entry object
 */
export const createUserEntry = (content: string): UserEntry => ({
  type: 'user',
  content,
});

/**
 * Creates a system entry for a transcript.
 * These are system messages (e.g., tool results, instructions).
 *
 * @param content - The system message content
 * @returns A system entry object
 */
export const createSystemEntry = (content: string): SystemEntry => ({
  type: 'system',
  content,
});

/**
 * Creates a JSONL transcript from entries.
 * Each entry is serialized as a single line of JSON.
 *
 * @param entries - Array of transcript entries
 * @returns JSONL formatted string
 * @example
 * const transcript = createTranscript([
 *   createAssistantEntry('Hello'),
 *   createSummaryEntry('User greeted'),
 * ]);
 */
export const createTranscript = (entries: TranscriptEntry[]): string => {
  if (entries.length === 0) {
    return '';
  }
  return entries.map((entry) => JSON.stringify(entry)).join('\n');
};
