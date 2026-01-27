/**
 * Standard error codes for Ben10 operations.
 * Organized by category for easy identification.
 */
export const ErrorCode = {
  // File system errors
  FS_NOT_FOUND: 'FS_NOT_FOUND',
  FS_PERMISSION_DENIED: 'FS_PERMISSION_DENIED',
  FS_WRITE_ERROR: 'FS_WRITE_ERROR',
  FS_READ_ERROR: 'FS_READ_ERROR',

  // Context errors
  CONTEXT_NOT_FOUND: 'CONTEXT_NOT_FOUND',
  CONTEXT_CORRUPTED: 'CONTEXT_CORRUPTED',
  CONTEXT_LOCKED: 'CONTEXT_LOCKED',
  CONTEXT_VERSION_MISMATCH: 'CONTEXT_VERSION_MISMATCH',

  // Serialization errors
  SERIALIZE_FAILED: 'SERIALIZE_FAILED',
  DESERIALIZE_FAILED: 'DESERIALIZE_FAILED',
  CHECKSUM_MISMATCH: 'CHECKSUM_MISMATCH',

  // Snapshot errors
  SNAPSHOT_NOT_FOUND: 'SNAPSHOT_NOT_FOUND',
  SNAPSHOT_CORRUPTED: 'SNAPSHOT_CORRUPTED',

  // Hook errors
  HOOK_INVALID_INPUT: 'HOOK_INVALID_INPUT',
  HOOK_EXECUTION_FAILED: 'HOOK_EXECUTION_FAILED',

  // MCP errors
  MCP_TOOL_ERROR: 'MCP_TOOL_ERROR',
  MCP_RESOURCE_ERROR: 'MCP_RESOURCE_ERROR',

  // Config errors
  CONFIG_INVALID: 'CONFIG_INVALID',
  CONFIG_NOT_FOUND: 'CONFIG_NOT_FOUND',

  // Validation errors
  VALIDATION_FAILED: 'VALIDATION_FAILED',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Structured error type for Ben10 operations.
 * Includes a machine-readable code and human-readable message.
 */
export interface Ben10Error {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

/**
 * Creates a frozen Ben10Error object.
 *
 * @param code - The error code from ErrorCode enum
 * @param message - Human-readable error description
 * @param details - Optional additional context about the error
 * @returns A frozen Ben10Error object
 * @example
 * const error = createError(
 *   ErrorCode.FS_NOT_FOUND,
 *   'File not found',
 *   { path: '/missing/file.txt' }
 * );
 */
export const createError = (
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): Ben10Error => {
  const error: Ben10Error = details
    ? { code, message, details }
    : { code, message };
  return Object.freeze(error);
};

/**
 * Type guard to check if a value is a valid ErrorCode.
 *
 * @param value - The value to check
 * @returns true if the value is a valid ErrorCode
 */
export const isErrorCode = (value: unknown): value is ErrorCode => {
  if (typeof value !== 'string') {
    return false;
  }
  return Object.values(ErrorCode).includes(value as ErrorCode);
};
