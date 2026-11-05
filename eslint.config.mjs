// Run with `make lint`. Kept import-free so it works via npx without a package.json.
// Errors are likely bugs; warnings are cleanup.
const rules = {
    'no-undef': 'error',
    'no-unused-vars': ['warn', { vars: 'all', args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    'no-dupe-keys': 'error',
    'no-dupe-class-members': 'error',
    'no-unreachable': 'error',
    'no-const-assign': 'error',
    'no-redeclare': 'error',
    'no-self-assign': 'error',
    'no-unused-expressions': 'warn',
    'use-isnan': 'error',
    'valid-typeof': 'error',
};

const shared = {
    console: 'readonly',
    globalThis: 'readonly',
};

export default [
    {
        files: ['tailscale-status@maxgallup.github.com/**/*.js'],
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'module',
            globals: {
                ...shared,
                log: 'readonly',
                logError: 'readonly',
                print: 'readonly',
                printerr: 'readonly',
                global: 'readonly',
            },
        },
        rules,
    },
    {
        files: ['tests/**/*.js', 'tests/**/*.mjs'],
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'module',
            globals: { ...shared, URL: 'readonly' },
        },
        rules,
    },
];
