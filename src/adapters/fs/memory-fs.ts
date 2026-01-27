import {
  type Ben10Error,
  ErrorCode,
  createError,
} from '../../infrastructure/errors.js';
import { type Result, err, ok } from '../../infrastructure/result.js';

/**
 * File statistics returned by stat operations.
 */
export interface FileStats {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  mtime: Date;
}

/**
 * Options for mkdir operation.
 */
export interface MkdirOptions {
  recursive?: boolean;
}

/**
 * Options for rm operation.
 */
export interface RmOptions {
  recursive?: boolean;
}

/**
 * File system interface for abstracting file operations.
 * Allows swapping real FS for in-memory FS in tests.
 */
export interface FileSystem {
  readFile(path: string): Promise<Result<string, Ben10Error>>;
  writeFile(path: string, content: string): Promise<Result<void, Ben10Error>>;
  exists(path: string): Promise<boolean>;
  mkdir(
    path: string,
    options?: MkdirOptions,
  ): Promise<Result<void, Ben10Error>>;
  readdir(path: string): Promise<Result<string[], Ben10Error>>;
  rm(path: string, options?: RmOptions): Promise<Result<void, Ben10Error>>;
  stat(path: string): Promise<Result<FileStats, Ben10Error>>;
}

interface FsNode {
  type: 'file' | 'directory';
  content?: string;
  mtime: Date;
}

/**
 * Creates an in-memory file system for testing.
 * All operations are synchronous but return Promises for API compatibility.
 *
 * @param initial - Optional initial file contents (path -> content)
 * @returns A FileSystem implementation
 */
export const createMemoryFs = (
  initial?: Record<string, string>,
): FileSystem => {
  const nodes = new Map<string, FsNode>();

  // Initialize root directory
  nodes.set('/', { type: 'directory', mtime: new Date() });

  // Helper to normalize paths
  const normalizePath = (path: string): string => {
    // Ensure path starts with /
    const normalized = path.startsWith('/') ? path : `/${path}`;
    // Remove trailing slash unless it's root
    return normalized === '/' ? '/' : normalized.replace(/\/$/, '');
  };

  // Helper to get parent directory path
  const getParentPath = (path: string): string => {
    const normalized = normalizePath(path);
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash === 0 ? '/' : normalized.slice(0, lastSlash);
  };

  // Helper to ensure parent directories exist
  const ensureParentDirs = (path: string): void => {
    const parts = normalizePath(path).split('/').filter(Boolean);
    let current = '';
    for (let i = 0; i < parts.length - 1; i++) {
      current += `/${parts[i]}`;
      if (!nodes.has(current)) {
        nodes.set(current, { type: 'directory', mtime: new Date() });
      }
    }
  };

  // Initialize with provided files
  if (initial) {
    for (const [path, content] of Object.entries(initial)) {
      const normalized = normalizePath(path);
      ensureParentDirs(normalized);
      nodes.set(normalized, { type: 'file', content, mtime: new Date() });
    }
  }

  const fs: FileSystem = {
    async readFile(path) {
      const normalized = normalizePath(path);
      const node = nodes.get(normalized);

      if (!node) {
        return err(
          createError(ErrorCode.FS_NOT_FOUND, `File not found: ${path}`, {
            path,
          }),
        );
      }

      if (node.type !== 'file') {
        return err(
          createError(
            ErrorCode.FS_READ_ERROR,
            `Cannot read directory as file: ${path}`,
            { path },
          ),
        );
      }

      return ok(node.content ?? '');
    },

    async writeFile(path, content) {
      const normalized = normalizePath(path);
      ensureParentDirs(normalized);
      nodes.set(normalized, { type: 'file', content, mtime: new Date() });
      return ok(undefined);
    },

    async exists(path) {
      const normalized = normalizePath(path);
      return nodes.has(normalized);
    },

    async mkdir(path, options = {}) {
      const normalized = normalizePath(path);

      // Check if already exists
      if (nodes.has(normalized)) {
        const node = nodes.get(normalized);
        if (node?.type === 'directory') {
          return ok(undefined);
        }
        return err(
          createError(
            ErrorCode.FS_WRITE_ERROR,
            `Path exists but is not a directory: ${path}`,
            { path },
          ),
        );
      }

      // Check parent exists
      const parent = getParentPath(normalized);
      if (parent !== '/' && !nodes.has(parent)) {
        if (options.recursive) {
          ensureParentDirs(`${normalized}/dummy`);
        } else {
          return err(
            createError(
              ErrorCode.FS_NOT_FOUND,
              `Parent directory does not exist: ${parent}`,
              { path, parent },
            ),
          );
        }
      }

      nodes.set(normalized, { type: 'directory', mtime: new Date() });
      return ok(undefined);
    },

    async readdir(path) {
      const normalized = normalizePath(path);
      const node = nodes.get(normalized);

      if (!node) {
        return err(
          createError(ErrorCode.FS_NOT_FOUND, `Directory not found: ${path}`, {
            path,
          }),
        );
      }

      if (node.type !== 'directory') {
        return err(
          createError(ErrorCode.FS_READ_ERROR, `Not a directory: ${path}`, {
            path,
          }),
        );
      }

      const prefix = normalized === '/' ? '/' : `${normalized}/`;
      const entries: string[] = [];

      for (const key of nodes.keys()) {
        if (key !== normalized && key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          // Only include direct children (no slashes in rest)
          if (!rest.includes('/')) {
            entries.push(rest);
          }
        }
      }

      return ok(entries);
    },

    async rm(path, options = {}) {
      const normalized = normalizePath(path);
      const node = nodes.get(normalized);

      if (!node) {
        return err(
          createError(ErrorCode.FS_NOT_FOUND, `Path not found: ${path}`, {
            path,
          }),
        );
      }

      if (node.type === 'directory') {
        // Check if directory is empty
        const prefix = normalized === '/' ? '/' : `${normalized}/`;
        const hasChildren = Array.from(nodes.keys()).some(
          (key) => key !== normalized && key.startsWith(prefix),
        );

        if (hasChildren && !options.recursive) {
          return err(
            createError(
              ErrorCode.FS_WRITE_ERROR,
              `Directory not empty: ${path}`,
              { path },
            ),
          );
        }

        // Remove all children if recursive
        if (hasChildren) {
          for (const key of Array.from(nodes.keys())) {
            if (key.startsWith(prefix)) {
              nodes.delete(key);
            }
          }
        }
      }

      nodes.delete(normalized);
      return ok(undefined);
    },

    async stat(path) {
      const normalized = normalizePath(path);
      const node = nodes.get(normalized);

      if (!node) {
        return err(
          createError(ErrorCode.FS_NOT_FOUND, `Path not found: ${path}`, {
            path,
          }),
        );
      }

      return ok({
        isFile: node.type === 'file',
        isDirectory: node.type === 'directory',
        size: node.content?.length ?? 0,
        mtime: node.mtime,
      });
    },
  };

  return fs;
};
