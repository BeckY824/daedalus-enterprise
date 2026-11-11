/**
 * 客户详情只读横幅按可见原因出文案（14-B 实点：项目组员、销管看连带可见的客户，横幅写「虚线下属 X 的客户」，其实不是虚线关系）。
 * 虚线上级才写虚线下属；实线上级写下属；条线总管理写本线；只因加入项目看得到写因参与项目可见；判不出写中性的「X 负责的客户」。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { 建组织, type 组织 } from "@/lib/enterprise/org-core";
import { 只读原因of, 只读横幅 } from "@/lib/enterprise/readonly-reason";
import { 虚线只读话, 组员只读话, 虚线或市场只读话 } from "@/lib/enterprise/visibility";
import { 市场只读话 } from "@/lib/enterprise/market";

type 行 = { id: string; bizRole: string; line?: string | null; managerId?: string | null; dottedManagerId?: string | null };
const 组织of = (们: 行[]): 组织 =>
  建组织(
    们.map((m) => ({ id: m.id, role: "SALES", active: true })),
    们.map((m) => ({ userId: m.id, deptId: null, bizRole: m.bizRole, line: m.line ?? null, managerId: m.managerId ?? null, dottedManagerId: m.dottedManagerId ?? null, noSettings: false })),
    [],
  );

const o = 组织of([
  { id: "虚线上级", bizRole: "sales_mgr", line: "内贸" },
  { id: "虚线下属", bizRole: "sales", line: "外贸", dottedManagerId: "虚线上级" },
  { id: "销管", bizRole: "sales_mgr", line: "内贸" },
  { id: "下属", bizRole: "sales", line: "内贸", managerId: "销管" },
  { id: "条线总", bizRole: "director", line: "外贸" },
  { id: "外贸销售", bizRole: "sales", line: "外贸" },
  { id: "组员", bizRole: "project_ops" },
  { id: "别人", bizRole: "sales", line: "内贸" },
]);

describe("只读原因", () => {
  it("虚线上级看虚线下属的：虚线", () => {
    expect(只读原因of(o, "虚线上级", "虚线下属", false)).toBe("虚线");
  });
  it("销管、项目组员只因加入项目看得到的：组员，不是虚线", () => {
    expect(只读原因of(o, "销管", "别人", true)).toBe("组员");
    expect(只读原因of(o, "组员", "别人", true)).toBe("组员");
    // 虚线上级加入了别人的项目：那位不是他的虚线下属，也是组员
    expect(只读原因of(o, "虚线上级", "外贸销售", true)).toBe("组员");
  });
  it("实线上级：下属；条线总管理看本线成员的：本线", () => {
    expect(只读原因of(o, "销管", "下属", false)).toBe("下属");
    expect(只读原因of(o, "条线总", "外贸销售", false)).toBe("本线");
  });
  it("判不出（市场相关、只看某人等）：null", () => {
    expect(只读原因of(o, "销管", "别人", false)).toBeNull();
    expect(只读原因of(o, "销管", null, false)).toBeNull();
  });
});

describe("横幅文案", () => {
  it("虚线才写虚线下属、找直属上级", () => {
    expect(只读横幅("虚线", "甲", "客户", 虚线只读话)).toEqual({ 标题: "虚线下属 甲 的客户 · 只能看", 说明: `${虚线只读话}。要改请找他的直属上级或总管理` });
  });
  it("组员：因参与项目可见，说明用组员那句（服务端给的是虚线那句也不照用）", () => {
    const x = 只读横幅("组员", "甲", "客户", 虚线只读话);
    expect(x.标题).toBe("因参与项目可见：甲 负责的客户 · 只能看");
    expect(x.说明).toBe(`${组员只读话}。要改请找负责人或总管理`);
    expect(x.标题 + x.说明).not.toContain("虚线");
  });
  it("下属、本线", () => {
    expect(只读横幅("下属", "甲", "客户", 组员只读话).标题).toBe("下属 甲 的客户 · 只能看");
    expect(只读横幅("本线", "甲", "客户", 组员只读话).标题).toBe("本线 甲 的客户 · 只能看");
    expect(只读横幅("本线", "甲", "客户", 组员只读话).说明).not.toContain("项目");
  });
  it("判不出：中性的「甲 负责的客户」；市场那句照用，说虚线、说组员的换中性", () => {
    expect(只读横幅(null, "甲", "客户", 市场只读话)).toEqual({ 标题: "甲 负责的客户 · 只能看", 说明: `${市场只读话}。要改请找负责人或总管理` });
    for (const 话 of [虚线只读话, 虚线或市场只读话, 组员只读话]) {
      const x = 只读横幅(null, "甲", "客户", 话);
      expect(x.标题 + x.说明).not.toMatch(/虚线|加入的项目/);
    }
  });
  it("客户页把算好的横幅传给记录页，记录页优先用它", () => {
    const 页 = readFileSync("src/app/(app)/customers/[id]/page.tsx", "utf8");
    expect(页).toMatch(/只读横幅=\{企 && 只读 === "全"/);
    const 记录 = readFileSync("src/app/(app)/customers/[id]/RecordView.tsx", "utf8");
    expect(记录).toContain("只读横幅?.标题 ??");
    expect(记录).toContain("只读横幅?.说明 ??");
  });
});
