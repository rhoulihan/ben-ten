import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextData } from '../../../src/core/types.js';
import { LogLevel, createLogger } from '../../../src/infrastructure/logger.js';
import {
  type RemoteContextService,
  createRemoteContextService,
} from '../../../src/services/remote-context-service.js';

describe('RemoteContextService', () => {
  const logger = createLogger({ level: LogLevel.ERROR });
  const serverUrl = 'http://localhost:3456';
  const apiKey = 'test-api-key';

  let service: RemoteContextService;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    service = createRemoteContextService({
      logger,
      serverUrl,
      apiKey,
      timeout: 1000,
      retryAttempts: 1, // Disable retries for faster tests
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const createMockResponse = (data: unknown, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
  });

  const createMockContext = (): ContextData => ({
    version: '2.0.0',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    sessionId: 'test-session',
    summary: 'Test summary',
    keyFiles: ['file1.ts'],
    activeTasks: ['task1'],
  });

  describe('healthCheck', () => {
    it('should return true when server is healthy', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ ok: true }));

      const result = await service.healthCheck();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });

    it('should return false when server is unreachable', async () => {
      mockFetch.mockRejectedValue(new TypeError('fetch failed'));

      const result = await service.healthCheck();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it('should include authorization header', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ ok: true }));

      await service.healthCheck();

      expect(mockFetch).toHaveBeenCalledWith(
        `${serverUrl}/api/health`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${apiKey}`,
          }),
        }),
      );
    });
  });

  describe('hasContext', () => {
    it('should return true when context exists', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ exists: true }));

      const result = await service.hasContext('abc123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });

    it('should return false when context not found', async () => {
      mockFetch.mockResolvedValue(createMockResponse({}, 404));

      const result = await service.hasContext('abc123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });
  });

  describe('loadContext', () => {
    it('should load context from server', async () => {
      const mockContext = createMockContext();
      mockFetch.mockResolvedValue(createMockResponse(mockContext));

      const result = await service.loadContext('abc123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sessionId).toBe('test-session');
        expect(result.value.summary).toBe('Test summary');
      }
    });

    it('should return error when context not found', async () => {
      mockFetch.mockResolvedValue(createMockResponse({}, 404));

      const result = await service.loadContext('abc123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('REMOTE_CONTEXT_NOT_FOUND');
      }
    });

    it('should return error on auth failure', async () => {
      mockFetch.mockResolvedValue(createMockResponse({}, 401));

      const result = await service.loadContext('abc123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_AUTH_FAILED');
      }
    });
  });

  describe('saveContext', () => {
    it('should save context to server', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ saved: true }));

      const context = createMockContext();
      const result = await service.saveContext('abc123', context);

      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        `${serverUrl}/api/contexts/abc123`,
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(context),
        }),
      );
    });

    it('should return error on server failure', async () => {
      mockFetch.mockResolvedValue(createMockResponse({}, 500));

      const context = createMockContext();
      const result = await service.saveContext('abc123', context);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('REMOTE_SERVER_ERROR');
      }
    });
  });

  describe('deleteContext', () => {
    it('should delete context from server', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ deleted: true }));

      const result = await service.deleteContext('abc123');

      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        `${serverUrl}/api/contexts/abc123`,
        expect.objectContaining({
          method: 'DELETE',
        }),
      );
    });

    it('should succeed even when context not found', async () => {
      mockFetch.mockResolvedValue(createMockResponse({}, 404));

      const result = await service.deleteContext('abc123');

      expect(result.ok).toBe(true);
    });
  });

  describe('getContextSummary', () => {
    it('should get context summary', async () => {
      const mockSummary = {
        projectHash: 'abc123',
        sessionId: 'test-session',
        summary: 'Test summary',
        updatedAt: Date.now(),
        createdAt: Date.now(),
        hasConversation: true,
        messageCount: 10,
      };
      mockFetch.mockResolvedValue(createMockResponse(mockSummary));

      const result = await service.getContextSummary('abc123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sessionId).toBe('test-session');
        expect(result.value.messageCount).toBe(10);
      }
    });
  });

  describe('getTranscriptSegments', () => {
    it('should get transcript segments with options', async () => {
      const mockSegments = [
        { index: 0, type: 'user', content: 'Hello' },
        { index: 1, type: 'assistant', content: 'Hi there' },
      ];
      mockFetch.mockResolvedValue(createMockResponse(mockSegments));

      const result = await service.getTranscriptSegments('abc123', {
        startIndex: 0,
        limit: 10,
        messageType: 'user',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
      }

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('startIndex=0'),
        expect.any(Object),
      );
    });
  });

  describe('listProjects', () => {
    it('should list all projects', async () => {
      const mockProjects = [
        { projectHash: 'abc123', updatedAt: Date.now() },
        { projectHash: 'def456', updatedAt: Date.now() - 1000 },
      ];
      mockFetch.mockResolvedValue(createMockResponse(mockProjects));

      const result = await service.listProjects();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0].projectHash).toBe('abc123');
      }
    });
  });

  describe('without API key', () => {
    it('should not include authorization header', async () => {
      const serviceNoAuth = createRemoteContextService({
        logger,
        serverUrl,
        // No apiKey
        timeout: 1000,
        retryAttempts: 1,
      });

      mockFetch.mockResolvedValue(createMockResponse({ ok: true }));

      await serviceNoAuth.healthCheck();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.not.objectContaining({
            Authorization: expect.any(String),
          }),
        }),
      );
    });
  });
});
