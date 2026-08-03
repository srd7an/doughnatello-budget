import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

/**
 * Deliberately ONE rule, not a style suite.
 *
 * `rules-of-hooks` catches the one mistake in this codebase that cannot be
 * caught by reading it or by the type checker, and that takes the whole app
 * down when it lands: a hook called conditionally. Combining two useMatch
 * calls with `??` short-circuits the second, React counts a different number
 * of hooks on two routes, and the screen goes white on the way between them —
 * which is exactly how it shipped.
 *
 * Formatting is Prettier's job and correctness is TypeScript's. Adding a
 * hundred style rules here would mean a hundred findings to triage and this
 * one buried among them.
 */
export default tseslint.config({
  files: ['src/**/*.{ts,tsx}'],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
  plugins: { 'react-hooks': reactHooks },
  rules: {
    'react-hooks/rules-of-hooks': 'error',
  },
})
