/**
 * 反馈第 1 批 1E：首页 AI 新线索卡预填「分给谁」（人仍确认）。
 * 模型只给原话里的名字（assignTo → 分给），卡上按负责人候选认（assign-line.ts 认分给）：
 * 认出唯一一位、这人能用指定分配 → 预选 指定分配 + 那一位；认不出 / 同名多位 / 用不了指定分配（销售，P-转-15）→ 不预填。
 * 落库只认 分配方式 / ownerId，「分给」只是给卡片的线索。卡片上的行为见 tests/ent-ai-lead-card.ui.test.ts
 */
import { describe, it, expect } from "vitest";
import { buildProposal } from "@/lib/agent/proposals";
import { 认分给, 分配方式序号 } from "@/lib/enterprise/assign-line";
import { DEFAULT_BUSINESS } from "@/lib/business-config";

const 成员 = [{ value: "u1", label: "乙" }, { value: "a", label: "王芳（a@x.com）" }, { value: "b", label: "王芳（b@x.com）" }, { value: "c", label: "丙丁" }];
const 全能用 = [0, 1, 2, 3, 4];

describe("认分给", () => {
  it("唯一一位、能用指定分配：指定分配 + 那一位", () => {
    expect(认分给("乙", 成员, 全能用)).toEqual({ 分配方式: 分配方式序号.指定分配, ownerId: "u1" });
    expect(认分给(" 丙丁 ", 成员, 全能用)).toEqual({ 分配方式: 0, ownerId: "c" });
  });
  it("认不出、只是名字的一部分、同名两位、没给：不预填", () => {
    expect(认分给("没这个人", 成员, 全能用)).toBeNull();
    expect(认分给("丙", 成员, 全能用)).toBeNull();
    expect(认分给("王芳", 成员, 全能用)).toBeNull();
    expect(认分给("", 成员, 全能用)).toBeNull();
    expect(认分给(undefined, 成员, 全能用)).toBeNull();
  });
  it("这人用不了指定分配（销售只有暂不分配、个人自持）：不预填", () => {
    expect(认分给("乙", 成员, [3, 4])).toBeNull();
  });
});

describe("propose_lead 收 assignTo", () => {
  const 建 = (args: Record<string, unknown>) => buildProposal("p1", "add_lead", { id: "", name: "" }, args, DEFAULT_BUSINESS);
  it("assignTo 收成 分给；不当成 ownerId / 分配方式", () => {
    const r = 建({ name: "某公司", assignTo: "乙", source: "展会", reason: "x" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proposal).toMatchObject({ kind: "add_lead", 分给: "乙", source: "展会" });
    expect(r.proposal).not.toHaveProperty("ownerId");
    expect(r.proposal).not.toHaveProperty("分配方式");
  });
  it("没说分给谁：没有 分给 这一格", () => {
    const r = 建({ name: "某公司", reason: "x" });
    expect(r.ok && r.proposal).not.toHaveProperty("分给");
  });
});
