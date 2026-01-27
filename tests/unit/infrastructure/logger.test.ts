import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LogLevel,
  type Logger,
  createLogger,
} from '../../../src/infrastructure/logger.js';

describe('Logger', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  describe('createLogger', () => {
    it('creates a logger with default level info', () => {
      const logger = createLogger();

      expect(logger).toBeDefined();
      expect(logger.debug).toBeDefined();
      expect(logger.info).toBeDefined();
      expect(logger.warn).toBeDefined();
      expect(logger.error).toBeDefined();
    });

    it('creates a logger with specified level', () => {
      const logger = createLogger({ level: LogLevel.DEBUG });

      logger.debug('debug message');

      expect(stderrSpy).toHaveBeenCalled();
    });
  });

  describe('log levels', () => {
    it('logs error at all levels', () => {
      const logger = createLogger({ level: LogLevel.ERROR });

      logger.error('error message');

      expect(stderrSpy).toHaveBeenCalled();
    });

    it('logs warn at warn level and above', () => {
      const logger = createLogger({ level: LogLevel.WARN });

      logger.warn('warn message');

      expect(stderrSpy).toHaveBeenCalled();
    });

    it('does not log debug at info level', () => {
      const logger = createLogger({ level: LogLevel.INFO });

      logger.debug('debug message');

      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('logs debug at debug level', () => {
      const logger = createLogger({ level: LogLevel.DEBUG });

      logger.debug('debug message');

      expect(stderrSpy).toHaveBeenCalled();
    });
  });

  describe('output format', () => {
    it('outputs to stderr, never stdout', () => {
      const logger = createLogger({ level: LogLevel.DEBUG });

      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');
      logger.error('error');

      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(stderrSpy).toHaveBeenCalledTimes(4);
    });

    it('includes log level in output', () => {
      const logger = createLogger({ level: LogLevel.INFO });

      logger.info('test message');

      const output = stderrSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('INFO');
      expect(output).toContain('test message');
    });

    it('includes metadata in output', () => {
      const logger = createLogger({ level: LogLevel.INFO });

      logger.info('test message', { key: 'value', count: 42 });

      const output = stderrSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('key');
      expect(output).toContain('value');
    });

    it('outputs valid JSON when json format is enabled', () => {
      const logger = createLogger({ level: LogLevel.INFO, json: true });

      logger.info('test message', { key: 'value' });

      const output = stderrSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output.trim());
      expect(parsed.level).toBe('INFO');
      expect(parsed.message).toBe('test message');
      expect(parsed.key).toBe('value');
    });
  });

  describe('child logger', () => {
    it('creates a child logger with additional context', () => {
      const logger = createLogger({ level: LogLevel.INFO });
      const child = logger.child({ component: 'mcp' });

      child.info('test message');

      const output = stderrSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('component');
      expect(output).toContain('mcp');
    });

    it('preserves parent context in child', () => {
      const logger = createLogger({ level: LogLevel.INFO, json: true });
      const child = logger.child({ component: 'mcp' });

      child.info('test', { action: 'save' });

      const output = stderrSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output.trim());
      expect(parsed.component).toBe('mcp');
      expect(parsed.action).toBe('save');
    });
  });
});
