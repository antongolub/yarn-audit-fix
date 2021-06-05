module.exports = {
    extends: [
        'eslint-config-qiwi',
        'prettier',
    ],
    overrides: [
        {
            files: ['src/test/ts/runner.ts'],
            rules: {
                'sonarjs/no-duplicate-string': 'off'
            }
        }
    ]
}
