/**
 * 服务启动时几件只做一次的老数据活排着跑（src/instrumentation.ts）。
 *
 *   SQLite 只有一个写锁：老商机清理占着锁时，同时开的转项目等不到锁就失败、要等下次重启，别的写也全超时（10-29 3 倍数据压测）
 *   这里只看先后：清理做完才开转项目，转项目做完才开回填，回填做完才开客户级别 D 改 C，再补联系人挂靠；前一件抛错不挡后一件
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const 记 = vi.hoisted(() => ({ 序: [] as string[], 清理抛错: false }));
const 慢活 = (名: string, 抛?: () => boolean) => async () => {
  记.序.push(`${名}开`);
  await new Promise((r) => setTimeout(r, 20));
  记.序.push(`${名}完`);
  if (抛?.()) throw new Error(`${名}出错`);
  return null;
};
vi.mock("@/lib/enterprise/legacy-cleanup", () => ({ 清理一次: 慢活("清理", () => 记.清理抛错) }));
vi.mock("@/lib/enterprise/lead-to-project", () => ({ 转项目一次: 慢活("转项目") }));
vi.mock("@/lib/project/expected-deal", () => ({ 回填一次: 慢活("回填") }));
vi.mock("@/lib/enterprise/customer-v2-db", () => ({ 级别D改C一次: 慢活("级别"), 联系人挂靠回填一次: 慢活("挂靠") }));
vi.mock("@/lib/enterprise-import/sync", () => ({ 启动定时: () => {} }));
vi.mock("@/lib/project/nightly", () => ({ 启动夜扫: () => {} }));

import { register } from "@/instrumentation";
import { 重置后台任务状态 } from "@/lib/jobs";
import { 开子进程占锁 } from "./proc-lock-child";

const 等做完 = () => vi.waitFor(() => expect(记.序).toContain("挂靠完"), { timeout: 2000 });

describe("启动时的老数据活", () => {
  const 原 = { ...process.env };
  beforeEach(() => {
    记.序 = [];
    记.清理抛错 = false;
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.CRM_ENTERPRISE = "1";
    process.env.CRM_LOCK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "crm-boot-jobs-"));
    重置后台任务状态();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    fs.rmSync(process.env.CRM_LOCK_DIR!, { recursive: true, force: true });
    process.env = { ...原 };
    重置后台任务状态();
    vi.restoreAllMocks();
  });

  it("一件做完再开下一件", async () => {
    await register();
    await 等做完();
    expect(记.序).toEqual(["清理开", "清理完", "转项目开", "转项目完", "回填开", "回填完", "级别开", "级别完", "挂靠开", "挂靠完"]);
  });

  it("清理出错照样往下做", async () => {
    记.清理抛错 = true;
    await register();
    await 等做完();
    expect(记.序).toEqual(["清理开", "清理完", "转项目开", "转项目完", "回填开", "回填完", "级别开", "级别完", "挂靠开", "挂靠完"]);
  });

  it("多进程（11-16）：CRM_JOBS=0 的进程一件都不做", async () => {
    process.env.CRM_JOBS = "0";
    process.env.CRM_INSTANCE = "2";
    await register();
    await new Promise((r) => setTimeout(r, 80));
    expect(记.序).toEqual([]);
  });

  it("多进程（11-16）：CRM_JOBS=1 但另一个进程已经占着后台任务，本进程一件都不做", async () => {
    process.env.CRM_JOBS = "1";
    const 别处 = await 开子进程占锁(process.env.CRM_LOCK_DIR!, "jobs", "1 号进程");
    try {
      expect(别处.结果).toBe("OK");
      await register();
      await new Promise((r) => setTimeout(r, 80));
      expect(记.序).toEqual([]);
    } finally {
      await 别处.放();
    }
  });

  it("不是企业版一件都不做", async () => {
    process.env.CRM_ENTERPRISE = "";
    await register();
    await new Promise((r) => setTimeout(r, 80));
    expect(记.序).toEqual([]);
  });
});
