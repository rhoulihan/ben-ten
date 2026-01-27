import { z } from 'zod';
import {
  type Ben10Error,
  ErrorCode,
  createError,
} from '../infrastructure/errors.js';
import { type Result, err, ok } from '../infrastructure/result.js';

/**
 * Schema for Claude Code hook input received via stdin.
 * This is the JSON that Claude Code passes to hook commands.
 */
export const HookInputSchema = z.object({
  /** Unique session identifier */
  session_id: z.string(),
  /** Path to the conversation transcript (JSONL format) */
  transcript_path: z.string(),
  /** Current working directory */
  cwd: z.string(),
  /** Current permission mode (optional) */
  permission_mode: z.string().optional(),
  /** Name of the hook event */
  hook_event_name: z.enum(['SessionStart', 'SessionEnd', 'PreCompact']),
  /** Model being used (optional) */
  model: z.string().optional(),
  /** Source of SessionStart (startup, resume, compact, clear) */
  source: z.enum(['startup', 'resume', 'compact', 'clear']).optional(),
  /** Trigger for PreCompact (manual or auto) */
  trigger: z.enum(['manual', 'auto']).optional(),
  /** Custom instructions for compaction */
  custom_instructions: z.string().optional(),
});

export type HookInput = z.infer<typeof HookInputSchema>;

/**
 * Schema for the persisted context data.
 * This is what Ben10 saves to .ben10/context.json
 */
export const ContextDataSchema = z.object({
  /** Schema version for migrations */
  version: z.string(),
  /** When this context was first created */
  createdAt: z.number(),
  /** When this context was last updated */
  updatedAt: z.number(),
  /** Session ID that last updated this context */
  sessionId: z.string(),
  /** Summary/compacted content from Claude */
  summary: z.string(),
  /** Optional excerpt from the transcript */
  transcriptExcerpt: z.string().optional(),
  /** Optional list of key files referenced */
  keyFiles: z.array(z.string()).optional(),
  /** Optional list of active tasks/objectives */
  activeTasks: z.array(z.string()).optional(),
});

export type ContextData = z.infer<typeof ContextDataSchema>;

/**
 * Schema for context metadata stored separately.
 * This allows quick checks without loading full context.
 */
export const ContextMetadataSchema = z.object({
  /** Directory this context belongs to */
  directory: z.string(),
  /** Hash of the directory path for identification */
  directoryHash: z.string(),
  /** Last session ID that modified this context */
  lastSessionId: z.string(),
  /** Number of sessions that have used this context */
  sessionCount: z.number(),
  /** Timestamp of last save */
  lastSavedAt: z.number(),
  /** Path to the transcript this was derived from */
  transcriptPath: z.string().optional(),
});

export type ContextMetadata = z.infer<typeof ContextMetadataSchema>;

/**
 * Parse and validate hook input from Claude Code.
 *
 * @param input - Raw input (object or JSON string)
 * @returns Result with validated HookInput or error
 */
export const parseHookInput = (
  input: unknown,
): Result<HookInput, Ben10Error> => {
  try {
    // If input is a string, try to parse it as JSON
    const data = typeof input === 'string' ? JSON.parse(input) : input;

    const result = HookInputSchema.safeParse(data);

    if (result.success) {
      return ok(result.data);
    }

    return err(
      createError(ErrorCode.HOOK_INVALID_INPUT, 'Invalid hook input format', {
        errors: result.error.errors,
      }),
    );
  } catch (e) {
    return err(
      createError(ErrorCode.HOOK_INVALID_INPUT, 'Failed to parse hook input', {
        error: e instanceof Error ? e.message : String(e),
      }),
    );
  }
};

/**
 * Parse and validate context data.
 *
 * @param data - Raw context data
 * @returns Result with validated ContextData or error
 */
export const parseContextData = (
  data: unknown,
): Result<ContextData, Ben10Error> => {
  const result = ContextDataSchema.safeParse(data);

  if (result.success) {
    return ok(result.data);
  }

  return err(
    createError(ErrorCode.VALIDATION_FAILED, 'Invalid context data format', {
      errors: result.error.errors,
    }),
  );
};

/**
 * Parse and validate context metadata.
 *
 * @param data - Raw metadata
 * @returns Result with validated ContextMetadata or error
 */
export const parseContextMetadata = (
  data: unknown,
): Result<ContextMetadata, Ben10Error> => {
  const result = ContextMetadataSchema.safeParse(data);

  if (result.success) {
    return ok(result.data);
  }

  return err(
    createError(
      ErrorCode.VALIDATION_FAILED,
      'Invalid context metadata format',
      { errors: result.error.errors },
    ),
  );
};

/**
 * Create a new empty context data structure.
 *
 * @param sessionId - The session creating this context
 * @returns A new ContextData object
 */
export const createEmptyContext = (sessionId: string): ContextData => {
  const now = Date.now();
  return {
    version: '1.0.0',
    createdAt: now,
    updatedAt: now,
    sessionId,
    summary: '',
  };
};

/**
 * Update context data with new information.
 *
 * @param context - Existing context
 * @param updates - Fields to update
 * @returns Updated context data
 */
export const updateContext = (
  context: ContextData,
  updates: Partial<Omit<ContextData, 'version' | 'createdAt'>>,
): ContextData => {
  return {
    ...context,
    ...updates,
    updatedAt: Date.now(),
  };
};
