module.exports = {
    extends: [
        'eslint-config-qiwi',
        'prettier',
    ],
    overrides: [
        {
            files: ['src/test/ts/runner.ts', 'src/main/ts/stages.ts'],
            rules: {
                'sonarjs/no-duplicate-string': 'off',
                '@typescript-eslint/ban-ts-comment': 'off'
            }
        },
        {
            files: ['src/**/*.ts'],
            rules: {
                'camelcase': 'off'
            }
        }
    ]
}
