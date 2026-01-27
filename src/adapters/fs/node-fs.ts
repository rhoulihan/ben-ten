import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  type Ben10Error,
  ErrorCode,
  createError,
} from '../../infrastructure/errors.js';
import { err, ok } from '../../infrastructure/result.js';
import type {
  FileStats,
  FileSystem,
  MkdirOptions,
  RmOptions,
} from './memory-fs.js';

/**
 * Creates a file system adapter wrapping Node.js fs module.
 *
 * @returns A FileSystem implementation using real filesystem
 */
export const createNodeFs = (): FileSystem => {
  const mapError = (error: unknown, path: string): Ben10Error => {
    if (error instanceof Error) {
      const nodeError = error as NodeJS.ErrnoException;

      if (nodeError.code === 'ENOENT') {
        return createError(ErrorCode.FS_NOT_FOUND, `Path not found: ${path}`, {
          path,
          originalError: nodeError.message,
        });
      }

      if (nodeError.code === 'EACCES' || nodeError.code === 'EPERM') {
        return createError(
          ErrorCode.FS_PERMISSION_DENIED,
          `Permission denied: ${path}`,
          { path, originalError: nodeError.message },
        );
      }

      if (nodeError.code === 'ENOTEMPTY' || nodeError.code === 'EISDIR') {
        return createError(
          ErrorCode.FS_WRITE_ERROR,
          `Cannot perform operation: ${nodeError.message}`,
          { path, originalError: nodeError.message },
        );
      }

      return createError(
        ErrorCode.FS_READ_ERROR,
        `File system error: ${nodeError.message}`,
        { path, originalError: nodeError.message },
      );
    }

    return createError(ErrorCode.FS_READ_ERROR, 'Unknown file system error', {
      path,
      error: String(error),
    });
  };

  const nodeFs: FileSystem = {
    async readFile(filePath) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        return ok(content);
      } catch (error) {
        return err(mapError(error, filePath));
      }
    },

    async writeFile(filePath, content) {
      try {
        // Ensure parent directory exists
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });

        await fs.writeFile(filePath, content, 'utf-8');
        return ok(undefined);
      } catch (error) {
        return err(mapError(error, filePath));
      }
    },

    async exists(filePath) {
      try {
        await fs.access(filePath);
        return true;
      } catch {
        return false;
      }
    },

    async mkdir(dirPath, options: MkdirOptions = {}) {
      try {
        await fs.mkdir(dirPath, { recursive: options.recursive ?? false });
        return ok(undefined);
      } catch (error) {
        // Ignore EEXIST errors - directory already exists
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          return ok(undefined);
        }
        return err(mapError(error, dirPath));
      }
    },

    async readdir(dirPath) {
      try {
        const entries = await fs.readdir(dirPath);
        return ok(entries);
      } catch (error) {
        return err(mapError(error, dirPath));
      }
    },

    async rm(filePath, options: RmOptions = {}) {
      try {
        await fs.rm(filePath, { recursive: options.recursive ?? false });
        return ok(undefined);
      } catch (error) {
        return err(mapError(error, filePath));
      }
    },

    async stat(filePath) {
      try {
        const stats = await fs.stat(filePath);
        const result: FileStats = {
          isFile: stats.isFile(),
          isDirectory: stats.isDirectory(),
          size: stats.size,
          mtime: stats.mtime,
        };
        return ok(result);
      } catch (error) {
        return err(mapError(error, filePath));
      }
    },
  };

  return nodeFs;
};

// Re-export types
export type {
  FileSystem,
  FileStats,
  MkdirOptions,
  RmOptions,
} from './memory-fs.js';
