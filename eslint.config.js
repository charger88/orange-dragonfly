import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    plugins: {
    },
    rules: {
      'semi': ['error', 'never'],
      'quotes': ['error', 'single', { avoidEscape: true }],
      'comma-dangle': ['error', 'always-multiline'],
      'space-before-function-paren': ['error', 'never'],
      'indent': ['error', 2, { SwitchCase: 1 }],
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'tests/**', 'jest.config.cjs'],
  },
]
