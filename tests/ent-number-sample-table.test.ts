/**
 * 号码规矩样本表（11-17 号码审计）：审计里列出的那几个值，按号码类型、按入口各过一遍，钉住现在的口径。
 *   类型：手机号 / 微信 / 邮箱 / 阿里国际站ID（验号码）、座机 / WhatsApp / 传真（验一行号码）、键（通号键：座机、WhatsApp 和手机共用）
 *   入口：客户「电话」（验客户电话，就地改 + 完整表单）、联系人卡 / 客户号码几行（验一行号码）、建档向导 / AI 卡（验号码）、
 *         老的宽松口径（查电话：导入单格、退回公海查客户电话）、导入单个电话列（清洗）、名片（名片转表单 → 新线索卡）
 * 号码全是编造的
 */
import { describe, expect, it } from "vitest";
import { 验号码, 验客户电话, 像微信号提示, 像座机提示, 科学计数提示, 电话格式话 } from "@/lib/enterprise/contact-format";
import { 验一行号码, 通号键, 号键变体, 联系人号查重键, type 号码种类 } from "@/lib/enterprise/customer-v2";
import { 查电话 } from "@/lib/phone";
import { 清洗, 归档号键 } from "@/lib/enterprise-import/clean";
import type { 原始记录, 映射 } from "@/lib/enterprise-import/types";
import { 名片转表单, 空名片表单 } from "@/lib/card-scan/form";
import { 名片成新线索卡 } from "@/lib/card-scan/lead-card";
import { DEFAULT_BUSINESS } from "@/lib/business-config";
import type { 字段 } from "@/lib/card-scan/parse";

const 种 = (kind: string, 名: string, 验?: 号码种类["验"]): 号码种类 => ({ kind, 名, ...(验 ? { 验 } : {}) });
const 手机 = 种("phone", "手机", "手机号"), 座机 = 种("landline", "座机"), 微信 = 种("wechat", "微信", "微信"), 邮箱 = 种("email", "邮箱", "邮箱");
const WA = 种("whatsapp", "WhatsApp"), 传真 = 种("fax", "传真"), 阿里 = 种("wangwang", "阿里国际站ID", "旺旺ID");

/** 手机号（建档向导、AI 卡、联系人卡手机行、客户电话共用一条） */
const 手机样本: [string, { 值: string; 键?: string } | { 提示: string | RegExp }][] = [
  ["sqin17548955941", { 提示: 像微信号提示 }],
  ["wxid_abc17548955941", { 提示: 像微信号提示 }],
  ["Abc_123456", { 提示: 像微信号提示 }],
  ["138号码", { 提示: 像微信号提示 }],
  ["748392", { 提示: /手机号格式错误/ }],
  ["123456", { 提示: /手机号格式错误/ }],
  ["010-12345678", { 提示: 像座机提示 }],
  ["+86 10 1234 5678", { 提示: 像座机提示 }],
  ["87654321", { 提示: 像座机提示 }],
  ["01012345678", { 提示: 像座机提示 }],
  ["12345678901", { 提示: /手机号格式错误/ }],
  ["8.61391E+12", { 提示: 科学计数提示 }],
  ["13800000000", { 提示: /占位号码/ }],
  ["+86 138 0000 0000", { 提示: /占位号码/ }],
  ["+86 139 1234 5678", { 值: "13912345678", 键: "13912345678" }],
  ["0086-139-1234-5678", { 值: "13912345678" }],
  ["8613912345678", { 值: "13912345678" }],
  ["139 1234 5678", { 值: "13912345678" }],
  ["１３９１２３４５６７８", { 值: "13912345678" }],
  ["13912345678", { 值: "13912345678" }],
  ["0044 20 7946 0958", { 值: "+442079460958", 键: "442079460958" }],
  ["+44 20 7946 0958", { 值: "+442079460958", 键: "442079460958" }],
  ["+44 1", { 提示: /手机号格式错误/ }],
];

