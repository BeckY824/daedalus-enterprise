/**
 * A7-1（11-03）：刚记的沟通撤销——只认本人、服务器时间 10 分钟内；过了说清楚
 */
import { describe, it, expect } from "vitest";
import { 撤销拦, 时间线可撤, 撤销剩余毫秒, 撤销窗口分钟, 不是本人记的话, 撤销过时话 } from "@/lib/enterprise/follow-undo";
import { 刚记的能撤 } from "@/lib/enterprise/follow-perm";

const 记下 = new Date("2026-11-03T10:00:00Z");
const 过 = (分: number) => new Date(记下.getTime() + 分 * 60_000);

describe("撤销拦（服务器判）", () => {
  it("本人、10 分钟内：能撤", () => {
    expect(撤销拦({ id: "u1" }, { ownerId: "u1", createdAt: 记下 }, 过(0))).toBeNull();
    expect(撤销拦({ id: "u1" }, { ownerId: "u1", createdAt: 记下 }, 过(撤销窗口分钟))).toBeNull();
  });
  it("别人记的：不能撤，说只能撤自己的", () => {
    expect(撤销拦({ id: "u2" }, { ownerId: "u1", createdAt: 记下 }, 过(1))).toBe(不是本人记的话);
    expect(撤销拦({ id: "u2" }, { ownerId: null, createdAt: 记下 }, 过(1))).toBe(不是本人记的话);
  });
  it("过了 10 分钟：说清超时、去「…」删", () => {
    expect(撤销拦({ id: "u1" }, { ownerId: "u1", createdAt: 记下 }, 过(10.01))).toBe(撤销过时话);
    expect(撤销过时话).toContain("10 分钟");
  });
  it("字符串时间也认；坏时间当过时", () => {
    expect(撤销拦({ id: "u1" }, { ownerId: "u1", createdAt: 记下.toISOString() }, 过(3))).toBeNull();
    expect(撤销拦({ id: "u1" }, { ownerId: "u1", createdAt: "不是时间" }, 过(3))).toBe(撤销过时话);
  });
  it("刚记的能撤 和 撤销拦 口径一致", () => {
    expect(刚记的能撤({ id: "u1" }, { ownerId: "u1", createdAt: 记下 }, 过(9))).toBe(true);
    expect(刚记的能撤({ id: "u1" }, { ownerId: "u1", createdAt: 记下 }, 过(11))).toBe(false);
    expect(刚记的能撤({ id: "u2" }, { ownerId: "u1", createdAt: 记下 }, 过(1))).toBe(false);
  });
});

describe("时间线上摆不摆「撤销」", () => {
  const 现在 = (分: number) => 过(分).getTime();
  it("我记的、不到 10 分钟：摆", () => {
    expect(时间线可撤(true, 记下.toISOString(), 现在(5))).toBe(true);
  });
  it("不是我记的、没带记下时间、过了 10 分钟：不摆", () => {
    expect(时间线可撤(false, 记下.toISOString(), 现在(5))).toBe(false);
    expect(时间线可撤(undefined, 记下.toISOString(), 现在(5))).toBe(false);
    expect(时间线可撤(true, undefined, 现在(5))).toBe(false);
    expect(时间线可撤(true, 记下.toISOString(), 现在(11))).toBe(false);
  });
  it("剩余毫秒：到点收起按钮用，过了是 0", () => {
    expect(撤销剩余毫秒(记下.toISOString(), 现在(4))).toBe(6 * 60_000);
    expect(撤销剩余毫秒(记下.toISOString(), 现在(20))).toBe(0);
  });
});
