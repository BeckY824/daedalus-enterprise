/**
 * 分配方向（11-18 用户：市场分配时内贸 / 外贸可改，默认按「区域 → 电话 → 本人事业部」）：纯函数（lib/enterprise/customer-region.ts）。
 * 服务端（建档向导、AI 新线索卡、客户转让）见 ent-assign-use / ent-ai-lead-assign / ent-cust-transfer-auto；界面见各自 .ui 测试
 */
import { describe, it, expect } from "vitest";
import { 默认分配方向, 电话定线, 认分配方向, 认交来的方向, 方向来源说明, 方向分配理由, 本人事业部, 区域未填提示 } from "@/lib/enterprise/customer-region";
import { 建组织 } from "@/lib/enterprise/org-core";

describe("电话定线", () => {
  it("大陆手机（含 +86 / 0086 / 空格横线）→ 内贸", () => {
    for (const x of ["13812345678", "+86 138 1234 5678", "0086-13812345678"]) expect([x, 电话定线([x])]).toEqual([x, "内贸"]);
  });
  it("别的国际区号（含港澳台）→ 外贸", () => {
    for (const x of ["+14155550123", "+852 91234567", "00447700900123"]) expect([x, 电话定线([x])]).toEqual([x, "外贸"]);
  });
  it("座机、认不出、空的跳过，看下一个；都不行 = null", () => {
    expect(电话定线(["0571-88888888", "", null, "abc", "+14155550123"])).toBe("外贸");
    expect(电话定线(["0571-88888888", "12345"])).toBeNull();
    expect(电话定线([])).toBeNull();
  });
});

describe("默认分配方向：区域 → 电话 → 本人事业部 → 不限", () => {
  it("① 区域能判：按区域（电话、本人都不看）", () => {
    expect(默认分配方向({ 客户: { addrCountry: "美国" }, 号们: ["13812345678"], 本人线: "内贸" })).toEqual({ 线: "外贸", 来源: "区域" });
    expect(默认分配方向({ 客户: null, 项目: { addrCity: "杭州" }, 号们: ["+14155550123"] })).toEqual({ 线: "内贸", 来源: "区域" });
  });
  it("② 区域未知：看电话", () => {
    expect(默认分配方向({ 号们: ["+14155550123"], 本人线: "内贸" })).toEqual({ 线: "外贸", 来源: "电话" });
    expect(默认分配方向({ 号们: ["13812345678"], 本人线: "外贸" })).toEqual({ 线: "内贸", 来源: "电话" });
  });
  it("③ 电话也判不出：本人事业部；本人也没有 = 不限", () => {
    expect(默认分配方向({ 号们: ["0571-88888888"], 本人线: "外贸" })).toEqual({ 线: "外贸", 来源: "本人" });
    expect(默认分配方向({ 号们: [] })).toEqual({ 线: null, 来源: "不限" });
  });
  it("界面给的预算线（老客户）先用", () => {
    expect(默认分配方向({ 客户线: "外贸", 项目: { addrCity: "杭州" } })).toEqual({ 线: "外贸", 来源: "区域" });
    expect(默认分配方向({ 电话线: "外贸", 号们: ["13812345678"] })).toEqual({ 线: "外贸", 来源: "电话" });
  });
});

describe("认分配方向 / 说明", () => {
  it("内贸、外贸照收；没交 = undefined；别的拦", () => {
    expect(认分配方向("外贸")).toEqual({ ok: true, 线: "外贸" });
    for (const x of [undefined, null, ""]) expect(认分配方向(x)).toEqual({ ok: true, 线: undefined });
    for (const x of ["暂不分配", "东南亚", 1, {}]) expect(认分配方向(x)).toEqual({ ok: false, error: "分配方向只能选内贸或外贸" });
  });
  it("认交来的方向（建好再分 交建档时算好的，审核 11-18 P2-4）：对象原样收；只交内贸 / 外贸 = 手动；没交 = undefined；对不上拦", () => {
    expect(认交来的方向({ 线: "外贸", 来源: "电话" })).toEqual({ ok: true, 向: { 线: "外贸", 来源: "电话" } });
    expect(认交来的方向({ 线: null, 来源: "不限" })).toEqual({ ok: true, 向: { 线: null, 来源: "不限" } });
    expect(认交来的方向("内贸")).toEqual({ ok: true, 向: { 线: "内贸", 来源: "手动" } });
    for (const x of [undefined, null, ""]) expect(认交来的方向(x)).toEqual({ ok: true, 向: undefined });
    for (const x of [{ 线: "东南亚", 来源: "区域" }, { 线: "内贸", 来源: "瞎写" }, { 线: null, 来源: "区域" }, "东南亚", []]) {
      expect(认交来的方向(x)).toEqual({ ok: false, error: "分配方向只能选内贸或外贸" });
    }
  });
  it("来源一句话", () => {
    expect(方向来源说明({ 线: "内贸", 来源: "区域" })).toBe("按客户区域：内贸");
    expect(方向来源说明({ 线: "内贸", 来源: "电话" })).toBe("按电话（大陆手机号）：内贸");
    expect(方向来源说明({ 线: "外贸", 来源: "电话" })).toBe("按电话（国外号码）：外贸");
    expect(方向来源说明({ 线: "外贸", 来源: "本人" })).toBe("按你所在事业部：外贸");
    expect(方向来源说明({ 线: null, 来源: "不限" })).toBe(区域未填提示);
    expect(方向分配理由({ 线: "外贸", 来源: "手动" })).toBe("按选的分配方向：外贸");
  });
});

describe("本人事业部", () => {
  const 部门 = [
    { id: "内", name: "内贸事业部", parentId: null, sort: 0 }, { id: "内市", name: "市场运营部", parentId: "内", sort: 0 },
    { id: "外", name: "外贸事业部", parentId: null, sort: 1 }, { id: "外市", name: "市场运营部", parentId: "外", sort: 0 },
    { id: "企划", name: "营销企划部", parentId: null, sort: 2 }, { id: "别", name: "行政部", parentId: null, sort: 3 },
  ];
  const 行 = (userId: string, deptId: string | null, line: string | null = null) => ({ userId, deptId, bizRole: "marketing_mgr", line, managerId: null, dottedManagerId: null });
  const org = 建组织(
    ["a", "b", "c", "d", "e"].map((id) => ({ id, role: "SALES", active: true })),
    [行("a", "内市"), 行("b", "外市"), 行("c", "企划"), 行("d", "企划", "外贸"), 行("e", "别")],
    部门,
  );
  it("成员业务线优先；否则往上找部门名带内贸 / 外贸的；营销企划部兜底内贸（11-18 第 7 题 A）；都没有 = null", () => {
    expect(本人事业部(org, null, "a")).toBe("内贸");
    expect(本人事业部(org, null, "b")).toBe("外贸");
    expect(本人事业部(org, null, "c")).toBe("内贸");
    expect(本人事业部(org, null, "e")).toBeNull();
    expect(本人事业部(org, null, "d")).toBe("外贸");
    expect(本人事业部(org, null, "不在")).toBeNull();
  });
  it("勾了参与部门：所在部门只落在一条线里就按它", () => {
    expect(本人事业部(org, { 内贸: ["企划"], 外贸: [] }, "c")).toBe("内贸");
    expect(本人事业部(org, { 内贸: ["别"], 外贸: ["别"] }, "e")).toBeNull();
    expect(本人事业部(org, { 内贸: [], 外贸: ["别"] }, "e")).toBe("外贸");
  });
});
