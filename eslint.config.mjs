import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript rules
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",
    
    // React rules
    "react-hooks/exhaustive-deps": "off",
    "react-hooks/purity": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",
    
    // Next.js rules
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",
    
    // General JavaScript rules
    "prefer-const": "off",
    "no-unused-vars": "off",
    "no-console": "off",
    "no-debugger": "off",
    "no-empty": "off",
    "no-irregular-whitespace": "off",
    "no-case-declarations": "off",
    "no-fallthrough": "off",
    "no-mixed-spaces-and-tabs": "off",
    "no-redeclare": "off",
    "no-undef": "off",
    "no-unreachable": "off",
    "no-useless-escape": "off",
  },
}, {
  // ===== ImagineOS 架构边界守卫（ADR-0002）=====
  files: ["src/app/**/*.ts", "src/app/**/*.tsx", "src/components/**/*.tsx"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [{
        group: ["@/lib/db", "@prisma/*", "prisma/*"],
        message: "架构边界违规：UI/API 层禁止直触数据库（ADR-0002）。请调用 src/core 的领域服务。"
      }]
    }]
  },
}, {
  files: ["src/core/**/*.ts"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [{
        group: ["z-ai-web-dev-sdk", "@/ai/*", "@/media/*"],
        message: "架构边界违规：领域层（core）禁止绑定任何模型 SDK 或实现层（§87 自有资产原则）。AI 能力一律经 src/ai 的 Model Router 接口引入。"
      }]
    }]
  },
}, {
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills", "tests/**", "prisma/seed.ts"]
}];

export default eslintConfig;
