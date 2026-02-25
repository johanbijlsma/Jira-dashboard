import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react({
      include: [/pages\/.*\.[jt]sx?$/, /\.[jt]sx?$/],
    }),
  ],
  esbuild: {
    loader: "jsx",
    include: /\.[jt]sx?$/,
  },
  test: {
    environment: "jsdom",
    setupFiles: "./vitest.setup.js",
    include: ["**/*.test.{js,jsx}"],
    exclude: ["**/node_modules/**", "**/.next/**", "**/coverage/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/**/*.js", "pages/**/*.jsx"],
      // The dashboard home page is a legacy monolithic composition file.
      // We measure its extracted/testable utilities and focused pages with unit coverage.
      // Chart.js plugin registration heavily depends on canvas/runtime integration.
      exclude: ["pages/index.jsx", "lib/chart-setup.js"],
      thresholds: {
        lines: 80,
        statements: 80,
        branches: 80,
        functions: 80,
      },
    },
  },
});
