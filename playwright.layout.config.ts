import { defineConfig } from "@playwright/test";
import { readdirSync } from "node:fs";
import path from "node:path";
import 桌面端 from "./playwright.desktop.config";

/**
 * 发版前排版闸门（2026-10-19，e2e-layout/）：和桌面端 e2e 同一套环境（本地模式 + 假云端 + 独立库），只换用例目录。
 * CI 的「排版闸门 1–3/3」跑它（生产构建）；本机：
 *
 *   E2E_PORT=3520 npx playwright test -c playwright.layout.config.ts
 *   LAYOUT_SHARD=2 E2E_PORT=3520 npx playwright test -c playwright.layout.config.ts   # 只跑 CI 第 2 片那几份
 *
 * 起服务前多写一份长选项（e2e-layout/长选项.ts，10-22 排版普查）：设置有进程内缓存，只能在 prepare.ts 建库之后、next 起来之前写。
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
    1：团队页 204 + 商机管道 54 + 时间线订单 18 ≈ 276
    2：我的反馈 ~165 + 排版闸门-1366 ~116 ≈ 281
    3：排版闸门-1024 / -1280 各 ~116 + 图片 25 ≈ 257
  每份 spec 自己灌数据（灌真客户 / 灌长商机 / 切外贸都能重复跑），换片不影响结果。
  新加一份 spec 必须排进下面某一片，漏了、写错名字都直接报错，免得在 CI 上悄悄一片都不跑。
*/
const 分片表: Record<string, string[]> = {
  "1": ["团队页.spec.ts", "商机管道.spec.ts", "时间线订单.spec.ts"],
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

export default defineConfig({
  ...桌面端,
  testDir: "./e2e-layout",
  // 不设 LAYOUT_SHARD 就全跑
  ...(这一片 ? { testMatch: 分片表[这一片].map((f) => `**/e2e-layout/${f}`) } : {}),
  timeout: 10 * 60_000,
  webServer: [云端桩, { ...本地服务, command: `${准备}npx tsx e2e-layout/长选项.ts && ${本地服务.command.slice(准备.length)}` }, ...其余],
});
