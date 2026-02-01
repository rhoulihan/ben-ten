import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextData } from '../../../src/core/types.js';
import { ErrorCode, createError } from '../../../src/infrastructure/errors.js';
import { LogLevel, createLogger } from '../../../src/infrastructure/logger.js';
import { err, ok } from '../../../src/infrastructure/result.js';
import { createContextResolutionService } from '../../../src/services/context-resolution-service.js';
import type { ContextService } from '../../../src/services/context-service.js';
import type { ProjectIdentifierService } from '../../../src/services/project-identifier-service.js';
import type { RemoteContextService } from '../../../src/services/remote-context-service.js';

describe('ContextResolutionService', () => {
  const logger = createLogger({ level: LogLevel.ERROR });
  const projectDir = '/test/project';
  const projectHash = 'abc123def456789';

  const createMockContext = (
    overrides: Partial<ContextData> = {},
  ): ContextData => ({
    version: '2.0.0',
    createdAt: Date.now() - 1000,
    updatedAt: Date.now(),
    sessionId: 'test-session',
    summary: 'Test summary',
    ...overrides,
  });

  let mockLocalService: ContextService;
  let mockRemoteService: RemoteContextService;
  let mockProjectIdentifierService: ProjectIdentifierService;

  beforeEach(() => {
    mockLocalService = {
      hasContext: vi.fn().mockResolvedValue(false),
      loadContext: vi
        .fn()
        .mockResolvedValue(
          err(createError(ErrorCode.CONTEXT_NOT_FOUND, 'Not found')),
        ),
      saveContext: vi.fn().mockResolvedValue(ok(undefined)),
      deleteContext: vi.fn().mockResolvedValue(ok(undefined)),
      getContextPath: vi.fn().mockReturnValue('/test/.ben-ten/context.ctx'),
      getBenTenDir: vi.fn().mockReturnValue('/test/.ben-ten'),
      hasMetadata: vi.fn().mockResolvedValue(false),
      loadMetadata: vi
        .fn()
        .mockResolvedValue(
          err(createError(ErrorCode.CONTEXT_NOT_FOUND, 'Not found')),
        ),
      saveMetadata: vi.fn().mockResolvedValue(ok(undefined)),
    };

    mockRemoteService = {
      healthCheck: vi.fn().mockResolvedValue(ok(true)),
      hasContext: vi.fn().mockResolvedValue(ok(false)),
      loadContext: vi
        .fn()
        .mockResolvedValue(
          err(createError(ErrorCode.REMOTE_CONTEXT_NOT_FOUND, 'Not found')),
        ),
      saveContext: vi.fn().mockResolvedValue(ok(undefined)),
      deleteContext: vi.fn().mockResolvedValue(ok(undefined)),
      getContextSummary: vi
        .fn()
        .mockResolvedValue(
          err(createError(ErrorCode.REMOTE_CONTEXT_NOT_FOUND, 'Not found')),
        ),
      getTranscriptSegments: vi.fn().mockResolvedValue(ok([])),
      listProjects: vi.fn().mockResolvedValue(ok([])),
    };

    mockProjectIdentifierService = {
      getProjectIdentifier: vi.fn().mockResolvedValue(
        ok({
          remoteUrl: 'github.com/user/repo',
          projectHash,
          projectName: 'repo',
        }),
      ),
      computeHash: vi.fn().mockReturnValue(projectHash),
      normalizeUrl: vi.fn().mockImplementation((url) => url),
    };
  });

  describe('resolveContext', () => {
    it('should return none when no context exists anywhere', async () => {
      const service = createContextResolutionService({
        logger,
        localContextService: mockLocalService,
        remoteContextService: mockRemoteService,
        projectIdentifierService: mockProjectIdentifierService,
      });

      const result = await service.resolveContext({ projectDir });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.selected).toBe('none');
        expect(result.value.needsChoice).toBe(false);
      }
    });

    it('should auto-load local context when only local exists', async () => {
      const localContext = createMockContext({ sessionId: 'local-session' });
      vi.mocked(mockLocalService.hasContext).mockResolvedValue(true);
      vi.mocked(mockLocalService.loadContext).mockResolvedValue(
        ok(localContext),
      );

      const service = createContextResolutionService({
        logger,
        localContextService: mockLocalService,
        remoteContextService: mockRemoteService,
        projectIdentifierService: mockProjectIdentifierService,
      });

      const result = await service.resolveContext({ projectDir });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.selected).toBe('local');
        expect(result.value.context?.sessionId).toBe('local-session');
        expect(result.value.needsChoice).toBe(false);
      }
    });

    it('should auto-load remote context when only remote exists', async () => {
      const remoteContext = createMockContext({ sessionId: 'remote-session' });
      vi.mocked(mockRemoteService.hasContext).mockResolvedValue(ok(true));
      vi.mocked(mockRemoteService.loadContext).mockResolvedValue(
        ok(remoteContext),
      );

      const service = createContextResolutionService({
        logger,
        localContextService: mockLocalService,
        remoteContextService: mockRemoteService,
        projectIdentifierService: mockProjectIdentifierService,
      });

      const result = await service.resolveContext({ projectDir });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.selected).toBe('remote');
        expect(result.value.context?.sessionId).toBe('remote-session');
        expect(result.value.needsChoice).toBe(false);
      }
    });

    it('should require choice when both exist with different sessions', async () => {
      const localContext = createMockContext({
        sessionId: 'local-session',
        updatedAt: Date.now() - 60000 * 5, // 5 minutes ago
      });
      const remoteContext = createMockContext({
        sessionId: 'remote-session',
        updatedAt: Date.now() - 60000 * 10, // 10 minutes ago
      });

      vi.mocked(mockLocalService.hasContext).mockResolvedValue(true);
      vi.mocked(mockLocalService.loadContext).mockResolvedValue(
        ok(localContext),
      );
      vi.mocked(mockRemoteService.hasContext).mockResolvedValue(ok(true));
      vi.mocked(mockRemoteService.loadContext).mockResolvedValue(
        ok(remoteContext),
      );

      const service = createContextResolutionService({
        logger,
        localContextService: mockLocalService,
        remoteContextService: mockRemoteService,
        projectIdentifierService: mockProjectIdentifierService,
      });

      const result = await service.resolveContext({ projectDir });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.needsChoice).toBe(true);
        expect(result.value.selected).toBe('none');
        expect(result.value.locations?.local?.sessionId).toBe('local-session');
        expect(result.value.locations?.remote?.sessionId).toBe(
          'remote-session',
        );
      }
    });

    it('should use local when both exist with same session and similar timestamp', async () => {
      const now = Date.now();
      const localContext = createMockContext({
        sessionId: 'same-session',
        updatedAt: now,
      });
      const remoteContext = createMockContext({
        sessionId: 'same-session',
        updatedAt: now - 30000, // 30 seconds ago (within 1 minute)
      });

      vi.mocked(mockLocalService.hasContext).mockResolvedValue(true);
      vi.mocked(mockLocalService.loadContext).mockResolvedValue(
        ok(localContext),
      );
      vi.mocked(mockRemoteService.hasContext).mockResolvedValue(ok(true));
      vi.mocked(mockRemoteService.loadContext).mockResolvedValue(
        ok(remoteContext),
      );

      const service = createContextResolutionService({
        logger,
        localContextService: mockLocalService,
        remoteContextService: mockRemoteService,
        projectIdentifierService: mockProjectIdentifierService,
      });

      const result = await service.resolveContext({ projectDir });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.selected).toBe('local');
        expect(result.value.needsChoice).toBe(false);
      }
    });

    it('should respect preferredSource when both exist', async () => {
      const localContext = createMockContext({ sessionId: 'local-session' });
      const remoteContext = createMockContext({ sessionId: 'remote-session' });

      vi.mocked(mockLocalService.hasContext).mockResolvedValue(true);
      vi.mocked(mockLocalService.loadContext).mockResolvedValue(
        ok(localContext),
      );
      vi.mocked(mockRemoteService.hasContext).mockResolvedValue(ok(true));
      vi.mocked(mockRemoteService.loadContext).mockResolvedValue(
        ok(remoteContext),
      );

      const service = createContextResolutionService({
        logger,
        localContextService: mockLocalService,
        remoteContextService: mockRemoteService,
        projectIdentifierService: mockProjectIdentifierService,
      });

      const result = await service.resolveContext({
        projectDir,
        preferredSource: 'remote',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.selected).toBe('remote');
        expect(result.value.context?.sessionId).toBe('remote-session');
      }
    });

    it('should respect forceSource option', async () => {
      const localContext = createMockContext({ sessionId: 'local-session' });

      vi.mocked(mockLocalService.hasContext).mockResolvedValue(true);
      vi.mocked(mockLocalService.loadContext).mockResolvedValue(
        ok(localContext),
      );

      const service = createContextResolutionService({
        logger,
        localContextService: mockLocalService,
        remoteContextService: mockRemoteService,
        projectIdentifierService: mockProjectIdentifierService,
      });

      const result = await service.resolveContext({
        projectDir,
        forceSource: 'local',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.selected).toBe('local');
      }
    });

    it('should work without remote service', async () => {
      const localContext = createMockContext();
      vi.mocked(mockLocalService.hasContext).mockResolvedValue(true);
      vi.mocked(mockLocalService.loadContext).mockResolvedValue(
        ok(localContext),
      );

      const service = createContextResolutionService({
        logger,
        localContextService: mockLocalService,
        // No remote service
        projectIdentifierService: mockProjectIdentifierService,
      });

      const result = await service.resolveContext({ projectDir });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.selected).toBe('local');
      }
    });
  });

  describe('saveContext', () => {
    it('should save to local only by default', async () => {
      const context = createMockContext();

      const service = createContextResolutionService({
        logger,
        localContextService: mockLocalService,
        remoteContextService: mockRemoteService,
        projectIdentifierService: mockProjectIdentifierService,
      });

      const result = await service.saveContext(context, { projectDir });

      expect(result.ok).toBe(true);
      expect(mockLocalService.saveContext).toHaveBeenCalledWith(context);
      expect(mockRemoteService.saveContext).not.toHaveBeenCalled();
    });

    it('should save to both when saveRemote is true', async () => {
      const context = createMockContext();

      const service = createContextResolutionService({
        logger,
        localContextService: mockLocalService,
        remoteContextService: mockRemoteService,
        projectIdentifierService: mockProjectIdentifierService,
      });

      const result = await service.saveContext(context, {
        projectDir,
        saveLocal: true,
        saveRemote: true,
      });

      expect(result.ok).toBe(true);
      expect(mockLocalService.saveContext).toHaveBeenCalledWith(context);
      expect(mockRemoteService.saveContext).toHaveBeenCalledWith(
        projectHash,
        context,
      );
    });

    it('should save to remote only when saveLocal is false', async () => {
      const context = createMockContext();

      const service = createContextResolutionService({
        logger,
        localContextService: mockLocalService,
        remoteContextService: mockRemoteService,
        projectIdentifierService: mockProjectIdentifierService,
      });

      const result = await service.saveContext(context, {
        projectDir,
        saveLocal: false,
        saveRemote: true,
      });

      expect(result.ok).toBe(true);
      expect(mockLocalService.saveContext).not.toHaveBeenCalled();
      expect(mockRemoteService.saveContext).toHaveBeenCalledWith(
        projectHash,
        context,
      );
    });

    it('should return error when saveRemote=true but remote service not configured', async () => {
      const context = createMockContext();

      // Create service WITHOUT remote service
      const service = createContextResolutionService({
        logger,
        localContextService: mockLocalService,
        // No remoteContextService
        projectIdentifierService: mockProjectIdentifierService,
      });

      const result = await service.saveContext(context, {
        projectDir,
        saveLocal: true,
        saveRemote: true,
      });

      // Should fail because remote was requested but not available
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Remote');
      }
    });

    it('should return SaveResult with actual success status for each destination', async () => {
      const context = createMockContext();

      // Make remote save fail
      vi.mocked(mockRemoteService.saveContext).mockResolvedValue(
        err(createError(ErrorCode.NETWORK_UNREACHABLE, 'Cannot reach server')),
      );

      const service = createContextResolutionService({
        logger,
        localContextService: mockLocalService,
        remoteContextService: mockRemoteService,
        projectIdentifierService: mockProjectIdentifierService,
      });

      const result = await service.saveContext(context, {
        projectDir,
        saveLocal: true,
        saveRemote: true,
      });

      // Should return error since remote failed
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Remote');
      }
    });
  });

  describe('getAvailableLocations', () => {
    it('should return both locations when both exist', async () => {
      const localContext = createMockContext({ sessionId: 'local' });
      const remoteSummary = {
        projectHash,
        sessionId: 'remote',
        summary: 'Remote summary',
        updatedAt: Date.now(),
        createdAt: Date.now(),
        hasConversation: false,
      };

      vi.mocked(mockLocalService.hasContext).mockResolvedValue(true);
      vi.mocked(mockLocalService.loadContext).mockResolvedValue(
        ok(localContext),
      );
      vi.mocked(mockRemoteService.getContextSummary).mockResolvedValue(
        ok(remoteSummary),
      );

      const service = createContextResolutionService({
        logger,
        localContextService: mockLocalService,
        remoteContextService: mockRemoteService,
        projectIdentifierService: mockProjectIdentifierService,
      });

      const result = await service.getAvailableLocations(projectDir);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.local).toBeDefined();
        expect(result.value.remote).toBeDefined();
        expect(result.value.local?.sessionId).toBe('local');
        expect(result.value.remote?.sessionId).toBe('remote');
      }
    });

    it('should return only local when remote is not available', async () => {
      const localContext = createMockContext({ sessionId: 'local' });

      vi.mocked(mockLocalService.hasContext).mockResolvedValue(true);
      vi.mocked(mockLocalService.loadContext).mockResolvedValue(
        ok(localContext),
      );
      vi.mocked(mockRemoteService.healthCheck).mockResolvedValue(ok(false));

      const service = createContextResolutionService({
        logger,
        localContextService: mockLocalService,
        remoteContextService: mockRemoteService,
        projectIdentifierService: mockProjectIdentifierService,
      });

      const result = await service.getAvailableLocations(projectDir);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.local).toBeDefined();
        expect(result.value.remote).toBeUndefined();
      }
    });
  });
});
