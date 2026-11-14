/**
 * 项目公海里的项目谁都看得到，但客户是同事的时候：客户名、公司、联系人、沟通内容领了再看（质量审 10-23）。
 * 看不看得到客户交给带限定的客户端（lib/team-scope.ts），这里只测怎么用它的结果。
 */
import { describe, it, expect, vi } from "vitest";
import { 露客户, 看得到的客户 } from "@/lib/project/db";

const 我 = { id: "u-me" };
const 在公海 = new Date("2026-10-23T00:00:00Z");

describe("露客户", () => {
  it("看得到这位客户（自己的、客户公海里的、老板 / 互看）就给，不管项目在不在公海", () => {
    expect(露客户(我, { customerId: "c1", ownerId: "u-other", pooledAt: 在公海 }, new Set(["c1"]))).toBe(true);
    expect(露客户(我, { customerId: "c1", ownerId: "u-other", pooledAt: null }, new Set(["c1"]))).toBe(true);
  });

  it("公海里同事客户的项目不给，放回去的人也一样（他已经不是负责人）", () => {
    expect(露客户(我, { customerId: "c2", ownerId: "u-other", pooledAt: 在公海 }, new Set())).toBe(false);
    expect(露客户(我, { customerId: "c2", ownerId: "u-me", pooledAt: 在公海 }, new Set())).toBe(false);
  });

  it("领了（成了负责人、出了公海）就给，客户哪怕还是同事的", () => {
    expect(露客户(我, { customerId: "c2", ownerId: "u-me", pooledAt: null }, new Set())).toBe(true);
  });
});

describe("看得到的客户", () => {
  it("去重后走一次带限定的查询，限定层滤掉的就是看不到", async () => {
    const findMany = vi.fn(async () => [{ id: "c1", deletedAt: null }]);
    const 结果 = await 看得到的客户(["c1", "c2", "c1"], { customer: { findMany } } as never);
    expect([...结果]).toEqual(["c1"]);
    expect(findMany).toHaveBeenCalledTimes(1);
    // 按主键取（11-14）：顶层「没删」不进 SQL，带 deletedAt 回来在内存里滤
    expect(findMany).toHaveBeenCalledWith({ where: { id: { in: ["c1", "c2"] } }, select: { id: true, deletedAt: true } });
  });

  it("回收站里的（deletedAt 有值）算看不到：顶层没删挪到内存里滤，结果和在库里滤一样", async () => {
    const findMany = vi.fn(async () => [{ id: "c1", deletedAt: null }, { id: "c2", deletedAt: new Date("2026-11-01T00:00:00Z") }]);
    expect([...(await 看得到的客户(["c1", "c2"], { customer: { findMany } } as never))]).toEqual(["c1"]);
  });

  it("没有客户就不查", async () => {
    const findMany = vi.fn();
    expect((await 看得到的客户([], { customer: { findMany } } as never)).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});
