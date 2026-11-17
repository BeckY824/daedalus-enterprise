/**
 * 客户抬头 PR-7（P-抬头-16 / 17，X-146）：导入时客户全称可以空、不补名；子表只能按外部 ID 挂，按名称挂不上的进报告；
 * 查重不用抬头、简称，空全称不参与按名查重。老导入文件（有全称）行为不变。
 * 这里只测清洗（不碰库）；写库、三方比对见 ent-import-no-fullname-apply.test.ts。
 */
import { describe, expect, it } from "vitest";
import { 清洗, 空索引, type 本地索引 } from "@/lib/enterprise-import/clean";
import type { 原始记录, 实体, 映射 } from "@/lib/enterprise-import/types";

function 映射样(改: Partial<映射> = {}): 映射 {
  return {
    列: {
      customer: { 外部: "id", 名称: "name", 简称: "shortName", 电话: "phone", 负责人: "owner" },
      contact: { 外部: "id", 客户ID: "customerRef", 客户: "customerName", 姓名: "name", 手机: "phone" },
      opportunity: { 外部: "id", 客户ID: "customerRef", 客户: "customerName", 名称: "name", 阶段: "stage", 负责人: "owner" },
      followup: { 外部: "id", 客户ID: "customerRef", 客户: "customerName", 方式: "type", 内容: "content", 时间: "occurredAt", 跟进人: "owner" },
    },
    负责人: { 张伟: "u-zhang" },
    值: { 阶段: { 需求确认: "需求确认" }, 线索状态: {}, 跟进类型: { 电话: "PHONE" }, 跟进状态: {} },
    默认负责人Id: "u-default",
    ...改,
  };
}

let 序 = 0;
const 负责人列: Partial<Record<实体, string>> = { customer: "负责人", opportunity: "负责人", followup: "跟进人" };
function 条(实体: 实体, 字段: Record<string, string>, 外部ID?: string): 原始记录 {
  序++;
  const 列 = 负责人列[实体];
  if (列 && !(列 in 字段)) 字段 = { ...字段, [列]: "张伟" };
  return { 实体, 外部ID: 外部ID ?? 字段.外部 ?? `auto${序}`, 字段, 行号: 序 + 1, 出处: "测试.xlsx" };
}
const 类 = (问题: { 外部ID: string; 类别: string; 级别: string }[], id: string) => 问题.filter((p) => p.外部ID === id).map((p) => `${p.级别}:${p.类别}`);

describe("导入：客户全称可以空（P-抬头-16）", () => {
  it("空全称照导、不补名（不拿联系人名、国家拼名字），记一条「没有全称」提醒", () => {
    const { 待写, 问题 } = 清洗(
      [
        条("customer", { 外部: "c1", 名称: "", 电话: "13800000001" }),
        条("contact", { 外部: "p1", 客户ID: "c1", 姓名: "王经理", 手机: "13700000001" }),
      ],
      映射样(),
    );
    const 客户 = 待写.find((w) => w.外部ID === "c1")!;
    expect(客户).toBeTruthy();
    expect("name" in 客户.值).toBe(false);
    expect(JSON.stringify(客户.值)).not.toContain("王经理");
    expect(类(问题, "c1")).toEqual(["提醒:没有全称"]);
    expect(问题.find((p) => p.外部ID === "c1")!.说明).toMatch(/所属客户 ID/);
    expect(问题.some((p) => p.类别 === "缺必填")).toBe(false);
  });

  it("项目模式的提醒说「项目」", () => {
    const { 问题 } = 清洗([条("customer", { 外部: "c1", 名称: "", 电话: "13800000001" })], 映射样({ 项目: true }));
    expect(问题[0].说明).toMatch(/联系人、项目、跟进/);
  });

  it("子表按外部 ID 挂上没有全称的客户；只写客户名称的挂不上，单独一类「按名称挂不上」进报告", () => {
    const { 待写, 问题 } = 清洗(
      [
        条("customer", { 外部: "c1", 名称: "", 电话: "13800000001" }),
        条("contact", { 外部: "p1", 客户ID: "c1", 姓名: "王经理" }),
        条("contact", { 外部: "p2", 客户: "13800000001", 姓名: "李经理" }),
        条("opportunity", { 外部: "o1", 客户ID: "c1", 名称: "样品单", 阶段: "需求确认" }),
        条("opportunity", { 外部: "o2", 客户: "某某贸易", 名称: "大货单", 阶段: "需求确认" }),
        条("followup", { 外部: "f1", 客户ID: "c1", 方式: "电话", 内容: "聊了报价", 时间: "2026-10-01 10:00" }),
        条("followup", { 外部: "f2", 客户: "某某贸易", 方式: "电话", 内容: "回访", 时间: "2026-10-02 10:00" }),
        // 写了客户 ID 但对不上的仍是「找不到客户」（老口径不变）
        条("followup", { 外部: "f3", 客户ID: "c9", 方式: "电话", 内容: "回访", 时间: "2026-10-03 10:00" }),
      ],
      映射样(),
    );
    const 挂 = Object.fromEntries(待写.filter((w) => w.实体 !== "customer").map((w) => [w.外部ID, w.父客户]));
    expect(挂).toEqual({ p1: { 外部ID: "c1" }, o1: { 外部ID: "c1" }, f1: { 外部ID: "c1" } });
    for (const id of ["p2", "o2", "f2"]) expect(类(问题, id)).toEqual(["跳过:按名称挂不上"]);
    expect(问题.find((p) => p.外部ID === "o2")!.说明).toMatch(/按客户名称「某某贸易」挂不上.*所属客户 ID/);
    expect(类(问题, "f3")).toEqual(["跳过:找不到客户"]);
  });

  it("表里没有原系统 ID 列、全称和号码都空的：认不出是哪家，仍跳过（缺必填）；有号的照导", () => {
    const { 待写, 问题 } = 清洗(
      [
        条("customer", { 名称: "", 电话: "" }, "h:00000000000000000001"),
        条("customer", { 名称: "", 电话: "13800000001" }, "h:00000000000000000002"),
      ],
      映射样(),
    );
    expect(待写.map((w) => w.外部ID)).toEqual(["h:00000000000000000002"]);
    expect(类(问题, "h:00000000000000000001")).toEqual(["跳过:缺必填"]);
  });

  it("有全称的老文件：不多提醒、名字照落（行为不变）", () => {
    const { 待写, 问题 } = 清洗(
      [条("customer", { 外部: "c1", 名称: "杭州云帆科技有限公司", 电话: "13800000001" }), 条("contact", { 外部: "p1", 客户: "杭州云帆科技有限公司", 姓名: "王经理" })],
      映射样(),
    );
    expect(待写.find((w) => w.外部ID === "c1")!.值.name).toBe("杭州云帆科技有限公司");
    expect(待写.find((w) => w.外部ID === "p1")!.父客户).toEqual({ 外部ID: "c1" });
    expect(问题).toEqual([]);
  });
});

