import nextVitals from "eslint-config-next/core-web-vitals";

export default [
  { ignores: ["eslint.config.mjs", ".next/**", "node_modules/**"] },
  ...nextVitals,
];
