import type { FileSystem } from '../adapters/fs/memory-fs.js';
import {
  type BenTenError,
  ErrorCode,
  createError,
} from '../infrastructure/errors.js';
import type { Logger } from '../infrastructure/logger.js';
import { type Result, err, ok } from '../infrastructure/result.js';
import { BEN10_DIR } from './context-service.js';

/** Config file name within .ben-ten directory */
export const CONFIG_FILE = 'config.json';

/**
 * Ben-Ten configuration options.
 */
export interface BenTenConfig {
  /** Max percentage of context window for replay (1-90, default: 50) */
  maxReplayPercent: number;
  /** Assumed context window size in tokens (default: 100000) */
  contextWindowSize: number;
}

/** Default configuration values */
export const DEFAULT_CONFIG: BenTenConfig = {
  maxReplayPercent: 50,
  contextWindowSize: 100000,
};

/**
 * Service for managing Ben-Ten configuration.
 */
export interface ConfigService {
  /**
   * Load configuration from file.
   * Returns defaults if file doesn't exist.
   *
   * @returns Result with BenTenConfig or error
   */
  loadConfig(): Promise<Result<BenTenConfig, BenTenError>>;

  /**
   * Save configuration to file.
   * Merges with existing config.
   *
   * @param config - Partial configuration to save
   * @returns Result indicating success or error
   */
  saveConfig(config: Partial<BenTenConfig>): Promise<Result<void, BenTenError>>;

  /**
   * Get the full path to the config file.
   *
   * @returns Path to config file
   */
  getConfigPath(): string;
}

export interface ConfigServiceDeps {
  fs: FileSystem;
  logger: Logger;
  projectDir: string;
}

/**
 * Clamps a value between min and max bounds.
 *
 * @param value - Value to clamp
 * @param min - Minimum bound
 * @param max - Maximum bound
 * @returns Clamped value
 */
const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

/**
 * Validates and normalizes configuration values.
 * Clamps values to valid ranges.
 *
 * @param config - Configuration to validate
 * @returns Validated configuration
 */
const validateConfig = (config: Partial<BenTenConfig>): BenTenConfig => {
  const validated: BenTenConfig = {
    maxReplayPercent: DEFAULT_CONFIG.maxReplayPercent,
    contextWindowSize: DEFAULT_CONFIG.contextWindowSize,
  };

  if (typeof config.maxReplayPercent === 'number') {
    validated.maxReplayPercent = clamp(config.maxReplayPercent, 1, 90);
  }

  if (typeof config.contextWindowSize === 'number') {
    validated.contextWindowSize = clamp(
      config.contextWindowSize,
      10000,
      Number.MAX_SAFE_INTEGER,
    );
  }

  return validated;
};

/**
 * Creates a configuration service for Ben-Ten settings.
 *
 * @param deps - Dependencies including file system, logger, and project directory
 * @returns A ConfigService instance
 * @example
 * const configService = createConfigService({ fs, logger, projectDir });
 * const config = await configService.loadConfig();
 */
export const createConfigService = (deps: ConfigServiceDeps): ConfigService => {
  const { fs, logger, projectDir } = deps;
  const benTenDir = `${projectDir}/${BEN10_DIR}`;
  const configPath = `${benTenDir}/${CONFIG_FILE}`;

  const service: ConfigService = {
    async loadConfig() {
      logger.debug('Loading config', { path: configPath });

      // Check if config file exists
      if (!(await fs.exists(configPath))) {
        logger.debug('Config file not found, using defaults');
        return ok({ ...DEFAULT_CONFIG });
      }

      // Read file
      const readResult = await fs.readFile(configPath);
      if (!readResult.ok) {
        return err(
          createError(ErrorCode.CONFIG_INVALID, 'Failed to read config file', {
            path: configPath,
            originalError: readResult.error.message,
          }),
        );
      }

      // Parse JSON
      let parsed: unknown;
      try {
        parsed = JSON.parse(readResult.value);
      } catch (e) {
        return err(
          createError(ErrorCode.CONFIG_INVALID, 'Invalid JSON in config file', {
            path: configPath,
            error: e instanceof Error ? e.message : String(e),
          }),
        );
      }

      // Validate and merge with defaults
      const validated = validateConfig(parsed as Partial<BenTenConfig>);
      logger.debug('Loaded config', { config: validated });

      return ok(validated);
    },

    async saveConfig(config) {
      logger.debug('Saving config', { config });

      // Ensure .ben-ten directory exists
      if (!(await fs.exists(benTenDir))) {
        const mkdirResult = await fs.mkdir(benTenDir, { recursive: true });
        if (!mkdirResult.ok) {
          return err(
            createError(
              ErrorCode.FS_WRITE_ERROR,
              'Failed to create .ben-ten directory',
              { path: benTenDir, error: mkdirResult.error.message },
            ),
          );
        }
      }

      // Load existing config to merge with
      let existing = { ...DEFAULT_CONFIG };
      if (await fs.exists(configPath)) {
        const loadResult = await service.loadConfig();
        if (loadResult.ok) {
          existing = loadResult.value;
        }
      }

      // Merge and validate
      const merged = validateConfig({
        ...existing,
        ...config,
      });

      // Write to file
      const writeResult = await fs.writeFile(
        configPath,
        JSON.stringify(merged, null, 2),
      );
      if (!writeResult.ok) {
        return err(
          createError(ErrorCode.FS_WRITE_ERROR, 'Failed to write config file', {
            path: configPath,
            error: writeResult.error.message,
          }),
        );
      }

      logger.info('Saved config', { path: configPath });
      return ok(undefined);
    },

    getConfigPath() {
      return configPath;
    },
  };

  return service;
};
