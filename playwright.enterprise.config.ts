import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

/**
 * 企业版主流程（2026-10-27）：主套在 CRM_ENTERPRISE=1 下重跑的是桌面端 / 团队版攒下的回归，
 * 这一套补的是只有企业版才有的那些——四类账号、导入导出权限、跳转、组织设置、公海整体转让。
 *
 *   npm run test:ent
 *
 * 库、端口都是自己的（prisma/e2e-ent、3130）。企业版服务器一启动就连库，所以和主配置一样
 * 由 webServer 命令先建库再起服务，不走 globalSetup（原因见 e2e/global-setup.ts 文件头）。
 * Next 16 的 next dev 在同一个目录里只许起一个（.next/dev/lock），别的套件正开着 dev 时每 10 秒重试一次。
 */
const PORT = Number(process.env.E2E_ENT_PORT) || 3130;
const DB = path.resolve(__dirname, "prisma/e2e-ent/e2e-ent.db");

export default defineConfig({
  testDir: "./e2e-ent",
  // 用例共用一个库、公海那条会改归属，串行
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    // 用 localhost 不用 127.0.0.1，原因见 playwright.config.ts
    baseURL: `http://localhost:${PORT}`,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx tsx e2e-ent/global-setup.ts && for i in $(seq 1 90); do npx next dev --port ${PORT} && exit 0; echo "[ent] next dev 起不来（多半是别的套件占着 .next/dev/lock），10 秒后重试 $i"; sleep 10; done; exit 1`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 20 * 60_000,
    env: {
      DATABASE_URL: `file:${DB}`,
      AUTH_SECRET: "e2e-only-secret-not-used-in-production-0123456789",
      COOKIE_SECURE: "false",
      TZ: "Asia/Shanghai",
      LLM_API_KEY: "",
      JEV_API_KEY: "",
      CRM_RESEARCH_CHANNEL: "mock",
      CRM_ENTERPRISE: "1",
    },
  },
});
