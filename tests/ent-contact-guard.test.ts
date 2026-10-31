/**
 * 企业版联系人「号码保护」（10-31）：只展示的小标签，判定是纯函数（lib/enterprise/contact-guard.ts）
 *
 * 钉的是：
 *   - 有电话：改版后的号码行里有手机或座机（值不空），或老的 phone 格不空；只有邮箱、微信不算
 *   - 有电话 + 客户有负责人 + 不在公海 →「已开启」；其余都「已关闭」，并说为什么
 *   - 公海里的客户即使还记着原负责人也算「已关闭」
 */
import { describe, it, expect } from "vitest";
import { 有电话, 号码保护of } from "@/lib/enterprise/contact-guard";

describe("有电话", () => {
  it("号码行里有手机或座机才算；值是空白不算", () => {
    expect(有电话({ 号码们: [{ kind: "phone", value: "13800000000" }] })).toBe(true);
    expect(有电话({ 号码们: [{ kind: "landline", value: "021-12345678" }] })).toBe(true);
    expect(有电话({ 号码们: [{ kind: "phone", value: "  " }] })).toBe(false);
    expect(有电话({ 号码们: [{ kind: "email", value: "a@b.c" }, { kind: "wechat", value: "wx" }] })).toBe(false);
  });

  it("老的 phone 格不空也算；都没有不算", () => {
    expect(有电话({ phone: "13800000000" })).toBe(true);
    expect(有电话({ phone: " ", 号码们: [] })).toBe(false);
    expect(有电话({})).toBe(false);
    expect(有电话({ phone: null, 号码们: null })).toBe(false);
  });
});

describe("号码保护of", () => {
  const 有号 = { phone: "13800000000" };
  it("有电话、客户有负责人、不在公海 → 已开启", () => {
    expect(号码保护of(有号, { salesOwnerId: "u1", pool: null })).toEqual({ 状态: "已开启", 原因: "有电话、客户有负责人" });
  });

  it("没电话 → 已关闭（先看这条）", () => {
    expect(号码保护of({ phone: null }, { salesOwnerId: "u1", pool: null })).toEqual({ 状态: "已关闭", 原因: "这位联系人没留电话" });
  });

  it("客户在公海（还记着原负责人也一样）→ 已关闭", () => {
    expect(号码保护of(有号, { salesOwnerId: "u1", pool: { reason: "手动" } })).toEqual({ 状态: "已关闭", 原因: "客户在公海里" });
  });

  it("客户没负责人 → 已关闭", () => {
    expect(号码保护of(有号, { salesOwnerId: null, pool: null })).toEqual({ 状态: "已关闭", 原因: "客户还没有负责人" });
    expect(号码保护of({ 号码们: [{ kind: "landline", value: "021-1" }] }, {})).toMatchObject({ 状态: "已关闭" });
  });
});
