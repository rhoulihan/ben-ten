/**
 * Log levels in order of severity.
 * DEBUG < INFO < WARN < ERROR
 */
export const LogLevel = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

/**
 * Logger interface with standard log levels.
 * CRITICAL: All output goes to stderr to avoid corrupting MCP JSON-RPC on stdout.
 */
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  /** Minimum log level to output. Default: INFO */
  level?: LogLevel;
  /** Output as JSON (for structured logging). Default: false */
  json?: boolean;
  /** Additional context to include in all log entries */
  context?: Record<string, unknown>;
}

/**
 * Creates a logger that writes ONLY to stderr.
 * This is critical for MCP servers where stdout is reserved for JSON-RPC.
 *
 * @param options - Logger configuration
 * @returns A Logger instance
 * @example
 * const logger = createLogger({ level: LogLevel.DEBUG });
 * logger.info('Server started', { port: 3000 });
 */
export const createLogger = (options: LoggerOptions = {}): Logger => {
  const level = options.level ?? LogLevel.INFO;
  const json = options.json ?? false;
  const context = options.context ?? {};

  const shouldLog = (msgLevel: LogLevel): boolean => {
    return LOG_LEVEL_PRIORITY[msgLevel] >= LOG_LEVEL_PRIORITY[level];
  };

  const formatMessage = (
    msgLevel: LogLevel,
    message: string,
    meta?: Record<string, unknown>,
  ): string => {
    const timestamp = new Date().toISOString();
    const allMeta = { ...context, ...meta };

    if (json) {
      return JSON.stringify({
        timestamp,
        level: msgLevel,
        message,
        ...allMeta,
      });
    }

    const metaStr =
      Object.keys(allMeta).length > 0 ? ` ${JSON.stringify(allMeta)}` : '';

    return `[${timestamp}] ${msgLevel}: ${message}${metaStr}`;
  };

  const log = (
    msgLevel: LogLevel,
    message: string,
    meta?: Record<string, unknown>,
  ): void => {
    if (!shouldLog(msgLevel)) {
      return;
    }

    const formatted = formatMessage(msgLevel, message, meta);
    // CRITICAL: Always write to stderr, never stdout
    process.stderr.write(`${formatted}\n`);
  };

  const logger: Logger = {
    debug: (message, meta) => log(LogLevel.DEBUG, message, meta),
    info: (message, meta) => log(LogLevel.INFO, message, meta),
    warn: (message, meta) => log(LogLevel.WARN, message, meta),
    error: (message, meta) => log(LogLevel.ERROR, message, meta),
    child: (childContext) =>
      createLogger({
        level,
        json,
        context: { ...context, ...childContext },
      }),
  };

  return logger;
};
