import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/index.ts',
        'src/bin/**', // CLI entry point - tested via integration
        'src/adapters/fs/node-fs.ts', // Real FS adapter - tested via integration
        'src/mcp/transport.ts', // MCP stdio transport - tested via integration
        'src/mcp/http-server.ts', // HTTP server - tested via integration
        'src/mcp/http-transport.ts', // HTTP transport - tested via integration
      ],
      thresholds: {
        lines: 65,
        branches: 60,
        functions: 85,
        statements: 65,
      },
    },
  },
});
