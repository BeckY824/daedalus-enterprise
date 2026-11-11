/**
 * 反馈未读、排序、截字的纯规则（lib/feedback-unread.ts，左栏反馈键和回复提示在用）；控制库里反馈那张表的迁移文件在。
 * 原来和云端「我的反馈」接口、运营台回复一起钉在 tests/feedback-thread.test.ts，那两处 12c 删了，纯规则挪到这里。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 根 = path.resolve(__dirname, "..");

describe("纯规则", () => {
  const 回 = (id: string, at: string) => ({ id, at, 谁: "团队" as const, body: `回复${id}` });
  const 我 = (id: string, at: string) => ({ id, at, 谁: "我" as const, body: "我说" });

  it("未读：我们最后回的那条不是本机看过的那条；最后一句是自己的不算", async () => {
    const { 算未读 } = await import("@/lib/feedback-unread");
    const f = { id: "f", at: "2026-10-01", body: "x", 消息: [回("a", "2026-10-02"), 回("b", "2026-10-03")] };
    expect(算未读({ ...f, 消息: [] }, {})).toBe(false);
    expect(算未读(f, {})).toBe(true);
    expect(算未读(f, { f: "a" })).toBe(true);
    expect(算未读(f, { f: "b" })).toBe(false);
    expect(算未读({ ...f, 消息: [...f.消息, 我("c", "2026-10-04")] }, {})).toBe(false);
  });

  it("列表按最近一次往来排：老反馈刚回了一句就顶上来", async () => {
    const { 排好 } = await import("@/lib/feedback-unread");
    const 老 = { id: "old", at: "2026-10-01T00:00:00Z", body: "老", 消息: [回("r", "2026-10-19T00:00:00Z")], 未读: true };
    const 新 = { id: "new", at: "2026-10-10T00:00:00Z", body: "新", 消息: [], 未读: false };
    expect(排好([新, 老]).map((f) => f.id)).toEqual(["old", "new"]);
  });

  it("截字压成一行、按码点截，emoji 不切半个", async () => {
    const { 一句, 第一行 } = await import("@/lib/feedback-unread");
    expect(一句("第一行\n\n  第二行", 40)).toBe("第一行 第二行");
    expect(一句("😀".repeat(50), 5)).toBe("😀😀😀😀…");
    expect(第一行("\n\n  标题行 \n正文")).toBe("标题行");
  });

  it("云端回来的坏数据丢掉，不让页面出错", async () => {
    const { 规整反馈 } = await import("@/lib/feedback-unread");
    expect(规整反馈(null)).toEqual([]);
    expect(规整反馈([{ id: 1 }, { id: "a", at: "t", body: "b", 消息: [{ id: "m", at: "t", 谁: "黑客", body: "x" }, 回("ok", "t")] }])).toEqual([
      { id: "a", at: "t", body: "b", 消息: [回("ok", "t")] },
    ]);
  });
});

describe("存量库", () => {
  it("control.prisma 和 control-migrations/ 都有 FeedbackMessage", () => {
    expect(fs.readFileSync(path.join(根, "prisma/control.prisma"), "utf8")).toContain("model FeedbackMessage");
    const sql = fs.readFileSync(path.join(根, "control-migrations/027-feedback-message.sql"), "utf8");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "FeedbackMessage"');
  });
});
