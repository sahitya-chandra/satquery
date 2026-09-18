import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      "@next/next/no-img-element": "off"
    }
  },
  {
    ignores: [".next/**", "node_modules/**", "out/**", "next-env.d.ts"]
  }
];

export default eslintConfig;
