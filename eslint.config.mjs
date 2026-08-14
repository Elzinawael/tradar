import js from "@eslint/js"
import babelParser from "@babel/eslint-parser"
import nextPlugin from "@next/eslint-plugin-next"
import reactHooks from "eslint-plugin-react-hooks"
import globals from "globals"

/**
 * TRADAR ESLint configuration (ESLint 9 flat config).
 *
 * Why this is hand-composed instead of using `eslint-config-next`:
 *
 * `next lint` was removed in Next.js 16, so linting must be invoked through
 * the ESLint CLI directly. The usual replacement, `eslint-config-next`,
 * depends on `typescript-eslint`, which currently refuses to run against
 * TypeScript 7 (peer range `>=4.8.4 <6.1.0`; the package throws on load).
 * This project pins TypeScript 7.0.2, so that stack cannot be used yet.
 *
 * We therefore compose the same rule sets `eslint-config-next` provides —
 * the official Next.js plugin (recommended + core-web-vitals) and React
 * Hooks — and parse TypeScript/JSX with `@babel/eslint-parser`, which has no
 * TypeScript version constraint.
 *
 * Type-aware linting is not enabled. Type correctness is covered separately
 * by `npm run typecheck` (tsc --noEmit). Once `typescript-eslint` supports
 * TypeScript >= 7.1, this config can be migrated to `eslint-config-next`.
 * Tracking: https://github.com/typescript-eslint/typescript-eslint/issues/10940
 */
export default [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "dist/**",
      "next-env.d.ts",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,jsx,ts,tsx}"],
    languageOptions: {
      parser: babelParser,
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        React: "readonly",
      },
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          babelrc: false,
          configFile: false,
          // Enable the syntax plugins directly. Passing these as `presets`
          // does not reach the parser reliably under @babel/eslint-parser 8.
          parserOpts: {
            plugins: ["typescript", "jsx", "decorators-legacy"],
          },
        },
      },
    },
    plugins: {
      "@next/next": nextPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...reactHooks.configs.recommended.rules,
      // TypeScript's compiler handles undefined-symbol detection far more
      // accurately than ESLint can without type information, and `no-undef`
      // produces false positives on TS type-only identifiers.
      "no-undef": "off",
      // Core `no-unused-vars` cannot see identifiers consumed in JSX or in
      // TypeScript type positions without type information, so it reports
      // false positives on nearly every component and type-only import here
      // (e.g. `Card` in metric-card.tsx, `ClassValue` in lib/utils.ts).
      // Unused-symbol detection is deferred to the TypeScript compiler.
      // Re-enable via typescript-eslint once it supports TypeScript >= 7.1.
      "no-unused-vars": "off",
    },
  },
]
