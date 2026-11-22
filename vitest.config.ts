import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Las pruebas usan el código fuente del paquete compartido (no requieren compilar dist/ antes).
  resolve: {
    alias: { '@aegisvolt/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)) },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['services/*/test/unit/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['services/*/test/integration/**/*.test.ts'],
          environment: 'node',
          testTimeout: 30_000,
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['tests/e2e/**/*.test.ts'],
          environment: 'node',
          testTimeout: 60_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
