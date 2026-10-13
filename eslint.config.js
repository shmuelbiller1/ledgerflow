
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactPlugin from 'eslint-plugin-react';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'dist/**', 'public/**', 'work/**'] },
  {
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      jsxA11y.flatConfigs.recommended,
    ],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'react': reactPlugin,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react/no-array-index-key': 'warn',
      'react/jsx-no-target-blank': 'warn',
      'max-lines': ['warn', { max: 800, skipBlankLines: true, skipComments: true }],
      'jsx-a11y/no-autofocus': 'warn',
      'jsx-a11y/label-has-associated-control': 'warn',
      'jsx-a11y/click-events-have-key-events': 'warn',
      'jsx-a11y/no-static-element-interactions': 'warn',
      'jsx-a11y/no-noninteractive-element-interactions': 'warn',
      // a region that scrolls sideways (a wide table) must take keyboard focus to be scrolled:
      // role="region" + aria-label + tabIndex={0} is the accessible pattern (axe scrollable-region-focusable)
      'jsx-a11y/no-noninteractive-tabindex': ['error', { tags: [], roles: ['tabpanel', 'region'], allowExpressionValues: true }],
      // depth: text inside a cell's wrapper divs counts; table cells and datalist options are not controls
      'jsx-a11y/control-has-associated-label': ['warn', { depth: 4, ignoreElements: ['audio', 'canvas', 'embed', 'input', 'textarea', 'tr', 'td', 'option', 'video'] }],
    },
  },
  {
    files: ['src/server/**/*.{ts,tsx}', 'server.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.name="fetch"]',
          message: 'Raw fetch is forbidden on the server. Use safeFetch from src/server/utils/safeFetch.ts to prevent SSRF vulnerabilities.',
        }
      ]
    }
  }
);
