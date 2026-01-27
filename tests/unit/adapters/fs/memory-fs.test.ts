import { beforeEach, describe, expect, it } from 'vitest';
import {
  type FileSystem,
  createMemoryFs,
} from '../../../../src/adapters/fs/memory-fs.js';
import { ErrorCode } from '../../../../src/infrastructure/errors.js';
import { isErr, isOk } from '../../../../src/infrastructure/result.js';

describe('MemoryFs', () => {
  let fs: FileSystem;

  beforeEach(() => {
    fs = createMemoryFs();
  });

  describe('writeFile', () => {
    it('writes a file successfully', async () => {
      const result = await fs.writeFile('/test.txt', 'Hello, World!');

      expect(isOk(result)).toBe(true);
    });

    it('creates parent directories automatically', async () => {
      const result = await fs.writeFile('/a/b/c/test.txt', 'content');

      expect(isOk(result)).toBe(true);
      expect(await fs.exists('/a/b/c')).toBe(true);
    });

    it('overwrites existing file', async () => {
      await fs.writeFile('/test.txt', 'first');
      await fs.writeFile('/test.txt', 'second');

      const readResult = await fs.readFile('/test.txt');
      expect(isOk(readResult)).toBe(true);
      if (isOk(readResult)) {
        expect(readResult.value).toBe('second');
      }
    });
  });

  describe('readFile', () => {
    it('reads an existing file', async () => {
      await fs.writeFile('/test.txt', 'Hello');

      const result = await fs.readFile('/test.txt');

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBe('Hello');
      }
    });

    it('returns error for non-existent file', async () => {
      const result = await fs.readFile('/nonexistent.txt');

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe(ErrorCode.FS_NOT_FOUND);
      }
    });

    it('returns error when reading a directory', async () => {
      await fs.mkdir('/dir');

      const result = await fs.readFile('/dir');

      expect(isErr(result)).toBe(true);
    });
  });

  describe('exists', () => {
    it('returns true for existing file', async () => {
      await fs.writeFile('/test.txt', 'content');

      expect(await fs.exists('/test.txt')).toBe(true);
    });

    it('returns true for existing directory', async () => {
      await fs.mkdir('/dir');

      expect(await fs.exists('/dir')).toBe(true);
    });

    it('returns false for non-existent path', async () => {
      expect(await fs.exists('/nonexistent')).toBe(false);
    });
  });

  describe('mkdir', () => {
    it('creates a directory', async () => {
      const result = await fs.mkdir('/newdir');

      expect(isOk(result)).toBe(true);
      expect(await fs.exists('/newdir')).toBe(true);
    });

    it('creates nested directories with recursive option', async () => {
      const result = await fs.mkdir('/a/b/c', { recursive: true });

      expect(isOk(result)).toBe(true);
      expect(await fs.exists('/a/b/c')).toBe(true);
    });

    it('fails for nested directories without recursive option', async () => {
      const result = await fs.mkdir('/a/b/c');

      expect(isErr(result)).toBe(true);
    });

    it('succeeds silently if directory already exists', async () => {
      await fs.mkdir('/dir');

      const result = await fs.mkdir('/dir');

      expect(isOk(result)).toBe(true);
    });
  });

  describe('readdir', () => {
    it('lists files in a directory', async () => {
      await fs.writeFile('/dir/a.txt', 'a');
      await fs.writeFile('/dir/b.txt', 'b');

      const result = await fs.readdir('/dir');

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.sort()).toEqual(['a.txt', 'b.txt']);
      }
    });

    it('returns error for non-existent directory', async () => {
      const result = await fs.readdir('/nonexistent');

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe(ErrorCode.FS_NOT_FOUND);
      }
    });

    it('returns empty array for empty directory', async () => {
      await fs.mkdir('/empty');

      const result = await fs.readdir('/empty');

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toEqual([]);
      }
    });
  });

  describe('rm', () => {
    it('removes a file', async () => {
      await fs.writeFile('/test.txt', 'content');

      const result = await fs.rm('/test.txt');

      expect(isOk(result)).toBe(true);
      expect(await fs.exists('/test.txt')).toBe(false);
    });

    it('removes a directory with recursive option', async () => {
      await fs.writeFile('/dir/file.txt', 'content');

      const result = await fs.rm('/dir', { recursive: true });

      expect(isOk(result)).toBe(true);
      expect(await fs.exists('/dir')).toBe(false);
    });

    it('fails to remove non-empty directory without recursive', async () => {
      await fs.writeFile('/dir/file.txt', 'content');

      const result = await fs.rm('/dir');

      expect(isErr(result)).toBe(true);
    });

    it('returns error for non-existent path', async () => {
      const result = await fs.rm('/nonexistent');

      expect(isErr(result)).toBe(true);
    });
  });

  describe('stat', () => {
    it('returns file stats', async () => {
      await fs.writeFile('/test.txt', 'content');

      const result = await fs.stat('/test.txt');

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.isFile).toBe(true);
        expect(result.value.isDirectory).toBe(false);
        expect(result.value.size).toBe(7); // 'content'.length
      }
    });

    it('returns directory stats', async () => {
      await fs.mkdir('/dir');

      const result = await fs.stat('/dir');

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.isFile).toBe(false);
        expect(result.value.isDirectory).toBe(true);
      }
    });

    it('returns error for non-existent path', async () => {
      const result = await fs.stat('/nonexistent');

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe(ErrorCode.FS_NOT_FOUND);
      }
    });
  });

  describe('createMemoryFs with initial data', () => {
    it('initializes with provided files', async () => {
      const fs = createMemoryFs({
        '/a.txt': 'content a',
        '/dir/b.txt': 'content b',
      });

      expect(await fs.exists('/a.txt')).toBe(true);
      expect(await fs.exists('/dir/b.txt')).toBe(true);

      const resultA = await fs.readFile('/a.txt');
      expect(isOk(resultA) && resultA.value).toBe('content a');
    });
  });
});
