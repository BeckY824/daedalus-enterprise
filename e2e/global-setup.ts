/**
 * E2E 跑之前把测试库建好并写入账号。
 * 每轮从空库开始，用例之间的数据依赖才是可预期的。
 *
 * 企业版（CRM_ENTERPRISE=1）服务器一启动就连库（instrumentation 里的回填、定时），而 Playwright 先起 webServer
 * 再跑 globalSetup：这时再删库重建，服务器手里那条连接指着已删的旧文件，整片登录失败。
 * 所以企业版改由 webServer 命令在起服务前先跑本文件（npx tsx e2e/global-setup.ts），globalSetup 那一步跳过。
 */
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const E2E_DB = path.resolve(ROOT, "prisma/e2e.db");

export function 建测试库() {
  for (const f of [E2E_DB, `${E2E_DB}-wal`, `${E2E_DB}-shm`]) rmSync(f, { force: true });
  writeFileSync(E2E_DB, "");

  // 企业版开关开着跑这套时（CRM_ENTERPRISE=1），seed 只会建 admin；用例要登张三、李四，测试账号照建。
  // 只影响造账号这一步，服务器那边照样开着企业版
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: `file:${E2E_DB}` };
  delete env.CRM_ENTERPRISE;
  execFileSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
    cwd: ROOT, env, stdio: "pipe",
  });
  // 只建账号，不写业务数据——业务数据由用例自己按链条造，才测得出流程
  execFileSync("npx", ["tsx", "prisma/seed.ts"], { cwd: ROOT, env, stdio: "pipe" });
}

export default function globalSetup() {
  if (process.env.CRM_ENTERPRISE === "1") return; // webServer 命令里已经建过，见文件头
  建测试库();
}

if (require.main === module) 建测试库();
