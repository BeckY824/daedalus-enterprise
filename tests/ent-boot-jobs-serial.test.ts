/**
 * 服务启动时几件只做一次的老数据活排着跑（src/instrumentation.ts）。
 *
 *   SQLite 只有一个写锁：老商机清理占着锁时，同时开的转项目等不到锁就失败、要等下次重启，别的写也全超时（10-29 3 倍数据压测）
 *   这里只看先后：清理做完才开转项目，转项目做完才开回填，回填做完才开客户级别 D 改 C；前一件抛错不挡后一件
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/lib/enterprise/customer-v2-db", () => ({ 级别D改C一次: 慢活("级别") }));
vi.mock("@/lib/enterprise-import/sync", () => ({ 启动定时: () => {} }));
vi.mock("@/lib/project/nightly", () => ({ 启动夜扫: () => {} }));

import { register } from "@/instrumentation";

const 等做完 = () => vi.waitFor(() => expect(记.序).toContain("级别完"), { timeout: 2000 });

describe("启动时的老数据活", () => {
  const 原 = { ...process.env };
  beforeEach(() => {
    记.序 = [];
    记.清理抛错 = false;
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.CRM_ENTERPRISE = "1";
  });
  afterEach(() => {
    process.env = { ...原 };
  });

  it("一件做完再开下一件", async () => {
    await register();
    await 等做完();
    expect(记.序).toEqual(["清理开", "清理完", "转项目开", "转项目完", "回填开", "回填完", "级别开", "级别完"]);
  });

  it("清理出错照样往下做", async () => {
    记.清理抛错 = true;
    await register();
    await 等做完();
    expect(记.序).toEqual(["清理开", "清理完", "转项目开", "转项目完", "回填开", "回填完", "级别开", "级别完"]);
  });

  it("不是企业版一件都不做", async () => {
    process.env.CRM_ENTERPRISE = "";
    await register();
    await new Promise((r) => setTimeout(r, 80));
    expect(记.序).toEqual([]);
  });
});
