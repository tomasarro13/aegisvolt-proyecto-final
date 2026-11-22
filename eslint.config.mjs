import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'frontend/**', '**/*.d.ts', 'infra/**', 'observability/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Regla de Clean Architecture: el dominio no puede depender de infraestructura ni de frameworks.
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['**/test/**/*.ts', 'tests/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['services/*/src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['**/infrastructure/**', '**/interfaces/**', '**/application/**'], message: 'El dominio no depende de capas externas (Dependency Rule).' },
          { group: ['@aws-sdk/*', 'express', 'graphql*'], message: 'El dominio no depende de frameworks ni SDKs.' },
        ],
      }],
    },
  },
  {
    files: ['services/*/src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['**/infrastructure/**', '**/interfaces/**'], message: 'La capa de aplicación solo conoce puertos (DIP).' },
          { group: ['@aws-sdk/*', 'express', 'graphql-yoga'], message: 'Los casos de uso no dependen de frameworks.' },
        ],
      }],
    },
  },
);
