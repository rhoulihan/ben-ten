import {
  type IncomingMessage,
  type ServerResponse,
  createServer,
} from 'node:http';
import { URL } from 'node:url';
import type { FileSystem } from '../adapters/fs/memory-fs.js';
import { parseContextData } from '../core/types.js';
import type { Logger } from '../infrastructure/logger.js';
import { createHttpServerStorage } from './http-server.js';

/**
 * Configuration for the HTTP server.
 */
export interface HttpServerConfig {
  /** Port to listen on (default: 3456) */
  port: number;
  /** Host to bind to (default: '0.0.0.0') */
  host: string;
  /** Allowed API keys for authentication */
  apiKeys: string[];
  /** Path to store contexts (e.g., ~/.ben-ten-server) */
  storagePath: string;
}

/**
 * Running HTTP server instance.
 */
export interface HttpServer {
  /** Start listening for connections */
  start(): Promise<void>;
  /** Stop the server */
  stop(): Promise<void>;
  /** Get the actual port (useful when port=0) */
  getPort(): number;
}

export interface HttpTransportDeps {
  fs: FileSystem;
  logger: Logger;
  config: HttpServerConfig;
}

/**
 * Parse JSON body from request.
 */
const parseBody = (req: IncomingMessage): Promise<unknown> => {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : null);
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
};

/**
 * Send JSON response.
 */
const sendJson = (
  res: ServerResponse,
  statusCode: number,
  data: unknown,
): void => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(data));
};

/**
 * Send error response.
 */
const sendError = (
  res: ServerResponse,
  statusCode: number,
  message: string,
): void => {
  sendJson(res, statusCode, { error: message });
};

/**
 * Creates and starts an HTTP server for Ben-Ten context storage.
 *
 * @param deps - Dependencies including file system, logger, and config
 * @returns An HttpServer instance
 * @example
 * const server = createHttpServer({
 *   fs,
 *   logger,
 *   config: {
 *     port: 3456,
 *     host: '0.0.0.0',
 *     apiKeys: ['sk-xxx'],
 *     storagePath: '~/.ben-ten-server',
 *   },
 * });
 * await server.start();
 */
export const createHttpServer = (deps: HttpTransportDeps): HttpServer => {
  const { fs, logger, config } = deps;

  const storage = createHttpServerStorage({
    fs,
    logger,
    storagePath: config.storagePath,
  });

  let actualPort = config.port;

  /**
   * Verify API key authentication.
   */
  const authenticate = (req: IncomingMessage): boolean => {
    // If no API keys configured, allow all
    if (config.apiKeys.length === 0) {
      return true;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return false;
    }

    const match = authHeader.match(/^Bearer (.+)$/);
    if (!match || !match[1]) {
      return false;
    }

    return config.apiKeys.includes(match[1]);
  };

  /**
   * Handle API requests.
   */
  const handleRequest = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method || 'GET';

    logger.debug('Incoming request', { method, path });

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      });
      res.end();
      return;
    }

    // Health check endpoint (no auth required)
    if (path === '/api/health' && method === 'GET') {
      sendJson(res, 200, { ok: true });
      return;
    }

    // Authenticate all other endpoints
    if (!authenticate(req)) {
      sendError(res, 401, 'Unauthorized');
      return;
    }

    try {
      // List all contexts
      if (path === '/api/contexts' && method === 'GET') {
        const result = await storage.listProjects();
        if (!result.ok) {
          sendError(res, 500, result.error.message);
          return;
        }
        sendJson(res, 200, result.value);
        return;
      }

      // Context-specific endpoints
      const contextMatch = path.match(/^\/api\/contexts\/([a-f0-9]+)(\/.*)?$/);
      if (contextMatch?.[1]) {
        const projectHash = contextMatch[1];
        const subPath = contextMatch[2] ?? '';

        // Check existence
        if (subPath === '/exists' && method === 'GET') {
          const exists = await storage.hasContext(projectHash);
          sendJson(res, 200, { exists });
          return;
        }

        // Get summary
        if (subPath === '/summary' && method === 'GET') {
          const result = await storage.getContextSummary(projectHash);
          if (!result.ok) {
            if (result.error.code === 'REMOTE_CONTEXT_NOT_FOUND') {
              sendError(res, 404, 'Context not found');
              return;
            }
            sendError(res, 500, result.error.message);
            return;
          }
          sendJson(res, 200, result.value);
          return;
        }

        // Get transcript segments
        if (subPath === '/segments' && method === 'GET') {
          const startIndex = url.searchParams.get('startIndex');
          const limit = url.searchParams.get('limit');
          const messageType = url.searchParams.get('messageType');

          const result = await storage.getTranscriptSegments(projectHash, {
            startIndex: startIndex
              ? Number.parseInt(startIndex, 10)
              : undefined,
            limit: limit ? Number.parseInt(limit, 10) : undefined,
            messageType: messageType as
              | 'user'
              | 'assistant'
              | 'all'
              | undefined,
          });

          if (!result.ok) {
            if (result.error.code === 'REMOTE_CONTEXT_NOT_FOUND') {
              sendError(res, 404, 'Context not found');
              return;
            }
            sendError(res, 500, result.error.message);
            return;
          }
          sendJson(res, 200, result.value);
          return;
        }

        // Get full context
        if (subPath === '' && method === 'GET') {
          const result = await storage.loadContext(projectHash);
          if (!result.ok) {
            if (result.error.code === 'REMOTE_CONTEXT_NOT_FOUND') {
              sendError(res, 404, 'Context not found');
              return;
            }
            sendError(res, 500, result.error.message);
            return;
          }
          sendJson(res, 200, result.value);
          return;
        }

        // Save context
        if (subPath === '' && method === 'PUT') {
          const body = await parseBody(req);
          const parseResult = parseContextData(body);
          if (!parseResult.ok) {
            sendError(res, 400, 'Invalid context data');
            return;
          }

          const saveResult = await storage.saveContext(
            projectHash,
            parseResult.value,
          );
          if (!saveResult.ok) {
            sendError(res, 500, saveResult.error.message);
            return;
          }
          sendJson(res, 200, { saved: true });
          return;
        }

        // Delete context
        if (subPath === '' && method === 'DELETE') {
          const deleteResult = await storage.deleteContext(projectHash);
          if (!deleteResult.ok) {
            sendError(res, 500, deleteResult.error.message);
            return;
          }
          sendJson(res, 200, { deleted: true });
          return;
        }
      }

      // Unknown endpoint
      sendError(res, 404, 'Not found');
    } catch (e) {
      logger.error('Request handler error', {
        error: e instanceof Error ? e.message : String(e),
        path,
        method,
      });
      sendError(res, 500, 'Internal server error');
    }
  };

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((e) => {
      logger.error('Unhandled request error', {
        error: e instanceof Error ? e.message : String(e),
      });
      sendError(res, 500, 'Internal server error');
    });
  });

  const httpServer: HttpServer = {
    async start() {
      return new Promise((resolve, reject) => {
        server.on('error', reject);

        server.listen(config.port, config.host, () => {
          const address = server.address();
          if (address && typeof address !== 'string') {
            actualPort = address.port;
          }

          logger.info('HTTP server started', {
            host: config.host,
            port: actualPort,
            storagePath: config.storagePath,
            authEnabled: config.apiKeys.length > 0,
          });
          resolve();
        });
      });
    },

    async stop() {
      return new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          logger.info('HTTP server stopped');
          resolve();
        });
      });
    },

    getPort() {
      return actualPort;
    },
  };

  return httpServer;
};
