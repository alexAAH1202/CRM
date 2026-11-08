import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const FIRESTORE_PRIMITIVES = [
  'getDoc',
  'getDocs',
  'onSnapshot',
  'setDoc',
  'updateDoc',
  'deleteDoc',
  'addDoc',
  'writeBatch',
  'runTransaction',
  'getDocFromServer',
  'getDocsFromServer',
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'firebase/public/**',
      '**/coverage/**',
      'firebase/emulator-data/**',
      'apps-script/scripts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // `any` needs an explicit, commented eslint-disable (spec section 11).
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // All Firestore reads/writes go through web/src/lib/firestore so the usage meter sees them.
    files: ['web/src/**/*.{ts,tsx}'],
    ignores: ['web/src/lib/firestore/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'firebase/firestore',
              importNames: FIRESTORE_PRIMITIVES,
              message: 'Use the metered helpers in web/src/lib/firestore instead.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['firebase/**/*.ts', '*.config.{js,ts}', '**/vite.config.ts', '**/vitest.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps-script/src/**/*.ts'],
    rules: {
      // Apps Script entry points are global functions invoked by the runtime.
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
