/**
 * 设置开关 N7（11-23）守卫：开关文案表、总览、原卡三处对得上。漏一处不报错，只会是总览少一项、两边说法不一样。
 *   - switch-table 18 项、键不重复；组织规则 7 条每条都有对应的总览开关（switch-actions 规则开关）
 *   - 子开关的父开关在表里；二选一有默认那一项
 *   - 原卡（ProjectSettingsTab）和总览（SwitchesTab）用同一个确认钩子、同一份后果文案
 *   - 后果框：父开关关掉时写「连带」；仅上级推在「按组织架构看客户」关着时写不起作用
 *   - 不再说「本线下一位」（客户 11-23）
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 开关表, 开关of, 开关后果of, 改回全部项目后果, 改的人 } from "@/lib/enterprise/switch-table";
import { 规则名们, 规则 } from "@/lib/enterprise/rules-table";

const 读 = (p: string) => fs.readFileSync(path.resolve(__dirname, "../src", p), "utf8");

describe("开关文案表", () => {
  it("18 项、键不重复；子开关的父开关在表里；二选一的默认是其中一项", () => {
    expect(开关表).toHaveLength(18);
    expect(new Set(开关表.map((s) => s.k)).size).toBe(18);
    for (const s of 开关表) {
      if (s.parent) expect(开关of[s.parent]).toBeTruthy();
      if (s.opts) expect(s.opts.map(([v]) => v)).toContain(s.默认);
      expect(s.what).not.toContain("本线下一位");
    }
    expect(改的人).toBe("总管理（系统管理员）");
  });

  it("组织规则每一条都在总览里（switch-actions 的 规则开关 映射齐全）", () => {
    const src = 读("app/(app)/settings/switch-actions.ts");
    for (const n of 规则名们) expect(src).toMatch(new RegExp(`${n}: "[a-z_]+"`));
    for (const n of 规则名们) expect(规则[n].说明).not.toContain("本线下一位");
  });

  it("原卡和总览用同一个先数钩子、同一份后果文案", () => {
    for (const f of ["app/(app)/settings/ProjectSettingsTab.tsx", "app/(app)/settings/SwitchesTab.tsx"]) {
      const src = 读(f);
      expect(src).toContain('from "./use-count-confirm"');
      expect(src).toContain("开关后果of");
      expect(src).toContain("改回全部项目后果");
    }
  });
});

describe("后果文案", () => {
  it("关父开关写连带；打开写会怎样、影响谁（带人数）、生效", () => {
    const 关 = 开关后果of("lead_assign", false, { 全员: 43, 开着的子开关: ["lead_giveup"] });
    expect(关.题).toBe("关掉「线索分配和配额」？");
    expect(关.后果.map((x) => x.标)).toEqual(["会怎样", "连带", "影响谁", "生效"]);
    expect(关.危).toBe(true);
    const 开 = 开关后果of("first_two", true, { 全员: 43 });
    expect(开.后果.find((x) => x.标 === "影响谁")?.话).toBe("全员（43 人）的项目");
    expect(开.危).toBe(false);
    // 不知道人数（原卡）：只说全员
    expect(开关后果of("first_two", true).后果.find((x) => x.标 === "影响谁")?.话).toBe("全员的项目");
  });

  it("仅上级推：按组织架构看客户关着写不起作用；开着写依赖", () => {
    expect(开关后果of("push_perm", "仅上级推", { 按组织看客户: false }).后果.map((x) => x.话).join()).toContain("选了也不起作用");
    expect(开关后果of("push_perm", "仅上级推", { 按组织看客户: true }).后果.map((x) => x.话).join()).toContain("总管理照旧能推");
  });

  it("改回全部项目：存量项目也按必填走", () => {
    expect(改回全部项目后果(43).后果[0].话).toContain("开启之前建的项目也按必填走");
  });
});
