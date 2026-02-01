#!/usr/bin/env node
import { homedir } from 'node:os';
import { Command } from 'commander';
import { createNodeFs } from '../adapters/fs/node-fs.js';
import { main as hookMain } from '../cli/hook-command.js';
import { LogLevel, createLogger } from '../infrastructure/logger.js';
import { createHttpServer } from '../mcp/http-transport.js';
import { startMcpServer } from '../mcp/transport.js';
import { createConfigService } from '../services/config-service.js';
import { createContextService } from '../services/context-service.js';
import { createProjectIdentifierService } from '../services/project-identifier-service.js';
import { createRemoteContextService } from '../services/remote-context-service.js';

const program = new Command();

program
  .name('ben-ten')
  .description('Ben-Ten - Photographic memory for Claude Code')
  .version('0.1.0');

program
  .command('hook')
  .description('Handle Claude Code lifecycle hooks (reads JSON from stdin)')
  .action(async () => {
    await hookMain();
  });

program
  .command('status')
  .description('Show Ben-Ten context status for current directory')
  .action(async () => {
    const fs = createNodeFs();
    const logger = createLogger({ level: LogLevel.WARN });
    const projectDir = process.cwd();
    const contextService = createContextService({ fs, logger, projectDir });

    const hasContext = await contextService.hasContext();
    const contextPath = contextService.getContextPath();

    if (!hasContext) {
      console.log('No Ben-Ten context found.');
      console.log(`Path: ${contextPath}`);
      return;
    }

    const loadResult = await contextService.loadContext();
    if (!loadResult.ok) {
      console.error(`Error loading context: ${loadResult.error.message}`);
      process.exit(1);
    }

    const ctx = loadResult.value;
    console.log('Ben-Ten Context Status');
    console.log('====================');
    console.log(`Path: ${contextPath}`);
    console.log(`Session ID: ${ctx.sessionId}`);
    console.log(`Created: ${new Date(ctx.createdAt).toISOString()}`);
    console.log(`Updated: ${new Date(ctx.updatedAt).toISOString()}`);
    console.log(`Summary Length: ${ctx.summary.length} chars`);
    if (ctx.keyFiles) {
      console.log(`Key Files: ${ctx.keyFiles.length}`);
    }
    if (ctx.activeTasks) {
      console.log(`Active Tasks: ${ctx.activeTasks.length}`);
    }
  });

program
  .command('show')
  .description('Display the full context summary')
  .action(async () => {
    const fs = createNodeFs();
    const logger = createLogger({ level: LogLevel.WARN });
    const projectDir = process.cwd();
    const contextService = createContextService({ fs, logger, projectDir });

    const loadResult = await contextService.loadContext();
    if (!loadResult.ok) {
      console.error(`Error: ${loadResult.error.message}`);
      process.exit(1);
    }

    const ctx = loadResult.value;
    console.log('# Ben-Ten Context');
    console.log();
    console.log(`**Session:** ${ctx.sessionId}`);
    console.log(`**Last Updated:** ${new Date(ctx.updatedAt).toISOString()}`);
    console.log();
    console.log('## Summary');
    console.log(ctx.summary);

    if (ctx.keyFiles && ctx.keyFiles.length > 0) {
      console.log();
      console.log('## Key Files');
      for (const f of ctx.keyFiles) {
        console.log(`- ${f}`);
      }
    }

    if (ctx.activeTasks && ctx.activeTasks.length > 0) {
      console.log();
      console.log('## Active Tasks');
      for (const t of ctx.activeTasks) {
        console.log(`- ${t}`);
      }
    }
  });

program
  .command('clear')
  .description('Delete the context file')
  .action(async () => {
    const fs = createNodeFs();
    const logger = createLogger({ level: LogLevel.WARN });
    const projectDir = process.cwd();
    const contextService = createContextService({ fs, logger, projectDir });

    const deleteResult = await contextService.deleteContext();
    if (!deleteResult.ok) {
      console.error(`Error: ${deleteResult.error.message}`);
      process.exit(1);
    }

    console.log('Context cleared.');
  });

