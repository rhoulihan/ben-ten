#!/usr/bin/env node
import { Command } from 'commander';
import { createNodeFs } from '../adapters/fs/node-fs.js';
import { main as hookMain } from '../cli/hook-command.js';
import { LogLevel, createLogger } from '../infrastructure/logger.js';
import { createContextService } from '../services/context-service.js';

const program = new Command();

program
  .name('ben10')
  .description('Ben10 - Photographic memory for Claude Code')
  .version('0.1.0');

program
  .command('hook')
  .description('Handle Claude Code lifecycle hooks (reads JSON from stdin)')
  .action(async () => {
    await hookMain();
  });

program
  .command('status')
  .description('Show Ben10 context status for current directory')
  .action(async () => {
    const fs = createNodeFs();
    const logger = createLogger({ level: LogLevel.WARN });
    const projectDir = process.cwd();
    const contextService = createContextService({ fs, logger, projectDir });

    const hasContext = await contextService.hasContext();
    const contextPath = contextService.getContextPath();

    if (!hasContext) {
      console.log('No Ben10 context found.');
      console.log(`Path: ${contextPath}`);
      return;
    }

    const loadResult = await contextService.loadContext();
    if (!loadResult.ok) {
      console.error(`Error loading context: ${loadResult.error.message}`);
      process.exit(1);
    }

    const ctx = loadResult.value;
    console.log('Ben10 Context Status');
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
    console.log('# Ben10 Context');
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
  .description('Initialize Ben10 for this project')
  .action(async () => {
    const fs = createNodeFs();
    const logger = createLogger({ level: LogLevel.WARN });
    const projectDir = process.cwd();
    const contextService = createContextService({ fs, logger, projectDir });

    // Check if already initialized
    if (await contextService.hasContext()) {
      console.log('Ben10 already initialized.');
      console.log(`Context: ${contextService.getContextPath()}`);
      return;
    }

    // Create the .ben10 directory
    const mkdirResult = await fs.mkdir(contextService.getBen10Dir(), {
      recursive: true,
    });
    if (!mkdirResult.ok) {
      console.error(`Error creating directory: ${mkdirResult.error.message}`);
      process.exit(1);
    }

    console.log('Ben10 initialized.');
    console.log(`Directory: ${contextService.getBen10Dir()}`);
    console.log();
    console.log('To use with Claude Code, add to .claude/settings.json:');
    console.log(
      JSON.stringify(
        {
          hooks: {
            SessionStart: ['ben10 hook'],
            SessionEnd: ['ben10 hook'],
          },
        },
        null,
        2,
      ),
    );
  });

program.parse();
