import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noBuildTimeEnv from "./eslint-rules/no-build-time-env.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // 另换的 next 构建目录（next.config.ts 的 distDir；排版闸门开发模式用 .next-layout-ent）
    ".next-*/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prisma 生成的客户端代码，不参与 lint
    "src/generated/**",
    // 扫名片的识别运行库：scripts/build-ocr.mjs 从 node_modules 打出来的压缩包，不是我们写的
    "public/ocr/**",
    // 服务器认名片的识别线程：同一个脚本用 esbuild 打出来的（SDK + OpenCV + onnxruntime 一个文件）
    "ocr-server/**",
  ]),
  {
    rules: {
      // 下划线开头 = 故意不用（占位参数、从对象里剥掉一个字段）；剥字段剩下的那部分也不算没用
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
    },
  },
  // 运行期代码不读 Next 构建期替换的环境变量；浏览器组件只读 NEXT_PUBLIC_ 开头的（11-17 复盘第 2 类，规则说明见 eslint-rules/no-build-time-env.mjs）
  {
    files: ["src/**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    plugins: { crm: { rules: { "no-build-time-env": noBuildTimeEnv } } },
    rules: { "crm/no-build-time-env": "error" },
  },
  // 白名单：每条写理由
  {
    // Next 文档的标准写法：register() 在 nodejs 和 edge 两种运行时各调一次，按构建时烤进去的 NEXT_RUNTIME 区分，
    // 要的就是构建期的值（edge 包里是 "edge"、node 包里是 "nodejs"）
    files: ["src/instrumentation.ts"],
    rules: { "crm/no-build-time-env": ["error", { allow: ["NEXT_RUNTIME"] }] },
  },
  {
    // 浏览器组件，但 抽一批 只在服务端渲染时调（next build 静态预渲染时进程里有 NEXT_PHASE）；
    // 浏览器里读到 undefined 正好落在默认分支（非构建期），这就是要的行为
    files: ["src/components/AntdRegistry.tsx"],
    rules: { "crm/no-build-time-env": ["error", { allow: ["NEXT_PHASE"] }] },
  },
]);

export default eslintConfig;
