/**
 * 内贸归档「全部电话」列拆分（M-导入-34）+ 占位号不进电话、不参与查重（M-导入-36）：
 *   - 按「 / 」拆成多个号，一家多号全留：第一个电话进电话，其余进备注「另一个电话」
 *   - 纯数字进电话；不含 7 位以上数字的进微信；字母数字混写整段按微信、不截数字
 *   - 占位假号（全同数字、连续 0、顺序数字）不写进电话、不参与查重：不撞我们这边、本批里也不拿它并成一家
 *   - 普通导入（没映射归档档位）电话格里的占位号同样去掉
 * 名字、号码全是编造的
 */
import { describe, expect, it } from "vitest";
import { 清洗, 空索引, 名键, 归档号键, 撞已有客户 } from "@/lib/enterprise-import/clean";
import { 规则猜列 } from "@/lib/enterprise-import/mapping";
import type { 原始记录, 映射 } from "@/lib/enterprise-import/types";

function 映射样(客户列: Record<string, string>): 映射 {
  return {
    列: { customer: { 外部: "id", 名称: "name", 负责人: "owner", ...客户列 } },
    负责人: { 示例销售: "u-1" },
    值: { 阶段: {}, 线索状态: {}, 跟进类型: {}, 跟进状态: {} },
    默认负责人Id: "u-1",
  };
}

let 序 = 0;
function 条(字段: Record<string, string>): 原始记录 {
  序++;
  return { 实体: "customer", 外部ID: 字段.外部 ?? `T${序}`, 字段: { 负责人: "示例销售", ...字段 }, 行号: 序 + 1, 出处: "归档.xlsx" };
}

const 归档 = 映射样({ 全部电话: "phone", 座机: "landline", WhatsApp: "whatsapp", 归档档位: "archiveTier" });

describe("「全部电话」拆分（M-导入-34）", () => {
  it("「全部电话」表头认成电话", () => {
    expect(规则猜列("customer", ["客户名称", "全部电话", "归档档位"]).全部电话).toBe("phone");
  });

  it("按「 / 」拆：多个纯数字号全留，第一个进电话、其余进备注", () => {
    const r = 清洗([条({ 名称: "示例一", 全部电话: "13900000101 / 021-5555-0102 / 13900000103", 归档档位: "A1" })], 归档);
    const w = r.待写[0];
    expect(w.值.phone).toBe("13900000101");
    expect(String(w.值.remark)).toContain("另一个电话：02155550102");
    expect(String(w.值.remark)).toContain("另一个电话：13900000103");
  });

  it("不含 7 位以上数字的进微信；字母数字混写整段按微信、不截数字", () => {
    const r = 清洗(
      [
        条({ 名称: "示例二", 全部电话: "13900000201 / sample_wx", 归档档位: "B" }),
        条({ 名称: "示例三", 全部电话: "wxid13900000301", 归档档位: "B" }),
        条({ 名称: "示例四", 全部电话: "abc123 / 13900000401 / wx-two", 归档档位: "C" }),
      ],
      归档,
    );
    const [二, 三, 四] = r.待写;
    expect(二.值).toMatchObject({ phone: "13900000201", wechat: "sample_wx" });
    expect(三.值).toMatchObject({ phone: "", wechat: "wxid13900000301" });
    expect(四.值).toMatchObject({ phone: "13900000401", wechat: "abc123" });
    expect(String(四.值.remark)).toContain("另一个微信：wx-two");
    expect(String(三.值.remark ?? "")).not.toContain("电话：");
  });

  it("纯中文这类看不出是号也不像微信的，照旧进备注、不进微信", () => {
    const r = 清洗([条({ 名称: "示例五", 全部电话: "13900000501 / 无", 归档档位: "D" })], 归档);
    expect(r.待写[0].值).toMatchObject({ phone: "13900000501", wechat: null });
    expect(String(r.待写[0].值.remark)).toContain("电话：无");
  });

  it("微信那格本来有值：拆出来的微信进备注，不顶掉", () => {
    const m = 映射样({ 全部电话: "phone", 微信: "wechat", 归档档位: "archiveTier" });
    const r = 清洗([条({ 名称: "示例六", 全部电话: "13900000601 / other_wx", 微信: "own_wx", 归档档位: "E" })], m);
    expect(r.待写[0].值.wechat).toBe("own_wx");
    expect(String(r.待写[0].值.remark)).toContain("微信：other_wx");
  });
});

describe("占位号不进电话、不参与查重（M-导入-36）", () => {
  it("占位号从「全部电话」里去掉，真号照留；提醒一笔", () => {
    const r = 清洗([条({ 外部: "P1", 名称: "示例七", 全部电话: "11111111111 / 13900000701 / 00000000", 归档档位: "A2" })], 归档);
    const w = r.待写[0];
    expect(w.值.phone).toBe("13900000701");
    expect(String(w.值.remark ?? "")).not.toMatch(/11111111111|00000000/);
    expect(r.问题.some((q) => q.外部ID === "P1" && q.说明.includes("占位"))).toBe(true);
  });

  it("只有占位号的：电话空着照建", () => {
    const r = 清洗([条({ 名称: "示例八", 全部电话: "12345", 归档档位: "D" })], 归档);
    expect(r.待写).toHaveLength(1);
    expect(r.待写[0].值.phone).toBe("");
  });

  it("同一个占位号不让后面的客户被当成重复：不撞我们这边、本批里也不并", () => {
    const 本地 = 空索引();
    本地.客户名.set(名键("示例老客户"), ["c-old"]);
    本地.客户号.set("11111111111", ["c-old"]);
    本地.归档号 = new Map([[归档号键("11111111111"), ["c-old"]]]);
    const r = 清洗(
      [
        条({ 外部: "Q1", 名称: "示例九", 全部电话: "11111111111", 归档档位: "E" }),
        条({ 外部: "Q2", 名称: "示例十", 全部电话: "11111111111", 归档档位: "E" }),
        条({ 外部: "Q3", 名称: "示例十一", 全部电话: "13800000000", WhatsApp: "+86 11111111111", 座机: "0000000", 归档档位: "E" }),
      ],
      归档,
      本地,
    );
    expect(r.待写.map((w) => w.外部ID)).toEqual(["Q1", "Q2", "Q3"]);
    expect(r.待写.every((w) => !w.并入)).toBe(true);
    expect(r.问题.filter((q) => q.级别 === "跳过")).toHaveLength(0);
    expect(r.待写[2].值.whatsapp).toBeNull();
  });

  it("撞已有客户：占位号段不拿来比", () => {
    const 本地 = 空索引();
    本地.客户号.set("11111111111", ["c-old"]);
    本地.归档号 = new Map([[归档号键("11111111111"), ["c-old"]]]);
    expect(撞已有客户(本地, "示例新", ["11111111111", "13900000801"])).toBeNull();
  });

  it("普通导入（没映射归档档位）电话格是占位号：一样去掉", () => {
    const r = 清洗([条({ 名称: "示例十二", 电话: "00000000" })], 映射样({ 电话: "phone" }));
    expect(r.待写[0].值.phone).toBe("");
  });
});
