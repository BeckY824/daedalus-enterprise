/**
 * 代码检查 crm/no-build-time-env（11-17 复盘第 2 类）：运行期代码不读 Next 构建期替换的环境变量，
 * 浏览器组件只读 NEXT_PUBLIC_ 开头的。#333 就是读了 NEXT_DEPLOYMENT_ID，生产构建里被换成 false，整站 500。
 */
import { describe, it, expect } from "vitest";
import { RuleTester, ESLint } from "eslint";
import path from "node:path";
import 规则, { 构建期变量 } from "../eslint-rules/no-build-time-env.mjs";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: "module" } });
const 构建期 = { messageId: "构建期" };
const 浏览器 = { messageId: "浏览器" };

tester.run("crm/no-build-time-env", 规则, {
  valid: [
    "const a = process.env.NODE_ENV === 'production';",
    "const a = process.env.DATABASE_URL;",
    "const a = process.env.CRM_DEPLOYMENT_ID?.trim();",
    "const { DATABASE_URL, NODE_ENV } = process.env;",
    "const a = process.env[name];",
    "const a = env.NEXT_RUNTIME;",
    '"use client";\nconst a = process.env.NEXT_PUBLIC_SITE + process.env.NODE_ENV;',
    { code: "if (process.env.NEXT_RUNTIME !== 'nodejs') {}", options: [{ allow: ["NEXT_RUNTIME"] }] },
    { code: '"use client";\nconst a = process.env.NEXT_PHASE;', options: [{ allow: ["NEXT_PHASE"] }] },
  ],
  invalid: [
    ...构建期变量.map((名) => ({ code: `const a = process.env.${名};`, errors: [构建期] })),
    { code: "const a = process.env.__NEXT_ROUTER_BASEPATH;", errors: [构建期] },
    { code: "const a = process.env['NEXT_DEPLOYMENT_ID'];", errors: [构建期] },
    { code: "const a = process['env'].TURBOPACK;", errors: [构建期] },
    { code: "const { NEXT_RUNTIME, DATABASE_URL } = process.env;", errors: [构建期] },
    { code: "const a = process.env.NEXT_DEPLOYMENT_ID;", options: [{ allow: ["NEXT_RUNTIME"] }], errors: [构建期] },
    { code: '"use client";\nconst a = process.env.DATABASE_URL;', errors: [浏览器] },
    { code: '"use client";\nconst a = process.env[k];', errors: [浏览器] },
    { code: '"use client";\nconst { NEXT_PUBLIC_A, SECRET } = process.env;', errors: [浏览器] },
  ],
});

describe("eslint.config.mjs 真的把规则挂在 src 上", () => {
  const eslint = new ESLint({ cwd: path.resolve(__dirname, "..") });
  const 档 = async (f: string) => (await eslint.calculateConfigForFile(f)).rules?.["crm/no-build-time-env"];

  it("src 下的服务端、浏览器文件都开着、是 error", async () => {
    for (const f of ["src/lib/prisma.ts", "src/components/AntdRegistry.tsx", "src/app/layout.tsx"]) {
      const r = await 档(f);
      expect(r?.[0], f).toBe(2);
    }
  });

  it("白名单只有 instrumentation.ts 的 NEXT_RUNTIME 和 AntdRegistry.tsx 的 NEXT_PHASE", async () => {
    expect((await 档("src/instrumentation.ts"))?.[1]).toEqual({ allow: ["NEXT_RUNTIME"] });
    expect((await 档("src/components/AntdRegistry.tsx"))?.[1]).toEqual({ allow: ["NEXT_PHASE"] });
    expect((await 档("src/lib/prisma.ts"))?.[1]).toBeUndefined();
  });
});
