import { describe, expect, it } from 'vitest';
import { ContextDataSchema } from '../../src/core/types.js';
import { createContextData } from './context-factory.js';

describe('createContextData', () => {
  it('creates valid ContextData with defaults', () => {
    const data = createContextData();

    // Should have all required fields
    expect(data.version).toBe('1.0.0');
    expect(data.sessionId).toBe('test-session');
    expect(data.summary).toBe('Test context summary');
    // Deterministic timestamps for testing
    expect(data.createdAt).toBe(1000);
    expect(data.updatedAt).toBe(2000);
  });

  it('allows overriding specific fields', () => {
    const data = createContextData({
      sessionId: 'custom-session',
      summary: 'Custom summary',
    });

    expect(data.sessionId).toBe('custom-session');
    expect(data.summary).toBe('Custom summary');
    // Non-overridden fields keep defaults
    expect(data.createdAt).toBe(1000);
  });

  it('supports optional keyFiles', () => {
    const data = createContextData({
      keyFiles: ['src/index.ts', 'src/main.ts'],
    });

    expect(data.keyFiles).toEqual(['src/index.ts', 'src/main.ts']);
  });

  it('supports optional activeTasks', () => {
    const data = createContextData({
      activeTasks: ['Task 1', 'Task 2'],
    });

    expect(data.activeTasks).toEqual(['Task 1', 'Task 2']);
  });

  it('produces data that passes Zod validation', () => {
    const data = createContextData();
    const result = ContextDataSchema.safeParse(data);

    expect(result.success).toBe(true);
  });
});