describe("导入查重不用抬头、简称；空全称不按名比（P-抬头-17）", () => {
  it("空全称不撞我们这边的任何名字（含同样空名的老客户），同号照拦", () => {
    const 本地: 本地索引 = {
      ...空索引(),
      客户名: new Map([["甲公司", ["local-1"]]]),
      客户号: new Map([["13800000009", ["local-9"]]]),
    };
    const { 待写, 问题 } = 清洗(
      [
        条("customer", { 外部: "c1", 名称: "", 电话: "13800000001" }),
        条("customer", { 外部: "c2", 名称: "", 电话: "13800000009" }),
      ],
      映射样(),
      本地,
    );
    expect(待写.map((w) => w.外部ID)).toEqual(["c1"]);
    expect(类(问题, "c2")).toEqual(["跳过:重名"]);
    expect(问题.find((p) => p.外部ID === "c2")!.说明).toMatch(/号码 13800000009 和我们这边已有的客户撞了/);
  });

  it("本批两条空全称：号不同各导各的（不算同名）；同号并成一条", () => {
    const { 待写, 问题 } = 清洗(
      [
        条("customer", { 外部: "c1", 名称: "", 电话: "13800000001" }),
        条("customer", { 外部: "c2", 名称: "", 电话: "13800000002" }),
        条("customer", { 外部: "c3", 名称: "", 电话: "+86 138-0000-0001" }),
      ],
      映射样(),
    );
    expect(待写.map((w) => [w.外部ID, w.并入 ?? null])).toEqual([
      ["c1", null],
      ["c2", null],
      ["c3", "c1"],
    ]);
    expect(问题.some((p) => p.类别 === "疑似重名" || p.类别 === "同名不同号放行")).toBe(false);
    expect(问题.find((p) => p.外部ID === "c3")!.说明).toMatch(/同号（这一条没有全称），认作同一家/);
    // 并进去的那条不另记「没有全称」，也不记「又名：」
    expect(类(问题, "c3")).toEqual(["提醒:重名"]);
    expect(String(待写[0].值.remark ?? "")).not.toMatch(/又名/);
  });

  it("没有全称的那条和后面同号、有全称的并成一家：补上全称，撤掉「没有全称」提醒", () => {
    const { 待写, 问题 } = 清洗(
      [条("customer", { 外部: "c1", 名称: "", 电话: "13800000001" }), 条("customer", { 外部: "c2", 名称: "乙公司", 电话: "13800000001" })],
      映射样(),
    );
    expect(待写[0].值.name).toBe("乙公司");
    expect(问题.some((p) => p.类别 === "没有全称")).toBe(false);
    expect(String(待写[0].值.remark ?? "")).not.toMatch(/又名/);
  });

  it("简称不参与查重：简称和我们这边已有客户的全称一样、全称不同，照导", () => {
    const 本地: 本地索引 = { ...空索引(), 客户名: new Map([["云帆", ["local-1"]]]) };
    const { 待写, 问题 } = 清洗(
      [
        条("customer", { 外部: "c1", 名称: "杭州云帆科技有限公司", 简称: "云帆", 电话: "13800000001" }),
        条("customer", { 外部: "c2", 名称: "宁波云帆贸易", 简称: "云帆", 电话: "13800000002" }),
        条("customer", { 外部: "c3", 名称: "", 简称: "云帆", 电话: "13800000003" }),
      ],
      映射样(),
      本地,
    );
    expect(待写.map((w) => w.外部ID)).toEqual(["c1", "c2", "c3"]);
    expect(问题.filter((p) => p.级别 === "跳过")).toEqual([]);
    expect(待写[0].值.shortName).toBe("云帆");
  });

  it("有全称的照旧按全称查重（M-导入-29 不变）：撞我们这边同名、两边没号可比 → 跳过", () => {
    const 本地: 本地索引 = { ...空索引(), 客户名: new Map([["甲公司", ["local-1"]]]) };
    const { 待写, 问题 } = 清洗([条("customer", { 外部: "c1", 名称: "甲 公司", 电话: "" })], 映射样(), 本地);
    expect(待写).toEqual([]);
    expect(类(问题, "c1")).toEqual(["跳过:重名"]);
  });
});
