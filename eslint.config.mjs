import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import stylistic from "@stylistic/eslint-plugin";
import { defineConfig } from "eslint/config";

/** @type {import('eslint').Linter.Config[]} */
export default defineConfig([
  { ignores: ["node_modules/", "dist/", ".wrangler/", "worker-configuration.d.ts"] },
  { languageOptions: { globals: globals.browser } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  stylistic.configs.customize({
    quotes: "double",
    semi: true,
    indent: 2,
  }),
]);
