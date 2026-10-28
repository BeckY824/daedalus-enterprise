import { defineConfig, devices } from "@playwright/test";
import { readdirSync } from "node:fs";
import path from "node:path";
import 桌面端 from "./playwright.desktop.config";
import { CLOUD_URL } from "./e2e-desktop/env";
import { 企业版地址, 企业版库, 企业版目录, 企业版端口 } from "./e2e-layout/企业版";

/**
 * 发版前排版闸门（2026-10-19，e2e-layout/）：和桌面端 e2e 同一套环境（本地模式 + 假云端 + 独立库），只换用例目录。
 * CI 的「排版闸门 1–3/3」跑它（生产构建）；本机：
 *
 *   E2E_PORT=3520 npx playwright test -c playwright.layout.config.ts
 *   LAYOUT_SHARD=2 E2E_PORT=3520 npx playwright test -c playwright.layout.config.ts   # 只跑 CI 第 2 片那几份
 *
 * 起服务前多写一份长选项（e2e-layout/长选项.ts，10-22 排版普查）：设置有进程内缓存，只能在 prepare.ts 建库之后、next 起来之前写。
 *
 * 排版闸门三份（排版闸门-1024 / -1280 / -1366）跑在另起的企业版服务上（10-28，e2e-layout/企业版.ts）：本仓库只出企业版，
 * 闸门量的是企业版左栏那几页（首页、客户、项目、跟进、数据、新线索、联系人、渠道、设置）。其余 spec 照旧在桌面端本地模式上跑。
 * 两份服务同时开着：开发模式是两个 next dev（企业版那个换构建目录 .next-layout-ent），生产模式企业版直接 next start 用桌面端那份刚构建好的产物
 * （webServer 按顺序起，桌面端那份就绪时构建已经完成）。
 *
 * 手机伴侣 /m 那一份在默认套里（e2e/team-qa-mobile.spec.ts，360–430 宽）。检查规则见 e2e/layout-audit.ts
 */
const [云端桩, 本地服务, ...其余] = [桌面端.webServer].flat().filter((x) => x !== undefined);
const 准备 = "npx tsx e2e-desktop/prepare.ts && ";
if (!本地服务?.command.startsWith(准备)) throw new Error("playwright.desktop.config.ts 的本地服务命令变了，长选项种子挂不上，改这里");

/*
  分片按文件指定，不用 --shard（10-28）。playwright 的 --shard 按「用例条数」切、不看耗时：
  排版闸门 9 条每条近 40 秒、我的反馈 18 条每条十来秒，按条数切出来三片是 283 / 174 / 365 秒（main 绿跑实测），
  最慢一片拖住整个 CI。按实测秒数手排（括号里是 10-28 前后几轮绿跑的用例耗时）：
    1：团队页 204 + 时间线订单 18 ≈ 222（商机管道 10-28 随商机页删了）
    2：我的反馈 ~165 + 排版闸门-1366 ~116 ≈ 281
    3：排版闸门-1024 / -1280 各 ~116 + 图片 25 ≈ 257
  （排版闸门 10-28 改到企业版服务上量，页数和原来差不多，秒数等 CI 跑几轮再校）
  每份 spec 自己灌数据（灌真客户 / 切外贸 / 企业版的库每轮重建，都能重复跑），换片不影响结果。
  新加一份 spec 必须排进下面某一片，漏了、写错名字都直接报错，免得在 CI 上悄悄一片都不跑。
*/
const 分片表: Record<string, string[]> = {
  "1": ["团队页.spec.ts", "时间线订单.spec.ts"],
  "2": ["我的反馈.spec.ts", "排版闸门-1366.spec.ts"],
  "3": ["排版闸门-1024.spec.ts", "排版闸门-1280.spec.ts", "图片.spec.ts"],
};
{
  const 实有 = readdirSync(path.resolve(__dirname, "e2e-layout")).filter((f) => f.endsWith(".spec.ts")).sort();
  const 排了 = Object.values(分片表).flat().sort();
  if (排了.length !== new Set(排了).size || 实有.join("|") !== 排了.join("|"))
    throw new Error(`playwright.layout.config.ts 的分片表和 e2e-layout/ 里的 spec 对不上：\n  实有 ${实有.join("、")}\n  排了 ${排了.join("、")}`);
}
const 这一片 = process.env.LAYOUT_SHARD;
if (这一片 && !分片表[这一片]) throw new Error(`LAYOUT_SHARD=${这一片} 不在分片表里（只有 ${Object.keys(分片表).join(" / ")}）`);

// 不设 LAYOUT_SHARD 就全跑。闸门三份归「企业版」项目、其余归桌面端那个项目；这一片里没有的项目、服务就不起
const 本片 = 这一片 ? 分片表[这一片] : Object.values(分片表).flat();
const 是闸门 = (f: string) => /^排版闸门-\d+\.spec\.ts$/.test(f);
const 认 = (fs: string[]) => fs.map((f) => `**/e2e-layout/${f}`);
const 闸门们 = 本片.filter(是闸门);
const 别的们 = 本片.filter((f) => !是闸门(f));
const 生产模式 = process.env.E2E_PROD === "1";

const 企业版服务 = {
  // 先建库灌数据（e2e-layout/企业版.ts）再起；生产模式用桌面端那份服务刚 next build 出来的产物
  command: `npx tsx e2e-layout/企业版.ts && ${生产模式 ? `npx next start --port ${企业版端口}` : `npx next dev --port ${企业版端口}`}`,
  url: `${企业版地址}/login`,
  reuseExistingServer: false,
  timeout: 生产模式 ? 120_000 : 240_000,
  env: {
    DATABASE_URL: `file:${企业版库}`,
    ...(生产模式
      ? { NODE_ENV: "production" }
      : { NEXT_DIST_DIR: ".next-layout-ent", NEXT_TSCONFIG_PATH: path.relative(__dirname, path.join(企业版目录, "tsconfig.json")) }),
    CRM_ENTERPRISE: "1",
    AUTH_SECRET: "e2e-layout-ent-secret-not-used-in-production-0123",
    COOKIE_SECURE: "false",
    TZ: "Asia/Shanghai",
    // 右边 AI 栏要有模型才画（「AI栏常驻」那组要量它）；指向假云端的网关，闸门不真问 AI。本机 .env 里的 Key 一律盖掉
    LLM_API_KEY: "e2e-layout-ent-not-a-real-key",
    LLM_BASE_URL: `${CLOUD_URL}/api/gateway/v1`,
    LLM_MODEL: "e2e-model",
    JEV_API_KEY: "",
    CRM_RESEARCH_CHANNEL: "mock",
  },
};

const [桌面端项目] = 桌面端.projects ?? [];
export default defineConfig({
  ...桌面端,
  testDir: "./e2e-layout",
  timeout: 10 * 60_000,
  projects: [
    ...(别的们.length ? [{ ...桌面端项目, testMatch: 认(别的们) }] : []),
    // 企业版是网页（客户自己服务器上），UA 不带 Electron/
    ...(闸门们.length
      ? [{ name: "企业版", testMatch: 认(闸门们), use: { ...devices["Desktop Chrome"], baseURL: 企业版地址, viewport: { width: 1440, height: 900 } } }]
      : []),
  ],
  webServer: [
    云端桩,
    { ...本地服务, command: `${准备}npx tsx e2e-layout/长选项.ts && ${本地服务.command.slice(准备.length)}` },
    ...其余,
    ...(闸门们.length ? [企业版服务] : []),
  ],
});