describe("手机号（验号码 手机号）", () => {
  it.each(手机样本)("%s", (原, 期) => {
    const r = 验号码("手机号", 原);
    if ("值" in 期) {
      expect(r).toMatchObject({ ok: true, 值: 期.值, ...(期.键 ? { 键: 期.键 } : {}) });
    } else {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.提示).toMatch(期.提示);
    }
  });
});

describe("入口：客户「电话」（验客户电话，就地改、完整表单）", () => {
  it.each(手机样本)("%s", (原, 期) => {
    const r = 验客户电话(原);
    if ("值" in 期) expect(r).toMatchObject({ ok: true, 值: 期.值 });
    else {
      expect(r.ok).toBe(false);
      // 给人看的不带 ⚠️；手机号格式错误换成电话的说法
      if (!r.ok) {
        expect(r.error).not.toContain("⚠️");
        if (期.提示 instanceof RegExp && 期.提示.source.includes("手机号格式错误")) expect(r.error).toBe(电话格式话);
        else expect(r.error).toMatch(期.提示);
      }
    }
  });
  it("空 = 没填（清空交给服务端看还有没有别的联系方式）", () => {
    expect(验客户电话("")).toEqual({ ok: true, 值: "", 键: "" });
    expect(验客户电话("  ")).toEqual({ ok: true, 值: "", 键: "" });
  });
  it("像微信号的提示就是这一句", () => {
    expect(验客户电话("sqin17548955941")).toEqual({ ok: false, error: "格式不对，像微信号？请到联系方式里选「微信」类型" });
  });
});

describe("入口：联系人卡 / 客户号码几行（验一行号码）", () => {
  it("手机行同 验号码", () => {
    for (const [原, 期] of 手机样本) {
      const r = 验一行号码(手机, 原);
      expect(r.ok, 原).toBe("值" in 期);
    }
  });

  it.each([
    ["sqin17548955941", "sqin17548955941", "sqin17548955941"],
    ["wxid_abc17548955941", "wxid_abc17548955941", "wxid_abc17548955941"],
    ["Abc_123456", "Abc_123456", "abc_123456"],
    ["748392", "748392", "748392"],
    ["10001", "10001", "10001"],
    ["13912345678", "13912345678", "13912345678"],
    ["+86 139 1234 5678", "13912345678", "13912345678"],
  ])("微信 %s 收下", (原, 值, 键) => {
    expect(验一行号码(微信, 原)).toEqual({ ok: true, 值, 键 });
  });
  it.each(["123456", "1234", "010-12345678", "01012345678", "8.61391E+12", "a1234", "中文微信号", "12345678901"])("微信 %s 不收", (原) => {
    expect(验一行号码(微信, 原).ok).toBe(false);
  });

  it.each([
    ["a@b.photography", true],
    ["a@b.international", true],
    ["a@xn--fiqs8s.xn--fiqs8s", true],
    ["a@b.co", true],
    ["a@b.c", false],
    ["a@b.abcdefghijklmnopqrstuvwxy", false],
    ["a@b..com", false],
  ])("邮箱 %s → %s", (原, 好) => {
    expect(验一行号码(邮箱, 原).ok).toBe(好);
  });

  it("阿里国际站ID 留横杠：ab-cd 和 abcd 是两个号", () => {
    expect(验一行号码(阿里, "ab-cd")).toEqual({ ok: true, 值: "ab-cd", 键: "ab-cd" });
    expect(验一行号码(阿里, "ab cd")).toEqual({ ok: true, 值: "abcd", 键: "abcd" });
    expect(验一行号码(阿里, "Buyer-1:sub_2")).toMatchObject({ ok: true, 值: "Buyer-1:sub_2", 键: "buyer-1:sub_2" });
  });

  it.each([
    ["010-12345678", "01012345678"],
    ["+86 10 1234 5678", "01012345678"],
    ["0086 21 5555 0102", "02155550102"],
    ["(021) 5555-0102", "02155550102"],
  ])("座机 %s 键 %s", (原, 键) => {
    expect(验一行号码(座机, 原)).toMatchObject({ ok: true, 键 });
  });
  it.each([
    ["+86 139 1234 5678", "13912345678"],
    ["8613912345678", "13912345678"],
    ["+44 20 7946 0958", "442079460958"],
    ["0044 20 7946 0958", "442079460958"],
  ])("WhatsApp %s 键 %s（和手机号的键同一个空间）", (原, 键) => {
    expect(验一行号码(WA, 原)).toMatchObject({ ok: true, 键 });
    expect(联系人号查重键("whatsapp", 原)).toBe(键);
  });
  it("传真只留数字；座机、WhatsApp 带字母的不收", () => {
    expect(验一行号码(传真, "+86 10 1234 5678")).toMatchObject({ ok: true, 键: "861012345678" });
    expect(验一行号码(座机, "sqin17548955941").ok).toBe(false);
    expect(验一行号码(WA, "8.61391E+12").ok).toBe(false);
  });
});

