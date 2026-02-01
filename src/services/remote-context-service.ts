import type { ContextData } from '../core/types.js';
import {
  type BenTenError,
  ErrorCode,
  createError,
} from '../infrastructure/errors.js';
import type { Logger } from '../infrastructure/logger.js';
import { type Result, err, ok } from '../infrastructure/result.js';

/**
 * Summary of context metadata without full content.
 */
export interface ContextSummary {
  projectHash: string;
  sessionId: string;
  summary: string;
  updatedAt: number;
  createdAt: number;
  hasConversation: boolean;
  messageCount?: number;
  keyFiles?: string[];
  activeTasks?: string[];
}

/**
 * Options for retrieving transcript segments.
 */
export interface SegmentOptions {
  /** Starting message index */
  startIndex?: number;
  /** Maximum number of messages to return */
  limit?: number;
  /** Filter by message type */
  messageType?: 'user' | 'assistant' | 'all';
}

/**
 * A segment of transcript messages.
 */
export interface TranscriptSegment {
  index: number;
  type: string;
  content: string;
  timestamp?: number;
}

/**
 * Service for interacting with a remote Ben-Ten server.
 */
export interface RemoteContextService {
  /**
   * Check if the remote server is reachable.
   *
   * @returns Result with boolean indicating server health
   */
  healthCheck(): Promise<Result<boolean, BenTenError>>;

  /**
   * Check if context exists for a project on the remote server.
   *
   * @param projectHash - The project hash identifier
   * @returns Result with boolean indicating existence
   */
  hasContext(projectHash: string): Promise<Result<boolean, BenTenError>>;

  /**
   * Load full context from the remote server.
   *
   * @param projectHash - The project hash identifier
   * @returns Result with ContextData or error
   */
  loadContext(projectHash: string): Promise<Result<ContextData, BenTenError>>;

  /**
   * Save context to the remote server.
   *
   * @param projectHash - The project hash identifier
   * @param context - The context data to save
   * @returns Result indicating success or error
   */
  saveContext(
    projectHash: string,
    context: ContextData,
  ): Promise<Result<void, BenTenError>>;

  /**
   * Delete context from the remote server.
   *
   * @param projectHash - The project hash identifier
   * @returns Result indicating success or error
   */
  deleteContext(projectHash: string): Promise<Result<void, BenTenError>>;

  /**
   * Get context summary without loading full content.
   *
   * @param projectHash - The project hash identifier
   * @returns Result with ContextSummary or error
   */
  getContextSummary(
    projectHash: string,
  ): Promise<Result<ContextSummary, BenTenError>>;

  /**
   * Get transcript segments on demand.
   *
   * @param projectHash - The project hash identifier
   * @param opts - Segment retrieval options
   * @returns Result with transcript segments or error
   */
  getTranscriptSegments(
    projectHash: string,
    opts: SegmentOptions,
  ): Promise<Result<TranscriptSegment[], BenTenError>>;

  /**
   * List all project hashes stored on the remote server.
   *
   * @returns Result with array of project info or error
   */
  listProjects(): Promise<
    Result<Array<{ projectHash: string; updatedAt: number }>, BenTenError>
  >;
}

export interface RemoteContextServiceDeps {
  logger: Logger;
  serverUrl: string;
  apiKey?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Number of retry attempts (default: 3) */
  retryAttempts?: number;
}

/** Default timeout for requests */
const DEFAULT_TIMEOUT = 30000;

/** Default number of retry attempts */
const DEFAULT_RETRY_ATTEMPTS = 3;

/** Base delay for exponential backoff in ms */
const BACKOFF_BASE_DELAY = 1000;

/**
 * Sleep for a given number of milliseconds.
 */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Creates a remote context service for communicating with Ben-Ten server.
 *
 * @param deps - Dependencies including logger, server URL, and optional API key
 * @returns A RemoteContextService instance
 * @example
 * const service = createRemoteContextService({
 *   logger,
 *   serverUrl: 'http://localhost:3456',
 *   apiKey: 'sk-xxx',
 * });
 */