program
  .command('init')
  .description('Initialize Ben-Ten for this project')
  .action(async () => {
    const fs = createNodeFs();
    const logger = createLogger({ level: LogLevel.WARN });
    const projectDir = process.cwd();
    const contextService = createContextService({ fs, logger, projectDir });

    // Check if already initialized
    if (await contextService.hasContext()) {
      console.log('Ben-Ten already initialized.');
      console.log(`Context: ${contextService.getContextPath()}`);
      return;
    }

    // Create the .ben-ten directory
    const mkdirResult = await fs.mkdir(contextService.getBenTenDir(), {
      recursive: true,
    });
    if (!mkdirResult.ok) {
      console.error(`Error creating directory: ${mkdirResult.error.message}`);
      process.exit(1);
    }

    console.log('Ben-Ten initialized.');
    console.log(`Directory: ${contextService.getBenTenDir()}`);
    console.log();
    console.log('To use with Claude Code, add to .claude/settings.json:');
    console.log(
      JSON.stringify(
        {
          hooks: {
            SessionStart: ['ben-ten hook'],
            SessionEnd: ['ben-ten hook'],
          },
        },
        null,
        2,
      ),
    );
  });

program
  .command('serve')
  .description('Start Ben-Ten as an MCP server (stdio transport)')
  .action(async () => {
    const fs = createNodeFs();
    const logger = createLogger({ level: LogLevel.INFO });
    const projectDir = process.cwd();

    try {
      await startMcpServer({ fs, logger, projectDir });
    } catch (error) {
      logger.error('Failed to start MCP server', {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    }
  });

program
  .command('serve-http')
  .description('Start Ben-Ten HTTP server for remote context storage')
  .option('-p, --port <port>', 'Port to listen on', '3456')
  .option('-h, --host <host>', 'Host to bind to', '0.0.0.0')
  .option(
    '-s, --storage <path>',
    'Storage directory',
    `${homedir()}/.ben-ten-server`,
  )
  .option(
    '-k, --api-key <key>',
    'API key for authentication (can be specified multiple times)',
  )
  .action(async (options) => {
    const fs = createNodeFs();
    const logger = createLogger({ level: LogLevel.INFO });

    const port = Number.parseInt(options.port, 10);
    if (Number.isNaN(port) || port < 1 || port > 65535) {
      console.error('Error: Invalid port number');
      process.exit(1);
    }

    const apiKeys: string[] = [];
    // Support API key from CLI option or environment variable
    if (options.apiKey) {
      apiKeys.push(options.apiKey);
    } else if (process.env.BEN_TEN_API_KEY) {
      apiKeys.push(process.env.BEN_TEN_API_KEY);
    }

    // Create storage directory
    const mkdirResult = await fs.mkdir(options.storage, { recursive: true });
    if (!mkdirResult.ok) {
      console.error(
        `Error creating storage directory: ${mkdirResult.error.message}`,
      );
      process.exit(1);
    }

    const server = createHttpServer({
      fs,
      logger,
      config: {
        port,
        host: options.host,
        apiKeys,
        storagePath: options.storage,
      },
    });

    try {
      await server.start();
      console.log(`Ben-Ten HTTP server listening on ${options.host}:${port}`);
      console.log(`Storage: ${options.storage}`);
      if (apiKeys.length > 0) {
        console.log('Authentication: enabled');
      } else {
        console.log('Authentication: disabled (no API keys configured)');
      }

      // Handle graceful shutdown
      const shutdown = async () => {
        console.log('\nShutting down...');
        await server.stop();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    } catch (error) {
      console.error(
        `Failed to start server: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    }
  });

// Remote subcommands
const remoteCmd = program
  .command('remote')
  .description('Manage remote context storage');

remoteCmd
  .command('status')
  .description('Check remote server connection status')
  .action(async () => {
    const fs = createNodeFs();
    const logger = createLogger({ level: LogLevel.WARN });
    const projectDir = process.cwd();

    const configService = createConfigService({ fs, logger, projectDir });
    const configResult = await configService.loadConfig();

    if (!configResult.ok) {
      console.error(`Error loading config: ${configResult.error.message}`);
      process.exit(1);
    }

    const config = configResult.value;

    if (!config.remote?.serverUrl) {
      console.log('Remote server not configured.');
      console.log('');
      console.log('To configure, run:');
      console.log('  ben-ten config remote.serverUrl http://localhost:3456');
      console.log('  ben-ten config remote.enabled true');
      return;
    }

    console.log('Remote Configuration:');
    console.log(`  Server URL: ${config.remote.serverUrl}`);
    console.log(`  Enabled: ${config.remote.enabled}`);
    console.log(`  Auto-sync: ${config.remote.autoSync ?? false}`);
    console.log(`  API Key: ${config.remote.apiKey ? '(set)' : '(not set)'}`);
    console.log('');

    if (!config.remote.enabled) {
      console.log('Remote storage is disabled.');
      return;
    }

    // Check connection
    const remoteService = createRemoteContextService({
      logger,
      serverUrl: config.remote.serverUrl,
      apiKey: config.remote.apiKey,
    });

    const healthResult = await remoteService.healthCheck();
    if (healthResult.ok && healthResult.value) {
      console.log('Connection: OK');

      // Get project identifier
      const projectIdentifierService = createProjectIdentifierService({
        logger,
      });
      const identifierResult =
        await projectIdentifierService.getProjectIdentifier(projectDir);
      if (identifierResult.ok) {
        console.log(`Project Hash: ${identifierResult.value.projectHash}`);

        // Check if context exists on remote
        const hasRemote = await remoteService.hasContext(
          identifierResult.value.projectHash,
        );
        if (hasRemote.ok) {
          console.log(
            `Remote Context: ${hasRemote.value ? 'exists' : 'not found'}`,
          );
        }
      }
    } else {
      console.log('Connection: FAILED');
      if (!healthResult.ok) {
        console.log(`Error: ${healthResult.error.message}`);
      }
    }
  });

remoteCmd
  .command('push')
  .description('Push local context to remote server')
  .action(async () => {
    const fs = createNodeFs();
    const logger = createLogger({ level: LogLevel.WARN });
    const projectDir = process.cwd();

    const configService = createConfigService({ fs, logger, projectDir });
    const configResult = await configService.loadConfig();

    if (!configResult.ok || !configResult.value.remote?.serverUrl) {
      console.error('Remote server not configured.');
      process.exit(1);
    }

    const config = configResult.value;

    // Load local context
    const contextService = createContextService({ fs, logger, projectDir });
    const loadResult = await contextService.loadContext();
    if (!loadResult.ok) {
      console.error(`No local context found: ${loadResult.error.message}`);
      process.exit(1);
    }

    // Get project identifier
    const projectIdentifierService = createProjectIdentifierService({ logger });
    const identifierResult =
      await projectIdentifierService.getProjectIdentifier(projectDir);
    if (!identifierResult.ok) {
      console.error(`Error: ${identifierResult.error.message}`);
      process.exit(1);
    }

    // Push to remote
    const remoteConfig = config.remote;
    if (!remoteConfig) {
      console.error('Remote server not configured.');
      process.exit(1);
    }

    const remoteService = createRemoteContextService({
      logger,
      serverUrl: remoteConfig.serverUrl,
      apiKey: remoteConfig.apiKey,
    });

    console.log(`Pushing to ${remoteConfig.serverUrl}...`);
    const saveResult = await remoteService.saveContext(
      identifierResult.value.projectHash,
      loadResult.value,
    );

    if (!saveResult.ok) {
      console.error(`Error: ${saveResult.error.message}`);
      process.exit(1);
    }

    console.log('Context pushed successfully.');
    console.log(`Project Hash: ${identifierResult.value.projectHash}`);
  });

remoteCmd
  .command('pull')
  .description('Pull context from remote server to local')
  .action(async () => {
    const fs = createNodeFs();
    const logger = createLogger({ level: LogLevel.WARN });
    const projectDir = process.cwd();

    const configService = createConfigService({ fs, logger, projectDir });
    const configResult = await configService.loadConfig();

    if (!configResult.ok || !configResult.value.remote?.serverUrl) {
      console.error('Remote server not configured.');
      process.exit(1);
    }

    const config = configResult.value;

    // Get project identifier
    const projectIdentifierService = createProjectIdentifierService({ logger });
    const identifierResult =
      await projectIdentifierService.getProjectIdentifier(projectDir);
    if (!identifierResult.ok) {
      console.error(`Error: ${identifierResult.error.message}`);
      process.exit(1);
    }

    // Pull from remote
    const remoteConfig = config.remote;
    if (!remoteConfig) {
      console.error('Remote server not configured.');
      process.exit(1);
    }

    const remoteService = createRemoteContextService({
      logger,
      serverUrl: remoteConfig.serverUrl,
      apiKey: remoteConfig.apiKey,
    });

    console.log(`Pulling from ${remoteConfig.serverUrl}...`);
    const loadResult = await remoteService.loadContext(
      identifierResult.value.projectHash,
    );

    if (!loadResult.ok) {
      console.error(`Error: ${loadResult.error.message}`);
      process.exit(1);
    }

    // Save locally
    const contextService = createContextService({ fs, logger, projectDir });
    const saveResult = await contextService.saveContext(loadResult.value);

    if (!saveResult.ok) {
      console.error(`Error saving locally: ${saveResult.error.message}`);
      process.exit(1);
    }

    console.log('Context pulled successfully.');
    console.log(`Session ID: ${loadResult.value.sessionId}`);
  });

// Config command for setting remote config
program
  .command('config <key> [value]')
  .description('Get or set configuration values (e.g., remote.serverUrl)')
  .action(async (key: string, value?: string) => {
    const fs = createNodeFs();
    const logger = createLogger({ level: LogLevel.WARN });
    const projectDir = process.cwd();

    const configService = createConfigService({ fs, logger, projectDir });
    const configResult = await configService.loadConfig();

    if (!configResult.ok) {
      console.error(`Error loading config: ${configResult.error.message}`);
      process.exit(1);
    }

    const config = configResult.value;

    // If no value, display current value
    if (value === undefined) {
      if (key.startsWith('remote.')) {
        const remoteKey = key.replace(
          'remote.',
          '',
        ) as keyof typeof config.remote;
        const currentValue = config.remote?.[remoteKey];
        console.log(
          currentValue !== undefined ? String(currentValue) : '(not set)',
        );
      } else if (key === 'maxReplayPercent') {
        console.log(config.maxReplayPercent);
      } else if (key === 'contextWindowSize') {
        console.log(config.contextWindowSize);
      } else {
        console.error(`Unknown config key: ${key}`);
        process.exit(1);
      }
      return;
    }

    // Set value
    let updates: Partial<typeof config> = {};

    if (key.startsWith('remote.')) {
      const remoteKey = key.replace('remote.', '');
      const currentRemote = config.remote || {
        serverUrl: '',
        enabled: false,
      };

      if (remoteKey === 'serverUrl') {
        updates = {
          remote: { ...currentRemote, serverUrl: value },
        };
      } else if (remoteKey === 'apiKey') {
        updates = {
          remote: { ...currentRemote, apiKey: value },
        };
      } else if (remoteKey === 'enabled') {
        updates = {
          remote: {
            ...currentRemote,
            enabled: value === 'true' || value === '1',
          },
        };
      } else if (remoteKey === 'autoSync') {
        updates = {
          remote: {
            ...currentRemote,
            autoSync: value === 'true' || value === '1',
          },
        };
      } else {
        console.error(`Unknown remote config key: ${remoteKey}`);
        process.exit(1);
      }
    } else if (key === 'maxReplayPercent') {
      updates = { maxReplayPercent: Number.parseInt(value, 10) };
    } else if (key === 'contextWindowSize') {
      updates = { contextWindowSize: Number.parseInt(value, 10) };
    } else {
      console.error(`Unknown config key: ${key}`);
      process.exit(1);
    }

    const saveResult = await configService.saveConfig(updates);
    if (!saveResult.ok) {
      console.error(`Error saving config: ${saveResult.error.message}`);
      process.exit(1);
    }

    console.log(`Set ${key} = ${value}`);
  });

program.parse();