describe("号键：手机、座机、WhatsApp 一个空间；老行的键带 86 也认", () => {
  it("通号键 和 验号码 手机号的键、归档号键 对得上", () => {
    expect(通号键("+86 139 1234 5678")).toBe((验号码("手机号", "13912345678") as { 键: string }).键);
    expect(通号键("+44 20 7946 0958")).toBe((验号码("手机号", "+44 20 7946 0958") as { 键: string }).键);
    expect(通号键("+86 139 1234 5678")).toBe(归档号键("+86 139 1234 5678"));
  });
  it("号键变体", () => {
    expect(号键变体("13912345678")).toEqual(["13912345678", "8613912345678"]);
    expect(号键变体("01012345678")).toEqual(["01012345678", "861012345678"]);
    expect(号键变体("442079460958")).toEqual(["442079460958"]);
  });
});

describe("老的宽松口径（查电话）：00 开头和 验号码 一样当 +", () => {
  it.each([
    ["0044 20 7946 0958", "+442079460958"],
    ["+44 20 7946 0958", "+442079460958"],
    ["+86 139 1234 5678", "13912345678"],
    ["0086 139 1234 5678", "13912345678"],
    ["010-12345678", "01012345678"],
  ])("%s → %s", (原, 存) => {
    expect(查电话(原, { 必填: false })).toEqual({ ok: true, phone: 存 });
  });
});

