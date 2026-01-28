import type { FileSystem } from '../adapters/fs/memory-fs.js';
import { createNodeFs } from '../adapters/fs/node-fs.js';
import { parseHookInput } from '../core/types.js';
import {
  type BenTenError,
  ErrorCode,
  createError,
} from '../infrastructure/errors.js';
import { LogLevel, createLogger } from '../infrastructure/logger.js';
import { type Result, err, ok } from '../infrastructure/result.js';
import {
  type SessionStartResult,
  createHookHandler,
} from '../services/hook-handler.js';

/** Result of running the hook command */
export interface HookCommandResult {
  success: boolean;
  output?: string;
  error?: string;
}

export interface HookCommandOptions {
  fs?: FileSystem;
}

/**
 * Run the hook command with JSON input from stdin.
 * This is called by Claude Code hooks.
 *
 * @param input - JSON string containing hook input
 * @param options - Optional dependencies for testing
 * @returns Result with command output
 */
export const runHookCommand = async (
  input: string,
  options: HookCommandOptions = {},
): Promise<Result<HookCommandResult, BenTenError>> => {
  const fs = options.fs ?? createNodeFs();
  const logger = createLogger({ level: LogLevel.INFO });

  // Parse JSON input
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (e) {
    return err(
      createError(ErrorCode.HOOK_INVALID_INPUT, 'Invalid JSON input', {
        error: e instanceof Error ? e.message : String(e),
      }),
    );
  }

  // Validate hook input structure
  const validateResult = parseHookInput(parsed);
  if (!validateResult.ok) {
    return err(
      createError(
        ErrorCode.HOOK_INVALID_INPUT,
        'Invalid hook input structure',
        { errors: validateResult.error.details },
      ),
    );
  }

  const hookInput = validateResult.value;
  const handler = createHookHandler({ fs, logger });

  // Handle the hook event
  const handleResult = await handler.handle(hookInput);
  if (!handleResult.ok) {
    return err(handleResult.error);
  }

  // Build output for stdout
  let output = '';

  // For SessionStart with loaded context, output the summary
  if (hookInput.hook_event_name === 'SessionStart') {
    const result = handleResult.value as SessionStartResult;
    if (result.contextLoaded && result.context) {
      const ctx = result.context;

      // Format the last updated time in a human-readable way
      const lastUpdated = new Date(ctx.updatedAt);
      const now = new Date();
      const diffMs = now.getTime() - lastUpdated.getTime();
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffHours / 24);

      let timeAgo: string;
      if (diffDays > 0) {
        timeAgo = `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
      } else if (diffHours > 0) {
        timeAgo = `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
      } else {
        const diffMins = Math.floor(diffMs / (1000 * 60));
        timeAgo =
          diffMins > 0
            ? `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`
            : 'just now';
      }

      output = [
        '# Ben-Ten Context Loaded',
        '',
        `**Previous Session:** ${ctx.sessionId}`,
        `**Last Updated:** ${timeAgo} (${lastUpdated.toISOString()})`,
        '',
        '## Summary',
        ctx.summary,
      ].join('\n');

      if (ctx.keyFiles && ctx.keyFiles.length > 0) {
        output += '\n\n## Key Files\n';
        output += ctx.keyFiles.map((f) => `- ${f}`).join('\n');
      }

      if (ctx.activeTasks && ctx.activeTasks.length > 0) {
        output += '\n\n## Active Tasks\n';
        output += ctx.activeTasks.map((t) => `- ${t}`).join('\n');
      }

      // Include conversation replay if available
      if (ctx.conversationReplay) {
        output += `\n\n${ctx.conversationReplay}`;

        if (ctx.replayMetadata) {
          const meta = ctx.replayMetadata;
          const totalStops = meta.allStoppingPoints?.length ?? 0;
          const currentStop = (meta.currentStopIndex ?? -1) + 1;
          const remainingStops = totalStops - currentStop;

          output += '\n\n---\n';
          output += `*Replay: ${meta.messageCount} messages, ~${meta.tokenCount} tokens`;
          if (meta.stoppingPointType) {
            output += ` | Stopped at: ${meta.stoppingPointType}`;
          }
          if (totalStops > 0) {
            output += ` | Stopping point ${currentStop} of ${totalStops}`;
          }
          output += '*';

          // Add instruction for loading more context if there are more stopping points
          if (remainingStops > 0) {
            output += `\n\n> **Need more context?** Call \`ben_ten_loadMore\` to load back to the previous stopping point (${remainingStops} more available).`;
          }
        }
      }
    }
  }

  return ok({
    success: true,
    output: output || undefined,
  });
};

/**
 * Main entry point for the hook command.
 * Reads from stdin and writes to stdout/stderr.
 */
export const main = async (): Promise<void> => {
  // Read all input from stdin
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const input = Buffer.concat(chunks).toString('utf-8');

  const result = await runHookCommand(input);

  if (result.ok) {
    if (result.value.output) {
      process.stdout.write(result.value.output);
    }
    process.exit(0);
  } else {
    process.stderr.write(`Error: ${result.error.message}\n`);
    process.exit(1);
  }
};
