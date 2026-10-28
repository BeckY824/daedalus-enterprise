import { defineConfig, devices } from "@playwright/test";
import { readdirSync } from "node:fs";
import path from "node:path";
import { 企业版地址, 企业版库, 企业版目录, 企业版端口 } from "./e2e-layout/企业版";

/**
 * 发版前排版闸门（2026-10-19，e2e-layout/）：起一份企业版服务（CRM_ENTERPRISE=1，独立库，e2e-layout/企业版.ts 建库灌数据），
 * 在 1024 / 1280 / 1366 三个宽度量企业版左栏那几页（首页、客户、项目、跟进、数据、新线索、联系人、渠道、设置）。
 * 本仓库只出企业版，10-28 起和桌面端那一套（本地模式 + 假云端）彻底脱钩。CI 的「排版闸门 1–3/3」跑它（生产构建）；本机：
 *
 *   E2E_PORT=3520 npx playwright test -c playwright.layout.config.ts
 *   LAYOUT_SHARD=2 E2E_PORT=3520 npx playwright test -c playwright.layout.config.ts   # 只跑 CI 第 2 片
 *   E2E_PROD=1 LAYOUT_SHARD=1 npx playwright test -c playwright.layout.config.ts       # 同 CI：先 next build 再 next start
 *
 * 手机伴侣 /m 那一份在默认套里（e2e/team-qa-mobile.spec.ts，360–430 宽）。检查规则见 e2e/layout-audit.ts
 */

/*
  分片按文件指定，不用 --shard（10-28）：--shard 按「用例条数」切、不看耗时，排版闸门一条近 40 秒。
  三份闸门一片一份，耗时差不多（每份约 2 分钟，见 PR 里的实测）。
  新加一份 spec 必须排进下面某一片，漏了、写错名字都直接报错，免得在 CI 上悄悄一片都不跑。
*/
const 分片表: Record<string, string[]> = {
  "1": ["排版闸门-1024.spec.ts"],
  "2": ["排版闸门-1280.spec.ts"],
  "3": ["排版闸门-1366.spec.ts"],
};
{
  const 实有 = readdirSync(path.resolve(__dirname, "e2e-layout")).filter((f) => f.endsWith(".spec.ts")).sort();
  const 排了 = Object.values(分片表).flat().sort();
  if (排了.length !== new Set(排了).size || 实有.join("|") !== 排了.join("|"))
    throw new Error(`playwright.layout.config.ts 的分片表和 e2e-layout/ 里的 spec 对不上：\n  实有 ${实有.join("、")}\n  排了 ${排了.join("、")}`);
}
const 这一片 = process.env.LAYOUT_SHARD;
if (这一片 && !分片表[这一片]) throw new Error(`LAYOUT_SHARD=${这一片} 不在分片表里（只有 ${Object.keys(分片表).join(" / ")}）`);

// 不设 LAYOUT_SHARD 就全跑
const 本片 = 这一片 ? 分片表[这一片] : Object.values(分片表).flat();
const 生产模式 = process.env.E2E_PROD === "1";

export default defineConfig({
  testDir: "./e2e-layout",
  // 三份闸门共用一个企业版库，串行跑
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 10 * 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    // 必须 localhost：用 127.0.0.1 访问 Next 16 dev 会拦掉 JS chunk、页面不水合
    baseURL: 企业版地址,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // 企业版是网页（客户自己服务器上），UA 不带 Electron/
    {
      name: "企业版",
      testMatch: 本片.map((f) => `**/e2e-layout/${f}`),
      use: { ...devices["Desktop Chrome"], baseURL: 企业版地址, viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: [
    {
      // 先建库灌数据（e2e-layout/企业版.ts，企业版服务器一启动就连库）再起；生产模式自己 next build，CI 上要几分钟
      command: `npx tsx e2e-layout/企业版.ts && ${生产模式 ? `npx next build && npx next start --port ${企业版端口}` : `npx next dev --port ${企业版端口}`}`,
      url: `${企业版地址}/login`,
      reuseExistingServer: false,
      timeout: 生产模式 ? 420_000 : 240_000,
      env: {
        DATABASE_URL: `file:${企业版库}`,
        // 开发模式换构建目录、tsconfig，免得和同一工作树里自己开着的 next dev 抢 .next/dev/lock（见 next.config.ts 的 distDir 那段）
        ...(生产模式
          ? { NODE_ENV: "production" }
          : { NEXT_DIST_DIR: ".next-layout-ent", NEXT_TSCONFIG_PATH: path.relative(__dirname, path.join(企业版目录, "tsconfig.json")) }),
        CRM_ENTERPRISE: "1",
        AUTH_SECRET: "e2e-layout-ent-secret-not-used-in-production-0123",
        // http://localhost 下必须关，否则会话 cookie 被浏览器丢掉
        COOKIE_SECURE: "false",
        // 服务端和浏览器（use.timezoneId）同一个时区，「今天」「逾期」两边对得上
        TZ: "Asia/Shanghai",
        /*
          右边 AI 栏要有模型才画（「AI栏常驻」那组要量它）：只看 LLM_API_KEY 设没设（lib/llm-config.ts）。
          没有 CLOUD_ACCOUNT 时模型来源是 env，画页面不问网关、不查余额；闸门也不真问 AI。
          地址指向一个没人听的端口，万一哪天渲染路径真去问了，也只会失败、不会打到真的模型。本机 .env 里的 Key 一律盖掉
        */
        LLM_API_KEY: "e2e-layout-ent-not-a-real-key",
        LLM_BASE_URL: "http://127.0.0.1:9/v1",
        LLM_MODEL: "e2e-model",
        JEV_API_KEY: "",
        CRM_RESEARCH_CHANNEL: "mock",
      },
    },
  ],
});
