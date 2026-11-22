// ESLint flat config (ESLint 9/10 + typescript-eslint v8).
// The IDE's ESLint provider reads this exact file, so `npx eslint .` and the
// on-save lint in the IDE always agree.
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  {
    ignores: ['dist/**', 'coverage/**', 'build/**'],
  },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [js.configs.recommended],
  },
]);
