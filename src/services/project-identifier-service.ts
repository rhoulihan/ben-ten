import { exec } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { BenTenError } from '../infrastructure/errors.js';
import type { Logger } from '../infrastructure/logger.js';
import { type Result, ok } from '../infrastructure/result.js';

const execAsync = promisify(exec);

/**
 * Project identifier containing Git remote information.
 */
export interface ProjectIdentifier {
  /** The normalized Git remote URL */
  remoteUrl: string;
  /** SHA-256 hash of the remote URL (first 16 chars) */
  projectHash: string;
  /** Human-readable project name extracted from URL */
  projectName: string;
}

/**
 * Service for identifying projects across machines using Git remote URLs.
 */
export interface ProjectIdentifierService {
  /**
   * Get the project identifier for a given directory.
   * Falls back to directory path hash if no Git remote is found.
   *
   * @param projectDir - The project directory to identify
   * @returns Result with ProjectIdentifier or error
   */
  getProjectIdentifier(
    projectDir: string,
  ): Promise<Result<ProjectIdentifier, BenTenError>>;

  /**
   * Compute a hash from a remote URL or path.
   *
   * @param input - The string to hash (URL or path)
   * @returns First 16 chars of SHA-256 hash
   */
  computeHash(input: string): string;

  /**
   * Normalize a Git remote URL for consistent hashing.
   * Handles SSH vs HTTPS, .git suffix, trailing slashes.
   *
   * @param url - The Git remote URL to normalize
   * @returns Normalized URL string
   */
  normalizeUrl(url: string): string;
}

export interface ProjectIdentifierServiceDeps {
  logger: Logger;
}

/**
 * Normalizes a Git remote URL for consistent hashing across URL formats.
 *
 * @param url - The raw Git remote URL
 * @returns Normalized URL in format: hostname/owner/repo
 * @example
 * normalizeGitUrl('git@github.com:user/repo.git') // 'github.com/user/repo'
 * normalizeGitUrl('https://github.com/user/repo.git') // 'github.com/user/repo'
 */
const normalizeGitUrl = (url: string): string => {
  let normalized = url.trim();

  // Remove .git suffix
  if (normalized.endsWith('.git')) {
    normalized = normalized.slice(0, -4);
  }

  // Remove trailing slashes
  normalized = normalized.replace(/\/+$/, '');

  // Convert SSH format to normalized format
  // git@github.com:user/repo -> github.com/user/repo
  const sshMatch = normalized.match(/^[\w-]+@([\w.-]+):(.+)$/);
  if (sshMatch) {
    const [, host, path] = sshMatch;
    return `${host}/${path}`;
  }

  // Convert HTTPS format to normalized format
  // https://github.com/user/repo -> github.com/user/repo
  const httpsMatch = normalized.match(/^https?:\/\/([\w.-]+)\/(.+)$/);
  if (httpsMatch) {
    const [, host, path] = httpsMatch;
    return `${host}/${path}`;
  }

  // Return as-is if not recognized format
  return normalized;
};

/**
 * Extracts the project name from a normalized URL or path.
 *
 * @param normalizedUrl - The normalized URL
 * @returns The project/repository name
 */
const extractProjectName = (normalizedUrl: string): string => {
  const parts = normalizedUrl.split('/');
  return parts[parts.length - 1] || normalizedUrl;
};

/**
 * Creates a project identifier service.
 *
 * @param deps - Dependencies including logger
 * @returns A ProjectIdentifierService instance
 * @example
 * const service = createProjectIdentifierService({ logger });
 * const result = await service.getProjectIdentifier('/path/to/project');
 * if (result.ok) {
 *   console.log(result.value.projectHash); // '1a2b3c4d5e6f7890'
 * }
 */
export const createProjectIdentifierService = (
  deps: ProjectIdentifierServiceDeps,
): ProjectIdentifierService => {
  const { logger } = deps;

  const computeHash = (input: string): string => {
    const hash = createHash('sha256').update(input).digest('hex');
    return hash.slice(0, 16);
  };

  const normalizeUrl = (url: string): string => {
    return normalizeGitUrl(url);
  };

  const service: ProjectIdentifierService = {
    async getProjectIdentifier(projectDir) {
      logger.debug('Getting project identifier', { projectDir });

      try {
        // Try to get Git remote URL
        const { stdout } = await execAsync('git remote get-url origin', {
          cwd: projectDir,
        });

        const remoteUrl = stdout.trim();

        if (remoteUrl) {
          const normalized = normalizeUrl(remoteUrl);
          const projectHash = computeHash(normalized);
          const projectName = extractProjectName(normalized);

          logger.debug('Project identified via Git remote', {
            remoteUrl,
            normalized,
            projectHash,
            projectName,
          });

          return ok({
            remoteUrl: normalized,
            projectHash,
            projectName,
          });
        }
      } catch (e) {
        // Git command failed - log and fall back to directory hash
        const errorMessage = e instanceof Error ? e.message : String(e);
        logger.debug(
          'Git remote lookup failed, falling back to directory hash',
          {
            error: errorMessage,
          },
        );
      }

      // Fallback: Use directory path as identifier
      // This handles non-git projects or repos without remotes
      const projectHash = computeHash(projectDir);
      const projectName = extractProjectName(projectDir);

      logger.debug('Project identified via directory path', {
        projectDir,
        projectHash,
        projectName,
      });

      return ok({
        remoteUrl: `local:${projectDir}`,
        projectHash,
        projectName,
      });
    },

    computeHash,
    normalizeUrl,
  };

  return service;
};
