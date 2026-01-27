#!/usr/bin/env node
import { Command } from 'commander';
import { createNodeFs } from '../adapters/fs/node-fs.js';
import { main as hookMain } from '../cli/hook-command.js';
import { LogLevel, createLogger } from '../infrastructure/logger.js';
import { startMcpServer } from '../mcp/transport.js';
import { createContextService } from '../services/context-service.js';

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
      ctx.keyFiles.forEach((f) => console.log(`- ${f}`));
    }

    if (ctx.activeTasks && ctx.activeTasks.length > 0) {
      console.log();
      console.log('## Active Tasks');
      ctx.activeTasks.forEach((t) => console.log(`- ${t}`));
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

program.parse();
