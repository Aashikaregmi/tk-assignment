// @ts-check
import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist/', 'coverage/', '**/*.js', '**/*.mjs', '**/*.cjs'] },
  eslint.configs.recommended,
  // Type-aware rules catch floating promises and unsafe `any` flows, which matter in async worker code.
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  // Formatting belongs to Prettier.
  prettier,
);
