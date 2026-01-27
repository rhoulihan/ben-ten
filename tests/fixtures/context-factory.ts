import type { ContextData } from '../../src/core/types.js';

/**
 * Creates a ContextData object with deterministic defaults for testing.
 * Uses fixed timestamps (1000, 2000) to ensure test reproducibility.
 *
 * @param overrides - Optional fields to override defaults
 * @returns A valid ContextData object
 * @example
 * const data = createContextData();
 * const custom = createContextData({ sessionId: 'my-session' });
 */
export const createContextData = (
  overrides?: Partial<ContextData>,
): ContextData => {
  return {
    version: '1.0.0',
    createdAt: 1000,
    updatedAt: 2000,
    sessionId: 'test-session',
    summary: 'Test context summary',
    ...overrides,
  };
};
