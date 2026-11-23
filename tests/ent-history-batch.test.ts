import { describe, expect, it } from "vitest";
import { 批量批次, 批量说明, 折批量 } from "@/lib/enterprise/history-batch";
/* 客户「历史变更」里系统批量修正怎么认、怎么折（lib/enterprise/history-batch.ts）。样本照本机正式库副本里几类审计行的样子改写，名字都是假的 */

const 行 = (加: Partial<{ userId: string; userName: string; summary: string; detail: string | null }>) =>
  ({ userId: "u1", userName: "张三", summary: "修改客户「某客户」：备注", detail: null, ...加 });
const 人改明细 = JSON.stringify([{ 字段: "备注", 原值: "旧", 新值: "新" }]);

describe("批量批次：认不认得出系统批量修正", () => {
  it("规矩 1：操作人是系统（userId = system）→ 明细里的批次，没有就「系统」", () => {
    expect(批量批次(行({ userId: "system", userName: "系统", summary: "统一省市写法" }))).toBe("系统");
    expect(批量批次(行({ userId: "system", detail: JSON.stringify({ 批次: "省市-1" }) }))).toBe("省市-1");
  });
  it("规矩 2：操作人名字带中文括号 → 括号说明那一串（同一批同一个名字）", () => {
    expect(批量批次(行({ userName: "管理员（48：渠道收尾）" }))).toBe("管理员（48：渠道收尾）");
    expect(批量批次(行({ userName: "管理员（渠道负责人回填：第二轮）", detail: JSON.stringify({ 脚本: "fix-channel.ts" }) }))).toBe("fix-channel.ts");
  });
  it("规矩 3：说明以 [ 开头 → [] 里那段去掉 NO.编号（同一批不同客户的头一样）", () => {
    const a = 批量批次(行({ userName: "管理员", summary: "[M21① 清公海挂负责人 NO.42193] 负责人 甲 → 无负责人" }));
    const b = 批量批次(行({ userName: "管理员", summary: "[M21① 清公海挂负责人 NO.42200] 负责人 乙 → 无负责人" }));
    expect(a).toBe("M21① 清公海挂负责人");
    expect(b).toBe(a);
    expect(批量批次(行({ userName: "管理员", summary: "[] 空头" }))).toBe("批次");
  });
  it("规矩 4：说明以「按原表补」开头", () => {
    expect(批量批次(行({ userName: "管理员", summary: "按原表补客户资料：省份、城市" }))).toBe("按原表补");
  });
  it("规矩 5：明细是 JSON 对象且带 脚本 / 批次 / 批次Id / 数据ID / 依据 → 批次 ?? 批次Id ?? 脚本 ?? 依据 ?? 导入后修正", () => {
    expect(批量批次(行({ userName: "管理员", summary: "客户 X 创建人记为 Y", detail: JSON.stringify({ 依据: "按销帮帮原表创建人", 数据ID: 123 }) }))).toBe("按销帮帮原表创建人");
    expect(批量批次(行({ userName: "管理员", detail: JSON.stringify({ 数据ID: 123 }) }))).toBe("导入后修正");
    expect(批量批次(行({ userName: "管理员", detail: JSON.stringify({ 批次Id: "b-7", 依据: "x" }) }))).toBe("b-7");
  });
  it("人在界面上改的不算：明细是数组、关联客户 / 挂联系人的对象不带脚本键、管理员本人（没括号）改的", () => {
    expect(批量批次(行({ detail: 人改明细 }))).toBeNull();
    expect(批量批次(行({ userName: "管理员", detail: 人改明细 }))).toBeNull();
    expect(批量批次(行({ detail: JSON.stringify({ 关联客户: "c2", 动作: "加" }) }))).toBeNull();
    expect(批量批次(行({ detail: "{坏的 JSON" }))).toBeNull();
    expect(批量批次(行({ userName: "管理员", summary: "撤回 10-30 管理员误领" }))).toBeNull();
    // 英文括号不算（不是脚本写的那种）
    expect(批量批次(行({ userName: "李四(销售)" }))).toBeNull();
  });
});

describe("批量说明", () => {
  it("去掉 [批次头]，没有就原样", () => {
    expect(批量说明("[E-220 客户状态补写 NO.85326] 补写 正常跟进")).toBe("补写 正常跟进");
    expect(批量说明("按原表补客户资料")).toBe("按原表补客户资料");
    expect(批量说明("[只有头]")).toBe("[只有头]");
  });
});

describe("折批量：同一个北京日、同一批折一组", () => {
  type R = { id: string; at: string; 批: string | null };
  const 折 = (rs: R[]) => 折批量(rs, (r) => r.批).map((g) => (g.种 === "单" ? g.行.id : `${g.键}:${g.行们.map((r) => r.id).join(",")}`));
  it("同一天同一批折一起，中间夹了人工改动也并进去；人工改动一条一组", () => {
    expect(折([
      { id: "1", at: "2026-11-20T08:00:00Z", 批: "按原表补" },
      { id: "人", at: "2026-11-20T07:00:00Z", 批: null },
      { id: "2", at: "2026-11-20T06:00:00Z", 批: "按原表补" },
      { id: "3", at: "2026-11-20T05:00:00Z", 批: "系统" },
    ])).toEqual(["2026-11-20|按原表补:1,2", "人", "2026-11-20|系统:3"]);
  });
  it("按北京日切：UTC 同一天、北京跨了零点的分两组；北京同一天、UTC 跨天的并一组", () => {
    expect(折([
      { id: "a", at: "2026-11-20T17:00:00Z", 批: "x" }, // 北京 11-21 01:00
      { id: "b", at: "2026-11-20T15:00:00Z", 批: "x" }, // 北京 11-20 23:00
    ])).toEqual(["2026-11-21|x:a", "2026-11-20|x:b"]);
    expect(折([
      { id: "c", at: "2026-11-21T01:00:00Z", 批: "y" }, // 北京 11-21 09:00
      { id: "d", at: "2026-11-20T17:00:00Z", 批: "y" }, // 北京 11-21 01:00
    ])).toEqual(["2026-11-21|y:c,d"]);
  });
  it("同一天不同批各成一组；空输入空输出", () => {
    expect(折([{ id: "1", at: "2026-11-20T08:00:00Z", 批: "甲批" }, { id: "2", at: "2026-11-20T07:00:00Z", 批: "乙批" }])).toEqual(["2026-11-20|甲批:1", "2026-11-20|乙批:2"]);
    expect(折([])).toEqual([]);
  });
});
