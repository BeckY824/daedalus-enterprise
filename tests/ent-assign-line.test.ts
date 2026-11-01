/**
 * 企业版项目业务线和按部门挑候选（lib/enterprise/assign-line.ts，11-01 清单 A1–A6、16:1x 拍板）：纯函数。
 * 钉的是：业务线三选一（内贸 / 外贸 / 暂不分配），老项目没填按负责人的线、再没有按内贸；地址只给建议（台湾按外贸）；
 * 各条线勾的部门连下级、成环不死循环；勾了按部门 + 销售角色挑，没勾退回成员标记；分配方式默认值按角色。
 */
import { describe, it, expect } from "vitest";
import {
  项目业务线, 认业务线, 是项目线, 建议业务线, 台湾算, 规整线部门, 线部门们, 线勾了部门, 按部门候选, 默认分配方式, 分配方式序号, 是销售角色,
} from "@/lib/enterprise/assign-line";
import { 建组织 } from "@/lib/enterprise/org-core";
import { 自动候选人们 } from "@/lib/enterprise/lead-assign";

const 成员行 = (userId: string, bizRole: string, deptId: string | null = null, line: string | null = null) =>
  ({ userId, deptId, bizRole, line, managerId: null, dottedManagerId: null });
const 部 = (id: string, parentId: string | null = null) => ({ id, name: id, parentId, sort: 0 });

describe("项目业务线（A1 / C7）", () => {
  const 成员 = new Map([["外贸的", { line: "外贸" }], ["内贸的", { line: "内贸" }], ["没标的", { line: null }]]);
  it("填了三种之一就用填的", () => {
    expect(项目业务线({ bizLine: "外贸", ownerId: "内贸的" }, 成员)).toBe("外贸");
    expect(项目业务线({ bizLine: "暂不分配", ownerId: "外贸的" }, 成员)).toBe("暂不分配");
    expect(项目业务线({ bizLine: "内贸", ownerId: "外贸的" }, 成员)).toBe("内贸");
  });
  it("老项目没填、存坏了：取负责人的线；负责人没设、不在组织、不传成员 → 内贸", () => {
    expect(项目业务线({ bizLine: null, ownerId: "外贸的" }, 成员)).toBe("外贸");
    expect(项目业务线({ bizLine: "乱填的", ownerId: "外贸的" }, 成员)).toBe("外贸");
    expect(项目业务线({ bizLine: null, ownerId: "没标的" }, 成员)).toBe("内贸");
    expect(项目业务线({ bizLine: null, ownerId: "不在的" }, 成员)).toBe("内贸");
    expect(项目业务线({ bizLine: null, ownerId: "外贸的" })).toBe("内贸");
    expect(项目业务线(null)).toBe("内贸");
    expect(项目业务线({ ownerId: null }, 成员)).toBe("内贸");
  });
  it("交来的业务线：三种之一原样（去空格），空 = null，别的 = undefined", () => {
    expect(认业务线(" 外贸 ")).toBe("外贸");
    expect(认业务线("暂不分配")).toBe("暂不分配");
    expect(认业务线("")).toBeNull();
    expect(认业务线(null)).toBeNull();
    expect(认业务线(undefined)).toBeNull();
    expect(认业务线("国内")).toBeUndefined();
    expect(是项目线("暂不分配")).toBe(true);
    expect(是项目线("全部")).toBe(false);
  });
});

describe("按地址给建议（只提示，不自动填）", () => {
  const 址 = (addrCountry: string | null, addrProvince: string | null = null, addrCity: string | null = null) => ({ addrCountry, addrProvince, addrCity, addrDistrict: null });
  it("大陆 → 内贸；港澳 → 外贸；台湾按 台湾算（外贸）；外国 → 外贸；全空没建议", () => {
    expect(台湾算).toBe("外贸");
    expect(建议业务线(址("中国", "浙江省", "杭州市"))).toBe("内贸");
    expect(建议业务线(址(null, "广东省"))).toBe("内贸");
    expect(建议业务线(址("中国", "香港"))).toBe("外贸");
    expect(建议业务线(址("中国", "澳門"))).toBe("外贸");
    expect(建议业务线(址("中国", "台湾省"))).toBe("外贸");
    expect(建议业务线(址("中国台湾"))).toBe("外贸");
    expect(建议业务线(址("中国香港"))).toBe("外贸");
    expect(建议业务线(址("美国", null, "纽约"))).toBe("外贸");
    expect(建议业务线(址(null))).toBeNull();
    expect(建议业务线(null)).toBeNull();
  });
});

