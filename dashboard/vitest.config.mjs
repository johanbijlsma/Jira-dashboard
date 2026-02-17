import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react({
      include: [/pages\/.*\.js$/, /\.[jt]sx?$/],
    }),
  ],
  esbuild: {
    loader: "jsx",
    include: /pages\/.*\.js$/,
  },
  test: {
    environment: "jsdom",
    setupFiles: "./vitest.setup.js",
    include: ["**/*.test.{js,jsx}"],
  },
});
