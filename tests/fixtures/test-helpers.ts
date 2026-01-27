import {
  type FileSystem,
  createMemoryFs,
} from '../../src/adapters/fs/memory-fs.js';
import type { ContextData } from '../../src/core/types.js';
import {
  LogLevel,
  type Logger,
  createLogger,
} from '../../src/infrastructure/logger.js';
import { BEN10_DIR, CONTEXT_FILE } from '../../src/services/context-service.js';

/**
 * Test environment with common dependencies.
 */
export interface TestEnv {
  fs: FileSystem;
  logger: Logger;
  projectDir: string;
}

export interface TestEnvOptions {
  projectDir?: string;
}

/**
 * Creates a test environment with memory filesystem and quiet logger.
 *
 * @param options - Optional configuration
 * @returns Test environment with fs, logger, and projectDir
 * @example
 * const { fs, logger, projectDir } = createTestEnv();
 * const service = createContextService({ fs, logger, projectDir });
 */
export const createTestEnv = (options?: TestEnvOptions): TestEnv => {
  return {
    fs: createMemoryFs(),
    logger: createLogger({ level: LogLevel.ERROR }),
    projectDir: options?.projectDir ?? '/project',
  };
};

/**
 * Sets up a context file in the memory filesystem.
 * Creates the .ben10 directory and writes the context.json file.
 *
 * @param fs - The filesystem to use
 * @param projectDir - The project directory
 * @param context - The context data to write
 */
export const setupContextFile = async (
  fs: FileSystem,
  projectDir: string,
  context: ContextData,
): Promise<void> => {
  const ben10Dir = `${projectDir}/${BEN10_DIR}`;
  await fs.mkdir(ben10Dir, { recursive: true });
  await fs.writeFile(`${ben10Dir}/${CONTEXT_FILE}`, JSON.stringify(context));
};

/**
 * Sets up a transcript file in the memory filesystem.
 * Creates parent directories as needed.
 *
 * @param fs - The filesystem to use
 * @param path - The full path to the transcript file
 * @param content - The JSONL content to write
 */
export const setupTranscriptFile = async (
  fs: FileSystem,
  path: string,
  content: string,
): Promise<void> => {
  // Extract directory from path
  const lastSlash = path.lastIndexOf('/');
  if (lastSlash > 0) {
    const dir = path.substring(0, lastSlash);
    await fs.mkdir(dir, { recursive: true });
  }
  await fs.writeFile(path, content);
};