describe("入口：导入单个电话列（清洗）", () => {
  const 映射: 映射 = {
    列: { customer: { 外部: "id", 名称: "name", 负责人: "owner", 电话: "phone" } },
    负责人: { 示例销售: "u-1" },
    值: { 阶段: {}, 线索状态: {}, 跟进类型: {}, 跟进状态: {} },
    默认负责人Id: "u-1",
  };
  let 序 = 0;
  const 洗 = (电话: string) => {
    序++;
    const 记录: 原始记录 = { 实体: "customer", 外部ID: `S${序}`, 字段: { 负责人: "示例销售", 名称: `样本${序}`, 电话 }, 行号: 序 + 1, 出处: "样本.xlsx" };
    return 清洗([记录], 映射);
  };
  it.each(["sqin17548955941", "wxid_abc17548955941", "Abc_123456"])("%s 整段进微信，不截数字", (原) => {
    const r = 洗(原);
    expect(r.待写[0].值).toMatchObject({ phone: "", wechat: 原 });
    expect(r.问题.some((x) => x.说明.includes("整段按微信号"))).toBe(true);
  });
  it("8.61391E+12：不当号码，原文进备注待核对", () => {
    const r = 洗("8.61391E+12");
    expect(r.待写[0].值.phone).toBe("");
    expect(r.待写[0].值.wechat ?? null).toBeNull();
    expect(String(r.待写[0].值.remark)).toContain("电话（待核对）：8.61391E+12");
    expect(r.问题.some((x) => x.说明.includes("科学计数法"))).toBe(true);
  });
  it.each([
    ["+86 139 1234 5678", "13912345678"],
    ["13912345678", "13912345678"],
    ["0044 20 7946 0958", "+442079460958"],
    ["010-12345678", "01012345678"],
    // 导入单格照旧按「能不能打通」宽松收（M-导入-43 ③），位数不够 11 位的不拦，只是不足 10 位不参与查重
    ["748392", "748392"],
  ])("%s → 电话 %s", (原, 存) => {
    expect(洗(原).待写[0].值.phone).toBe(存);
  });
  it("123456 是占位号：不写进电话", () => {
    expect(洗("123456").待写[0].值.phone).toBe("");
  });
  it("全部电话（归档）一段科学计数法：不当微信", () => {
    const 归档: 映射 = { ...映射, 列: { customer: { ...映射.列.customer, 全部电话: "phone", 归档档位: "archiveTier" } } };
    delete (归档.列.customer as Record<string, string>).电话;
    const 记录: 原始记录 = { 实体: "customer", 外部ID: "G1", 字段: { 负责人: "示例销售", 名称: "归档样本", 全部电话: "13912345678 / 8.61391E+12", 归档档位: "B" }, 行号: 2, 出处: "归档.xlsx" };
    const w = 清洗([记录], 归档).待写[0];
    expect(w.值).toMatchObject({ phone: "13912345678" });
    expect(w.值.wechat ?? null).toBeNull();
    expect(String(w.值.remark)).toContain("电话（待核对）：8.61391E+12");
  });
});

describe("入口：名片（国内座机进座机，不顶到手机）", () => {
  const 字段样 = (phones: 字段["phones"]): 字段 => ({
    name: "王五", nameAlt: [], company: "远航贸易", companyAlt: [], title: null, titleAlt: [], phones,
    whatsapp: null, whatsapp建议: null, wechat: null, email: null, website: null, country: "CN", address: null, 剩下: [], 待核: [], name建议: null, 语言线索: [],
  });
  it("只有座机：电话空着，座机进 landline；新线索卡带「座机」那一行", () => {
    const { 填 } = 名片转表单(字段样([{ e164: "+861012345678", 类: "座机", 核实: true, 原文: "010-12345678" }]), false);
    expect(填.phone).toBe("");
    expect(填.landline).toBe("+861012345678");
    const 卡 = 名片成新线索卡(填, DEFAULT_BUSINESS, ["展会"]);
    expect(卡.ok && 卡.proposal.联系方式).toEqual([{ kind: "landline", value: "+861012345678" }]);
  });
  it("手机 + 座机：手机进电话，座机进 landline，座机不再进备注", () => {
    const { 填 } = 名片转表单(字段样([
      { e164: "+861012345678", 类: "不确定", 核实: true, 原文: "010-12345678" },
      { e164: "+8613912345678", 类: "手机", 核实: true, 原文: "139 1234 5678" },
    ]), false);
    expect(填).toMatchObject({ phone: "+8613912345678", landline: "+861012345678" });
    expect(填.remark).not.toContain("+861012345678");
    const 卡 = 名片成新线索卡(填, DEFAULT_BUSINESS, ["展会"]);
    expect(卡.ok && 卡.proposal.联系方式).toEqual([{ kind: "phone", value: "+8613912345678" }, { kind: "landline", value: "+861012345678" }]);
  });
  it("国外座机照旧可以当电话", () => {
    const { 填 } = 名片转表单(字段样([{ e164: "+442079460958", 类: "座机", 核实: true, 原文: "+44 20 7946 0958" }]), false);
    expect(填).toMatchObject({ phone: "+442079460958", landline: "" });
  });
  it("空名片表单带 landline 这一格", () => {
    expect(空名片表单().landline).toBe("");
  });
});
