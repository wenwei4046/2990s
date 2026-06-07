// Flat ESLint config for the 2990s monorepo.
//
// 2990s had no linting at all. This config is deliberately *low-noise*: rules
// that catch real bugs are errors; stylistic / pervasive-pattern rules that
// would flag thousands of existing lines (explicit `any`, non-null `!`, etc.)
// are off or warn, so `pnpm lint` surfaces signal, not a wall of churn.
//
// Run: `pnpm lint`  (or `pnpm lint:fix`). Not yet wired into the pre-push hook —
// husky stays typecheck-only until the existing warnings are burned down.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.wrangler/**',
      '**/.turbo/**',
      '**/build/**',
      '**/coverage/**',
      '**/*.config.{js,cjs,mjs,ts}',
      '**/migrations*/**',
      '**/*.snap',
    ],
  },
  {
    // The codebase carries many eslint-disable comments from a prior (removed)
    // eslint setup; under this lighter ruleset most are now "unused". Don't flag
    // them — they become relevant again if rules are re-enabled later.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Applies to every linted file: browser + node globals, and TS owns
    // undefined-identifier detection (so `no-undef` would only false-positive on
    // Workers/DOM/Node globals). `no-useless-assignment` is a minor smell → warn.
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      'no-undef': 'off',
      'no-useless-assignment': 'warn',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // ── Real bugs → error ────────────────────────────────────────────
      'react-hooks/rules-of-hooks': 'error', // conditional/looped hooks = crashes
      // Intentional special chars (e.g. a BOM in a CSV-strip regex) are allowed
      // inside regex/template/string literals; only stray ones in code are errors.
      'no-irregular-whitespace': ['error', { skipRegExps: true, skipTemplates: true, skipStrings: true }],
      'no-cond-assign': ['error', 'always'],
      'no-dupe-keys': 'error',
      'no-dupe-else-if': 'error',
      'no-unsafe-negation': 'error',
      'no-unreachable': 'error',
      'no-constant-binary-expression': 'error',
      'for-direction': 'error',
      'use-isnan': 'error',

      // ── Stale-closure footgun → warn (some intentional eslint-disable exists)
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],

      // ── Pervasive in this codebase / handled by TS → off (avoid wall of noise)
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      'no-undef': 'off', // TypeScript resolves identifiers; avoids false positives on Workers/DOM globals
    },
  },
);
