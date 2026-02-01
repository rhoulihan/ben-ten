import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LogLevel, createLogger } from '../../../src/infrastructure/logger.js';
import { createProjectIdentifierService } from '../../../src/services/project-identifier-service.js';

// Mock child_process
vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

import { exec } from 'node:child_process';

const mockedExec = vi.mocked(exec);

describe('ProjectIdentifierService', () => {
  const logger = createLogger({ level: LogLevel.ERROR });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('computeHash', () => {
    it('should return first 16 chars of SHA-256 hash', () => {
      const service = createProjectIdentifierService({ logger });
      const hash = service.computeHash('test-input');

      expect(hash).toHaveLength(16);
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });

    it('should produce consistent hashes for same input', () => {
      const service = createProjectIdentifierService({ logger });
      const hash1 = service.computeHash('same-input');
      const hash2 = service.computeHash('same-input');

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different inputs', () => {
      const service = createProjectIdentifierService({ logger });
      const hash1 = service.computeHash('input-one');
      const hash2 = service.computeHash('input-two');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('normalizeUrl', () => {
    it('should normalize SSH URL format', () => {
      const service = createProjectIdentifierService({ logger });
      const result = service.normalizeUrl('git@github.com:user/repo.git');

      expect(result).toBe('github.com/user/repo');
    });

    it('should normalize HTTPS URL format', () => {
      const service = createProjectIdentifierService({ logger });
      const result = service.normalizeUrl('https://github.com/user/repo.git');

      expect(result).toBe('github.com/user/repo');
    });

    it('should remove .git suffix', () => {
      const service = createProjectIdentifierService({ logger });
      const result = service.normalizeUrl('https://github.com/user/repo.git');

      expect(result).not.toContain('.git');
    });

    it('should remove trailing slashes', () => {
      const service = createProjectIdentifierService({ logger });
      const result = service.normalizeUrl('https://github.com/user/repo/');

      expect(result.endsWith('/')).toBe(false);
    });

    it('should handle GitLab SSH URLs', () => {
      const service = createProjectIdentifierService({ logger });
      const result = service.normalizeUrl('git@gitlab.com:group/project.git');

      expect(result).toBe('gitlab.com/group/project');
    });

    it('should produce same hash for SSH and HTTPS URLs of same repo', () => {
      const service = createProjectIdentifierService({ logger });
      const sshNormalized = service.normalizeUrl(
        'git@github.com:user/repo.git',
      );
      const httpsNormalized = service.normalizeUrl(
        'https://github.com/user/repo.git',
      );

      expect(sshNormalized).toBe(httpsNormalized);
      expect(service.computeHash(sshNormalized)).toBe(
        service.computeHash(httpsNormalized),
      );
    });
  });

  describe('getProjectIdentifier', () => {
    it('should return identifier from git remote URL', async () => {
      mockedExec.mockImplementation((cmd, opts, callback) => {
        const cb = typeof opts === 'function' ? opts : callback;
        if (cb) {
          cb(null, {
            stdout: 'git@github.com:user/repo.git\n',
            stderr: '',
          });
        }
        return {} as ReturnType<typeof exec>;
      });

      const service = createProjectIdentifierService({ logger });
      const result = await service.getProjectIdentifier('/path/to/project');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.remoteUrl).toBe('github.com/user/repo');
        expect(result.value.projectName).toBe('repo');
        expect(result.value.projectHash).toHaveLength(16);
      }
    });

    it('should fallback to directory hash when git remote fails', async () => {
      mockedExec.mockImplementation((cmd, opts, callback) => {
        const cb = typeof opts === 'function' ? opts : callback;
        if (cb) {
          cb(new Error('fatal: not a git repository'), {
            stdout: '',
            stderr: '',
          });
        }
        return {} as ReturnType<typeof exec>;
      });

      const service = createProjectIdentifierService({ logger });
      const result = await service.getProjectIdentifier('/path/to/project');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.remoteUrl).toBe('local:/path/to/project');
        expect(result.value.projectName).toBe('project');
        expect(result.value.projectHash).toHaveLength(16);
      }
    });

    it('should extract project name correctly', async () => {
      mockedExec.mockImplementation((cmd, opts, callback) => {
        const cb = typeof opts === 'function' ? opts : callback;
        if (cb) {
          cb(null, {
            stdout: 'https://github.com/org/my-awesome-project.git\n',
            stderr: '',
          });
        }
        return {} as ReturnType<typeof exec>;
      });

      const service = createProjectIdentifierService({ logger });
      const result = await service.getProjectIdentifier('/some/path');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.projectName).toBe('my-awesome-project');
      }
    });
  });
});
