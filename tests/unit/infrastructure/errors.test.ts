import { describe, expect, it } from 'vitest';
import {
  type BenTenError,
  ErrorCode,
  createError,
  isErrorCode,
} from '../../../src/infrastructure/errors.js';

describe('Error utilities', () => {
  describe('ErrorCode', () => {
    it('has file system error codes', () => {
      expect(ErrorCode.FS_NOT_FOUND).toBe('FS_NOT_FOUND');
      expect(ErrorCode.FS_PERMISSION_DENIED).toBe('FS_PERMISSION_DENIED');
      expect(ErrorCode.FS_WRITE_ERROR).toBe('FS_WRITE_ERROR');
    });

    it('has context error codes', () => {
      expect(ErrorCode.CONTEXT_NOT_FOUND).toBe('CONTEXT_NOT_FOUND');
      expect(ErrorCode.CONTEXT_CORRUPTED).toBe('CONTEXT_CORRUPTED');
      expect(ErrorCode.CONTEXT_LOCKED).toBe('CONTEXT_LOCKED');
    });

    it('has serialization error codes', () => {
      expect(ErrorCode.SERIALIZE_FAILED).toBe('SERIALIZE_FAILED');
      expect(ErrorCode.DESERIALIZE_FAILED).toBe('DESERIALIZE_FAILED');
      expect(ErrorCode.CHECKSUM_MISMATCH).toBe('CHECKSUM_MISMATCH');
    });

    it('has hook error codes', () => {
      expect(ErrorCode.HOOK_INVALID_INPUT).toBe('HOOK_INVALID_INPUT');
      expect(ErrorCode.HOOK_EXECUTION_FAILED).toBe('HOOK_EXECUTION_FAILED');
    });

    it('has MCP error codes', () => {
      expect(ErrorCode.MCP_TOOL_ERROR).toBe('MCP_TOOL_ERROR');
      expect(ErrorCode.MCP_RESOURCE_ERROR).toBe('MCP_RESOURCE_ERROR');
    });

    it('has transcript error codes', () => {
      expect(ErrorCode.TRANSCRIPT_NOT_FOUND).toBe('TRANSCRIPT_NOT_FOUND');
      expect(ErrorCode.TRANSCRIPT_PARSE_ERROR).toBe('TRANSCRIPT_PARSE_ERROR');
    });
  });

  describe('createError', () => {
    it('creates an error with code and message', () => {
      const error = createError(ErrorCode.FS_NOT_FOUND, 'File not found');

      expect(error.code).toBe(ErrorCode.FS_NOT_FOUND);
      expect(error.message).toBe('File not found');
      expect(error.details).toBeUndefined();
    });

    it('creates an error with details', () => {
      const error = createError(ErrorCode.FS_NOT_FOUND, 'File not found', {
        path: '/some/path.txt',
      });

      expect(error.code).toBe(ErrorCode.FS_NOT_FOUND);
      expect(error.message).toBe('File not found');
      expect(error.details).toEqual({ path: '/some/path.txt' });
    });

    it('returns a frozen object', () => {
      const error = createError(ErrorCode.FS_NOT_FOUND, 'File not found');

      expect(Object.isFrozen(error)).toBe(true);
    });
  });

  describe('isErrorCode', () => {
    it('returns true for valid error codes', () => {
      expect(isErrorCode('FS_NOT_FOUND')).toBe(true);
      expect(isErrorCode('CONTEXT_CORRUPTED')).toBe(true);
      expect(isErrorCode('HOOK_INVALID_INPUT')).toBe(true);
    });

    it('returns false for invalid error codes', () => {
      expect(isErrorCode('INVALID_CODE')).toBe(false);
      expect(isErrorCode('')).toBe(false);
      expect(isErrorCode('fs_not_found')).toBe(false); // case sensitive
    });

    it('returns false for non-strings', () => {
      expect(isErrorCode(123)).toBe(false);
      expect(isErrorCode(null)).toBe(false);
      expect(isErrorCode(undefined)).toBe(false);
      expect(isErrorCode({})).toBe(false);
    });
  });

  describe('BenTenError type', () => {
    it('can be used with Result type', () => {
      const error: BenTenError = {
        code: ErrorCode.CONTEXT_NOT_FOUND,
        message: 'No context found',
      };

      expect(error.code).toBe(ErrorCode.CONTEXT_NOT_FOUND);
    });
  });
});
