import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)) } },
  test: {
    environment: "node",
    globals: false,
    // Local acceptance checkouts are evidence, not additional test suites.
    exclude: [...configDefaults.exclude, "**/.local/**"],
  },
});
