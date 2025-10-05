import neostandard, { resolveIgnoresFromGitignore } from 'neostandard'
import { defineConfig } from 'eslint/config'
import markdown from '@eslint/markdown'

export default defineConfig([
  ...neostandard({
    filesTs: ['src/**/*'],
    ignores: resolveIgnoresFromGitignore(),
    ts: true
  }),
  {
    rules: {
      '@stylistic/comma-dangle': ['error', 'never']
    }
  },
  ...markdown.configs.recommended,
  ...markdown.configs.processor
])