export const createRemoteContextService = (
  deps: RemoteContextServiceDeps,
): RemoteContextService => {
  const {
    logger,
    serverUrl,
    apiKey,
    timeout = DEFAULT_TIMEOUT,
    retryAttempts = DEFAULT_RETRY_ATTEMPTS,
  } = deps;

  /**
   * Build headers for requests.
   */
  const buildHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    return headers;
  };

  /**
   * Make a fetch request with timeout, retry, and error handling.
   */
  const fetchWithRetry = async <T>(
    path: string,
    options: RequestInit = {},
  ): Promise<Result<T, BenTenError>> => {
    const url = `${serverUrl}${path}`;

    for (let attempt = 0; attempt < retryAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
          ...options,
          headers: buildHeaders(),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Handle authentication errors (no retry)
        if (response.status === 401 || response.status === 403) {
          return err(
            createError(
              ErrorCode.NETWORK_AUTH_FAILED,
              'Authentication failed',
              { status: response.status },
            ),
          );
        }

        // Handle not found (no retry)
        if (response.status === 404) {
          return err(
            createError(
              ErrorCode.REMOTE_CONTEXT_NOT_FOUND,
              'Context not found on remote server',
              { path },
            ),
          );
        }

        // Handle server errors with retry
        if (response.status >= 500) {
          if (attempt < retryAttempts - 1) {
            const delay = BACKOFF_BASE_DELAY * 2 ** attempt;
            logger.debug('Server error, retrying', {
              attempt: attempt + 1,
              delay,
              status: response.status,
            });
            await sleep(delay);
            continue;
          }
          return err(
            createError(ErrorCode.REMOTE_SERVER_ERROR, 'Remote server error', {
              status: response.status,
            }),
          );
        }

        // Handle other client errors (no retry)
        if (!response.ok) {
          return err(
            createError(ErrorCode.REMOTE_SERVER_ERROR, 'Request failed', {
              status: response.status,
              statusText: response.statusText,
            }),
          );
        }

        // Parse JSON response
        const data = (await response.json()) as T;
        return ok(data);
      } catch (e) {
        const isAbortError = e instanceof Error && e.name === 'AbortError';
        const isNetworkError =
          e instanceof TypeError && e.message.includes('fetch');

        if (isAbortError) {
          if (attempt < retryAttempts - 1) {
            const delay = BACKOFF_BASE_DELAY * 2 ** attempt;
            logger.debug('Request timeout, retrying', {
              attempt: attempt + 1,
              delay,
            });
            await sleep(delay);
            continue;
          }
          return err(
            createError(ErrorCode.NETWORK_TIMEOUT, 'Request timed out', {
              timeout,
            }),
          );
        }

        if (isNetworkError) {
          if (attempt < retryAttempts - 1) {
            const delay = BACKOFF_BASE_DELAY * 2 ** attempt;
            logger.debug('Network error, retrying', {
              attempt: attempt + 1,
              delay,
              error: e instanceof Error ? e.message : String(e),
            });
            await sleep(delay);
            continue;
          }
          return err(
            createError(
              ErrorCode.NETWORK_UNREACHABLE,
              'Cannot reach remote server',
              { url, error: e instanceof Error ? e.message : String(e) },
            ),
          );
        }

        // Unexpected error
        return err(
          createError(ErrorCode.REMOTE_SERVER_ERROR, 'Unexpected error', {
            error: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    }

    // Should not reach here, but satisfy TypeScript
    return err(
      createError(ErrorCode.REMOTE_SERVER_ERROR, 'Max retries exceeded'),
    );
  };

  const service: RemoteContextService = {
    async healthCheck() {
      logger.debug('Checking remote server health', { serverUrl });

      const result = await fetchWithRetry<{ ok: boolean }>('/api/health');
      if (!result.ok) {
        // For health check, network unreachable means server is down
        // but that's not an error - just return false
        if (
          result.error.code === ErrorCode.NETWORK_UNREACHABLE ||
          result.error.code === ErrorCode.NETWORK_TIMEOUT
        ) {
          return ok(false);
        }
        return result;
      }

      return ok(result.value.ok);
    },

    async hasContext(projectHash) {
      logger.debug('Checking remote context existence', { projectHash });

      const result = await fetchWithRetry<{ exists: boolean }>(
        `/api/contexts/${projectHash}/exists`,
      );

      if (!result.ok) {
        // Not found means it doesn't exist
        if (result.error.code === ErrorCode.REMOTE_CONTEXT_NOT_FOUND) {
          return ok(false);
        }
        return result;
      }

      return ok(result.value.exists);
    },

    async loadContext(projectHash) {
      logger.debug('Loading context from remote', { projectHash });

      const result = await fetchWithRetry<ContextData>(
        `/api/contexts/${projectHash}`,
      );

      if (!result.ok) {
        return result;
      }

      logger.info('Context loaded from remote', {
        projectHash,
        sessionId: result.value.sessionId,
      });

      return ok(result.value);
    },

    async saveContext(projectHash, context) {
      logger.debug('Saving context to remote', {
        projectHash,
        sessionId: context.sessionId,
      });

      const result = await fetchWithRetry<{ saved: boolean }>(
        `/api/contexts/${projectHash}`,
        {
          method: 'PUT',
          body: JSON.stringify(context),
        },
      );

      if (!result.ok) {
        return result;
      }

      logger.info('Context saved to remote', { projectHash });
      return ok(undefined);
    },

    async deleteContext(projectHash) {
      logger.debug('Deleting context from remote', { projectHash });

      const result = await fetchWithRetry<{ deleted: boolean }>(
        `/api/contexts/${projectHash}`,
        {
          method: 'DELETE',
        },
      );

      if (!result.ok) {
        // Not found is fine for delete
        if (result.error.code === ErrorCode.REMOTE_CONTEXT_NOT_FOUND) {
          return ok(undefined);
        }
        return result;
      }

      logger.info('Context deleted from remote', { projectHash });
      return ok(undefined);
    },

    async getContextSummary(projectHash) {
      logger.debug('Getting context summary from remote', { projectHash });

      const result = await fetchWithRetry<ContextSummary>(
        `/api/contexts/${projectHash}/summary`,
      );

      return result;
    },

    async getTranscriptSegments(projectHash, opts) {
      logger.debug('Getting transcript segments from remote', {
        projectHash,
        opts,
      });

      const params = new URLSearchParams();
      if (opts.startIndex !== undefined) {
        params.set('startIndex', String(opts.startIndex));
      }
      if (opts.limit !== undefined) {
        params.set('limit', String(opts.limit));
      }
      if (opts.messageType) {
        params.set('messageType', opts.messageType);
      }

      const queryString = params.toString();
      const path = `/api/contexts/${projectHash}/segments${queryString ? `?${queryString}` : ''}`;

      const result = await fetchWithRetry<TranscriptSegment[]>(path);

      return result;
    },

    async listProjects() {
      logger.debug('Listing projects from remote');

      const result =
        await fetchWithRetry<Array<{ projectHash: string; updatedAt: number }>>(
          '/api/contexts',
        );

      return result;
    },
  };

  return service;
};