describe("各条线参与自动分配的部门（A4 / A5）", () => {
  it("规整：每条线去重、去空、去非字符串；不是对象 = 两条都空", () => {
    expect(规整线部门({ 内贸: ["a", " a ", "", 3, "b"], 外贸: "x", 别的: ["c"] })).toEqual({ 内贸: ["a", "b"], 外贸: [] });
    expect(规整线部门(null)).toEqual({ 内贸: [], 外贸: [] });
    expect(规整线部门(["a"])).toEqual({ 内贸: [], 外贸: [] });
  });
  it("勾的部门连下级；删掉的部门不算；成环只走一遍", () => {
    const 部门 = new Map([部("总部"), 部("一组", "总部"), 部("一组一队", "一组"), 部("二组"), 部("环甲", "环乙"), 部("环乙", "环甲")].map((d) => [d.id, d]));
    expect([...线部门们(部门, ["一组"])].sort()).toEqual(["一组", "一组一队"]);
    expect([...线部门们(部门, ["总部", "已删"])].sort()).toEqual(["一组", "一组一队", "总部"].sort());
    expect([...线部门们(部门, ["环甲"])].sort()).toEqual(["环乙", "环甲"].sort());
  });
  it("勾了按部门（连下级）+ 销售 / 销售管理挑，不看成员标记、去掉现负责人；没勾或勾的都删了退回成员标记", () => {
    const org = 建组织(
      ["甲", "乙", "丙", "丁", "戊", "己", "离职"].map((id) => ({ id, role: "SALES", active: id !== "离职" })),
      [
        成员行("甲", "sales", "一组", "外贸"), // 标的外贸，但部门勾在内贸那条线：按部门算
        成员行("乙", "sales_mgr", "一组一队"),
        成员行("丙", "channel_ops", "一组"), // 不是销售角色
        成员行("丁", "sales", "二组", "内贸"), // 部门没勾
        成员行("戊", "sales", null, "内贸"),
        成员行("己", "marketing_mgr,sales", "一组"), // 兼销售的也算
        成员行("离职", "sales", "一组"),
      ],
      [部("一组"), 部("一组一队", "一组"), 部("二组")],
    );
    const 设 = { 内贸: ["一组"], 外贸: [] };
    expect(线勾了部门(org, 设, "内贸")).toBe(true);
    expect(线勾了部门(org, 设, "外贸")).toBe(false);
    expect(按部门候选(org, null, "内贸", 设, 自动候选人们).sort()).toEqual(["甲", "乙", "己"].sort());
    expect(按部门候选(org, "甲", "内贸", 设, 自动候选人们).sort()).toEqual(["乙", "己"].sort());
    // 外贸没勾：退回成员标记（标外贸的、没标的销售）
    expect(按部门候选(org, null, "外贸", 设, 自动候选人们).sort()).toEqual(自动候选人们(org, null, "外贸").sort());
    expect(按部门候选(org, null, "外贸", 设, 自动候选人们)).toContain("甲");
    expect(按部门候选(org, null, "外贸", 设, 自动候选人们)).not.toContain("丁");
    // 勾的部门都删了 = 没勾
    expect(按部门候选(org, null, "内贸", { 内贸: ["已删"], 外贸: [] }, 自动候选人们).sort()).toEqual(自动候选人们(org, null, "内贸").sort());
  });
});

describe("分配方式默认值（A6）", () => {
  const 全 = Object.values(分配方式序号);
  it("市场 → 自动分配；销售 / 销售管理 → 个人自持；其他 → 暂不分配；兼市场和销售按市场", () => {
    expect(默认分配方式(["marketing_mgr"], 全)).toBe(分配方式序号.自动分配);
    expect(默认分配方式(["sales"], 全)).toBe(分配方式序号.个人自持);
    expect(默认分配方式(["sales_mgr"], 全)).toBe(分配方式序号.个人自持);
    expect(默认分配方式(["channel_ops"], 全)).toBe(分配方式序号.暂不分配);
    expect(默认分配方式(["director"], 全)).toBe(分配方式序号.暂不分配);
    expect(默认分配方式(["marketing_mgr", "sales"], 全)).toBe(分配方式序号.自动分配);
  });
  it("默认的那个用不了退到能用的第一个；都用不了 = undefined", () => {
    expect(默认分配方式(["sales"], [分配方式序号.指定分配, 分配方式序号.自动分配])).toBe(分配方式序号.指定分配);
    expect(默认分配方式(["sales"], [])).toBeUndefined();
  });
  it("选自动分配要确认的只有销售（不兼市场）", () => {
    expect(是销售角色(["sales"])).toBe(true);
    expect(是销售角色(["sales_mgr"])).toBe(true);
    expect(是销售角色(["marketing_mgr", "sales"])).toBe(false);
    expect(是销售角色(["channel_ops"])).toBe(false);
  });
});
