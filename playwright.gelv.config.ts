import { defineConfig, devices } from "@playwright/test";
import 闸门 from "./playwright.layout.config";
import { 企业版地址 } from "./e2e-layout/企业版";

/**
 * 「格律」样板的假数据截图（落地计划 1.2 第 1 条；P1，feat/b33-gelv-p1 不合并）：
 * 和排版闸门同一个企业版服务、同一份假数据（webServer 照搬 playwright.layout.config.ts），只换要跑的那两份——e2e-layout/样板截图.gelv.ts（截图）和 层级.gelv.ts（G5 ③ 运行时层级检查）。
 * 不进排版闸门的分片表、不进 CI 必过项；Windows 那一组由 .github/workflows/gelv-shots.yml 手动触发。
 *
 *   E2E_PORT=3520 npx playwright test -c playwright.gelv.config.ts     # 本机开发模式
 *   E2E_PROD=1 npx playwright test -c playwright.gelv.config.ts        # 生产构建（Windows runner 上就这么跑）
 */
export default defineConfig({
  ...闸门,
  retries: 0,
  timeout: 30 * 60_000,
  reporter: [["list"]],
  projects: [
    {
      name: "格律样板",
      testMatch: "**/e2e-layout/*.gelv.ts",
      use: { ...devices["Desktop Chrome"], baseURL: 企业版地址, viewport: { width: 1366, height: 768 } },
    },
  ],
});
