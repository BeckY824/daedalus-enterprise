/**
 * 后发的客户照片（2026-11-01）：先发名片建好客户，再单发一张照片，图里没认出人 → 问存不存到刚建的那位名下。
 * 这里测「这几张图怎么办」的判断、刚建的那位记多久 / 撤销后忘掉、逐张存的计数。数据都是编的
 */
import { describe, expect, it } from "vitest";
import { 记下刚建的, 忘掉刚建的, 刚建的, 刚建多久内算, 这几张图, 逐张存, 记下名片原图, 取走名片原图 } from "@/lib/card-scan/originals";

describe("这几张图怎么办", () => {
  const 刚建 = { 去处: { contactId: "c1" }, 名: "Test Co · Tom", 时刻: 0 };
  it("认出人就出卡，不管刚建过谁", () => {
    expect(这几张图(1, false, 刚建)).toBe("出卡");
    expect(这几张图(2, true, null)).toBe("出卡");
  });
  it("一个人都没认出、刚建过一位：问存不存到他名下（排在只认出几个字的备用卡前面）", () => {
    expect(这几张图(0, false, 刚建)).toBe("存到刚建的");
    expect(这几张图(0, true, 刚建)).toBe("存到刚建的");
  });
  it("没建过人：照旧用备用凑卡，或说没认出", () => {
    expect(这几张图(0, true, null)).toBe("备用出卡");
    expect(这几张图(0, false, null)).toBe("没认出");
  });
});

describe("刚建的那位", () => {
  it("记下最后一位，超过时限不算刚建", () => {
    记下刚建的({ leadId: "l1" }, "甲公司", 1000);
    记下刚建的({ contactId: "c2" }, "乙公司 · Maria", 2000);
    expect(刚建的(2000 + 刚建多久内算)?.名).toBe("乙公司 · Maria");
    expect(刚建的(2001 + 刚建多久内算)).toBeNull();
  });
  it("名字空着给个叫法", () => {
    记下刚建的({ contactId: "c3" }, "  ", 0);
    expect(刚建的(0)?.名).toBe("刚建的客户");
  });
  it("撤销了同一位才忘掉，别的卡撤销不影响", () => {
    记下刚建的({ contactId: "c4" }, "丙公司", 0);
    忘掉刚建的({ contactId: "c5" });
    expect(刚建的(0)?.去处).toEqual({ contactId: "c4" });
    忘掉刚建的({ contactId: "c4" });
    expect(刚建的(0)).toBeNull();
  });
});

describe("逐张存", () => {
  const 图 = (n: string) => new File(["x"], n, { type: "image/jpeg" });
  it("一张一张传，记下几张没存上", async () => {
    const 顺序: string[] = [];
    const r = await 逐张存([图("a.jpg"), 图("b.jpg"), 图("c.jpg")], async (f) => {
      顺序.push(f.name);
      return f.name === "b.jpg" ? { ok: false, error: "太大了" } : { ok: true };
    });
    expect(顺序).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    expect(r).toEqual({ 存了: 2, 错: ["太大了"] });
  });
  it("照片按卡 id 记下，取走一次就没了（点两次不会传两遍）", () => {
    记下名片原图("photo-x", [图("a.jpg")]);
    expect(取走名片原图("photo-x").map((f) => f.name)).toEqual(["a.jpg"]);
    expect(取走名片原图("photo-x")).toEqual([]);
  });
});
