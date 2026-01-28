import { beforeEach, describe, expect, it } from 'vitest';
import {
  type FileSystem,
  createMemoryFs,
} from '../../../src/adapters/fs/memory-fs.js';
import { ErrorCode } from '../../../src/infrastructure/errors.js';
import { LogLevel, createLogger } from '../../../src/infrastructure/logger.js';
import { isErr, isOk } from '../../../src/infrastructure/result.js';
import {
  CONFIG_FILE,
  type ConfigService,
  DEFAULT_CONFIG,
  createConfigService,
} from '../../../src/services/config-service.js';
import { BEN10_DIR } from '../../../src/services/context-service.js';

describe('ConfigService', () => {
  let fs: FileSystem;
  let service: ConfigService;
  const projectDir = '/project';

  beforeEach(() => {
    fs = createMemoryFs();
    const logger = createLogger({ level: LogLevel.ERROR });
    service = createConfigService({ fs, logger, projectDir });
  });

  describe('DEFAULT_CONFIG', () => {
    it('has expected default values', () => {
      expect(DEFAULT_CONFIG.maxReplayPercent).toBe(50);
      expect(DEFAULT_CONFIG.contextWindowSize).toBe(100000);
    });
  });

  describe('loadConfig', () => {
    it('returns defaults when no config file exists', async () => {
      const result = await service.loadConfig();

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.maxReplayPercent).toBe(50);
        expect(result.value.contextWindowSize).toBe(100000);
      }
    });

    it('loads existing config file', async () => {
      const config = {
        maxReplayPercent: 75,
        contextWindowSize: 200000,
      };
      await fs.mkdir(`${projectDir}/${BEN10_DIR}`, { recursive: true });
      await fs.writeFile(
        `${projectDir}/${BEN10_DIR}/${CONFIG_FILE}`,
        JSON.stringify(config),
      );

      const result = await service.loadConfig();

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.maxReplayPercent).toBe(75);
        expect(result.value.contextWindowSize).toBe(200000);
      }
    });

    it('uses defaults for missing fields in config file', async () => {
      const partialConfig = {
        maxReplayPercent: 80,
        // contextWindowSize is missing
      };
      await fs.mkdir(`${projectDir}/${BEN10_DIR}`, { recursive: true });
      await fs.writeFile(
        `${projectDir}/${BEN10_DIR}/${CONFIG_FILE}`,
        JSON.stringify(partialConfig),
      );

      const result = await service.loadConfig();

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.maxReplayPercent).toBe(80);
        expect(result.value.contextWindowSize).toBe(100000); // Default
      }
    });

    it('returns error for corrupted config file', async () => {
      await fs.mkdir(`${projectDir}/${BEN10_DIR}`, { recursive: true });
      await fs.writeFile(
        `${projectDir}/${BEN10_DIR}/${CONFIG_FILE}`,
        'not valid json',
      );

      const result = await service.loadConfig();

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe(ErrorCode.CONFIG_INVALID);
      }
    });

    it('clamps maxReplayPercent to valid range', async () => {
      const config = {
        maxReplayPercent: 150, // Over 90
        contextWindowSize: 100000,
      };
      await fs.mkdir(`${projectDir}/${BEN10_DIR}`, { recursive: true });
      await fs.writeFile(
        `${projectDir}/${BEN10_DIR}/${CONFIG_FILE}`,
        JSON.stringify(config),
      );

      const result = await service.loadConfig();

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.maxReplayPercent).toBe(90); // Clamped to max
      }
    });

    it('clamps maxReplayPercent minimum to 1', async () => {
      const config = {
        maxReplayPercent: 0, // Below 1
        contextWindowSize: 100000,
      };
      await fs.mkdir(`${projectDir}/${BEN10_DIR}`, { recursive: true });
      await fs.writeFile(
        `${projectDir}/${BEN10_DIR}/${CONFIG_FILE}`,
        JSON.stringify(config),
      );

      const result = await service.loadConfig();

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.maxReplayPercent).toBe(1); // Clamped to min
      }
    });
  });

  describe('saveConfig', () => {
    it('saves config to file', async () => {
      const config = {
        maxReplayPercent: 60,
        contextWindowSize: 150000,
      };

      const result = await service.saveConfig(config);

      expect(isOk(result)).toBe(true);

      // Verify file was written
      const fileExists = await fs.exists(
        `${projectDir}/${BEN10_DIR}/${CONFIG_FILE}`,
      );
      expect(fileExists).toBe(true);
    });

    it('creates .ben-ten directory if it does not exist', async () => {
      const config = { maxReplayPercent: 70 };

      await service.saveConfig(config);

      const dirExists = await fs.exists(`${projectDir}/${BEN10_DIR}`);
      expect(dirExists).toBe(true);
    });

    it('merges partial config with existing values', async () => {
      // First save full config
      await service.saveConfig({
        maxReplayPercent: 60,
        contextWindowSize: 150000,
      });

      // Then save only maxReplayPercent
      const result = await service.saveConfig({ maxReplayPercent: 80 });

      expect(isOk(result)).toBe(true);

      // Load and verify contextWindowSize was preserved
      const loadResult = await service.loadConfig();
      expect(isOk(loadResult)).toBe(true);
      if (isOk(loadResult)) {
        expect(loadResult.value.maxReplayPercent).toBe(80);
        expect(loadResult.value.contextWindowSize).toBe(150000);
      }
    });

    it('validates and clamps maxReplayPercent on save', async () => {
      const result = await service.saveConfig({ maxReplayPercent: 100 }); // Over 90

      expect(isOk(result)).toBe(true);

      const loadResult = await service.loadConfig();
      expect(isOk(loadResult)).toBe(true);
      if (isOk(loadResult)) {
        expect(loadResult.value.maxReplayPercent).toBe(90); // Clamped
      }
    });

    it('validates contextWindowSize minimum', async () => {
      const result = await service.saveConfig({ contextWindowSize: 100 }); // Below 10000

      expect(isOk(result)).toBe(true);

      const loadResult = await service.loadConfig();
      expect(isOk(loadResult)).toBe(true);
      if (isOk(loadResult)) {
        expect(loadResult.value.contextWindowSize).toBe(10000); // Clamped to min
      }
    });

    it('saved config can be loaded back', async () => {
      const config = {
        maxReplayPercent: 65,
        contextWindowSize: 120000,
      };

      await service.saveConfig(config);
      const loadResult = await service.loadConfig();

      expect(isOk(loadResult)).toBe(true);
      if (isOk(loadResult)) {
        expect(loadResult.value).toEqual(config);
      }
    });
  });

  describe('getConfigPath', () => {
    it('returns the full path to config file', () => {
      const path = service.getConfigPath();

      expect(path).toBe(`${projectDir}/${BEN10_DIR}/${CONFIG_FILE}`);
    });
  });
});
