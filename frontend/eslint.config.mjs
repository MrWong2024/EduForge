import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import next from "@next/eslint-plugin-next";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import react from "@eslint-react/eslint-plugin";
import importX from "eslint-plugin-import-x";
import jsxA11y from "eslint-plugin-jsx-a11y-x";
import globals from "globals";

const sourceFiles = ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"];
const typescriptFiles = ["**/*.{ts,tsx,mts,cts}"];

const eslintConfig = defineConfig([
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
  {
    files: sourceFiles,
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    files: ["**/*.{js,jsx,ts,tsx,mts,cts}"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: typescriptFiles,
    // Apply TS core-rule replacements after the JavaScript baseline.
    extends: [tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
    },
  },
  {
    files: sourceFiles,
    extends: [next.configs["core-web-vitals"], reactHooks.configs.flat.recommended],
    plugins: {
      "@eslint-react": react,
      "import-x": importX,
      "jsx-a11y-x": jsxA11y,
    },
    // Reuse only the published React settings, without its broader presets.
    settings: react.configs.recommended.settings,
    rules: {
      "import-x/no-anonymous-default-export": "warn",
      "jsx-a11y-x/alt-text": ["warn", { elements: ["img"], img: ["Image"] }],
      "jsx-a11y-x/aria-props": "warn",
      "jsx-a11y-x/aria-proptypes": "warn",
      "jsx-a11y-x/aria-unsupported-elements": "warn",
      "jsx-a11y-x/role-has-required-aria-props": "warn",
      "jsx-a11y-x/role-supports-aria-props": "warn",
      "@eslint-react/no-missing-key": "error",
      "@eslint-react/jsx-no-comment-textnodes": "error",
      "@eslint-react/jsx-no-children-prop": "error",
      "@eslint-react/dom-no-dangerously-set-innerhtml-with-children": "error",
      "@eslint-react/no-direct-mutation-state": "error",
      "@eslint-react/dom-no-find-dom-node": "error",
      "@eslint-react/dom-no-render-return-value": "error",
      "@eslint-react/no-missing-component-display-name": "error",
      "@eslint-react/no-component-will-mount": "error",
      "@eslint-react/no-component-will-receive-props": "error",
      "@eslint-react/no-component-will-update": "error",
      "@eslint-react/dom-no-render": "error",
      "@eslint-react/dom-no-hydrate": "error",
    },
  },
]);

export default eslintConfig;
