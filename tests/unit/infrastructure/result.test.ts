import { describe, expect, it } from 'vitest';
import {
  type Result,
  err,
  flatMap,
  isErr,
  isOk,
  map,
  mapErr,
  ok,
  unwrap,
  unwrapOr,
} from '../../../src/infrastructure/result.js';

describe('Result type utilities', () => {
  describe('ok', () => {
    it('creates a successful result with the given value', () => {
      const result = ok(42);

      expect(result.ok).toBe(true);
      expect(result.value).toBe(42);
    });

    it('works with complex types', () => {
      const data = { name: 'test', items: [1, 2, 3] };
      const result = ok(data);

      expect(result.ok).toBe(true);
      expect(result.value).toEqual(data);
    });
  });

  describe('err', () => {
    it('creates a failed result with the given error', () => {
      const error = { code: 'NOT_FOUND', message: 'Item not found' };
      const result = err(error);

      expect(result.ok).toBe(false);
      expect(result.error).toEqual(error);
    });

    it('works with string errors', () => {
      const result = err('Something went wrong');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Something went wrong');
    });
  });

  describe('isOk', () => {
    it('returns true for successful results', () => {
      const result = ok('success');

      expect(isOk(result)).toBe(true);
    });

    it('returns false for failed results', () => {
      const result = err('failure');

      expect(isOk(result)).toBe(false);
    });

    it('narrows the type correctly', () => {
      const result: Result<number, string> = ok(42);

      if (isOk(result)) {
        // TypeScript should know result.value exists here
        expect(result.value).toBe(42);
      }
    });
  });

  describe('isErr', () => {
    it('returns true for failed results', () => {
      const result = err('failure');

      expect(isErr(result)).toBe(true);
    });

    it('returns false for successful results', () => {
      const result = ok('success');

      expect(isErr(result)).toBe(false);
    });

    it('narrows the type correctly', () => {
      const result: Result<number, string> = err('error');

      if (isErr(result)) {
        // TypeScript should know result.error exists here
        expect(result.error).toBe('error');
      }
    });
  });

  describe('unwrap', () => {
    it('returns the value for successful results', () => {
      const result = ok(42);

      expect(unwrap(result)).toBe(42);
    });

    it('throws for failed results', () => {
      const result = err('Something went wrong');

      expect(() => unwrap(result)).toThrow('Something went wrong');
    });

    it('throws with custom message for object errors', () => {
      const result = err({ code: 'ERR', message: 'Failed' });

      expect(() => unwrap(result)).toThrow();
    });
  });

  describe('unwrapOr', () => {
    it('returns the value for successful results', () => {
      const result = ok(42);

      expect(unwrapOr(result, 0)).toBe(42);
    });

    it('returns the default for failed results', () => {
      const result: Result<number, string> = err('error');

      expect(unwrapOr(result, 0)).toBe(0);
    });
  });

  describe('map', () => {
    it('transforms the value for successful results', () => {
      const result = ok(5);
      const mapped = map(result, (x) => x * 2);

      expect(isOk(mapped)).toBe(true);
      if (isOk(mapped)) {
        expect(mapped.value).toBe(10);
      }
    });

    it('passes through failed results unchanged', () => {
      const result: Result<number, string> = err('error');
      const mapped = map(result, (x) => x * 2);

      expect(isErr(mapped)).toBe(true);
      if (isErr(mapped)) {
        expect(mapped.error).toBe('error');
      }
    });
  });

  describe('mapErr', () => {
    it('transforms the error for failed results', () => {
      const result: Result<number, string> = err('error');
      const mapped = mapErr(result, (e) => ({ code: 'ERR', message: e }));

      expect(isErr(mapped)).toBe(true);
      if (isErr(mapped)) {
        expect(mapped.error).toEqual({ code: 'ERR', message: 'error' });
      }
    });

    it('passes through successful results unchanged', () => {
      const result = ok(42);
      const mapped = mapErr(result, (e) => ({
        code: 'ERR',
        message: String(e),
      }));

      expect(isOk(mapped)).toBe(true);
      if (isOk(mapped)) {
        expect(mapped.value).toBe(42);
      }
    });
  });

  describe('flatMap', () => {
    it('chains successful results', () => {
      const result = ok(5);
      const chained = flatMap(result, (x) => ok(x * 2));

      expect(isOk(chained)).toBe(true);
      if (isOk(chained)) {
        expect(chained.value).toBe(10);
      }
    });

    it('short-circuits on first error', () => {
      const result = ok(5);
      const chained = flatMap(result, () => err('failed'));

      expect(isErr(chained)).toBe(true);
      if (isErr(chained)) {
        expect(chained.error).toBe('failed');
      }
    });

    it('passes through initial error', () => {
      const result: Result<number, string> = err('initial error');
      const chained = flatMap(result, (x) => ok(x * 2));

      expect(isErr(chained)).toBe(true);
      if (isErr(chained)) {
        expect(chained.error).toBe('initial error');
      }
    });
  });
});
