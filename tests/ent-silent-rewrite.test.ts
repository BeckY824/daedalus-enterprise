/**
 * 11-17 复盘第 4 类「输入被悄悄改写，用户不知道」—— 号码、金额的 7 处，纯逻辑这一头（界面见 ent-silent-rewrite.ui.test.ts，
 * 线索 / 渠道落库见 remediation-lead-phone.test.ts）：
 *
 *   ① ② 线索 / 渠道电话（录入电话）：夹字母、带说明、两个号整格拦下说为什么，不截出号码、不往备注里塞原文
 *   ③ 普通导入（lib/import/plan）：号码和字母连着写的不截数字当电话，拦这一行、预览里说清
 *   ④ ⑤ 企业导入（enterprise-import/clean）：一格多段 / 单段带说明的，号码照收、原文进备注、报告里说一句；粘字母的段按微信 / 进备注
 *   ⑥ 导入联系人格拆人（enterprise-import/excel 拆人格）：号码和字母连着写的那段不拆，原样当名字、提醒里说
 *   ⑦ AI 卡金额（认金额，lib/money-input）：「1万」= 10000，「-500」认不出（界面就地提示）
 */
import { describe, expect, it } from "vitest";
import { 录入电话, 号码粘着字母, 号码带着字, 电话夹字母话, 电话带字话 } from "@/lib/phone";
import { 电话格验 } from "@/lib/form-validation";
import { 认金额 } from "@/lib/money-input";
import { 认金额 as 导入认金额, 清洗 } from "@/lib/enterprise-import/clean";
import { 拆人格, 拆联系人, type 读出的表 } from "@/lib/enterprise-import/excel";
import { 解析CSV, 成表 } from "@/lib/import/parse";
import { 字段表, 猜列 } from "@/lib/import/fields";
import { 摊开 } from "@/lib/import/plan";
import { DEFAULT_BUSINESS } from "@/lib/business-config";
import type { 原始记录, 映射 } from "@/lib/enterprise-import/types";

describe("号码粘着字母 / 录入电话（① ②）", () => {
  it("判据：数字和英文字母、下划线紧挨着才算；分机写法、标签加冒号、汉字说明不算", () => {
    for (const v of ["sqin17548955941", "wxid_a13800001111", "13800001111abc", "Tel13800001111", "１３８００００１１１１ab"]) expect(号码粘着字母(v), v).toBe(true);
    for (const v of ["13800001111", "+1 415 555 0132 ext 12", "+1 415 555 0132 x12", "010-12345678 ext. 801", "Tel: 13800001111", "13800001111（微信同号）", "+1 415 555 0132 (cell)"]) expect(号码粘着字母(v), v).toBe(false);
  });

  it("录入电话：规整照旧（国家码、全角、分隔符、分机），号码以外的字整格拦、说清为什么", () => {
    expect(录入电话("＋８６ １３８－００００－１１１１", { 必填: false })).toEqual({ ok: true, phone: "13800001111" });
    expect(录入电话("+1 (415) 555-0132", { 必填: false })).toEqual({ ok: true, phone: "+14155550132" });
    expect(录入电话("010-12345678 ext 801", { 必填: false })).toEqual({ ok: true, phone: "01012345678转801" });
    expect(录入电话("", { 必填: false })).toEqual({ ok: true, phone: "" });
    expect(录入电话("sqin17548955941", { 必填: false })).toEqual({ ok: false, error: 电话夹字母话 });
    expect(录入电话("13800001111（微信同号）", { 必填: false })).toEqual({ ok: false, error: 电话带字话 });
    expect(录入电话("13800001111 13900002222", { 必填: false })).toEqual({ ok: false, error: 电话带字话 });
    expect(录入电话("13800001111 ext 8", { 必填: false })).toEqual({ ok: false, error: 电话带字话 });
    // 查电话本来就拒的照旧是它的话（打码、打错的字母、不像号码）
    expect(录入电话("138O0001111", { 必填: false })).toMatchObject({ ok: false, error: expect.stringContaining("看不出") });
    expect(录入电话("138****1111", { 必填: false })).toMatchObject({ ok: false, error: expect.stringContaining("*") });
  });

  it("号码带着字：全角加号不算丢了的字", () => {
    expect(号码带着字("＋８６ １３８－００００－１１１１")).toBe(false);
    expect(号码带着字("13800001111（微信同号）")).toBe(true);
  });

  it("表单就地校验 电话格验：没改的老号不验，改了的按 录入电话", async () => {
    await expect(电话格验("旧号待核对", "旧号待核对")).resolves.toBeUndefined();
    await expect(电话格验("", null)).resolves.toBeUndefined();
    await expect(电话格验("138 0000 1111")).resolves.toBeUndefined();
    await expect(电话格验("sqin17548955941")).rejects.toThrow(电话夹字母话);
    await expect(电话格验("13800001111（微信同号）", "13800001111")).rejects.toThrow(电话带字话);
  });
});

describe("普通导入（③ lib/import/plan）", () => {
  const 表 = 字段表(DEFAULT_BUSINESS);
  const 排 = (csv: string) => {
    const { 表头, 数据 } = 成表(解析CSV(csv));
    return 摊开({ 表头, 数据, 映射: 猜列(表头, 表), 字段表: 表 });
  };
  it("号码和字母连着写：不截数字当电话，这格挪到微信、原文进备注，这行照常导入（同企业导入 M-导入-56/57）；带说明的照旧号码取出、原文并进备注", () => {
    const [甲, 乙] = 排("姓名,手机号\n张三,sqin17548955941\n李四,13800000002（微信同号）");
    expect(甲.值.phone).toBeUndefined();
    expect(甲.值.wechat).toBe("sqin17548955941");
    expect(甲.值.remark).toContain("手机号：sqin17548955941");
    expect(甲.问题.find((q) => q.字段 === "phone")).toMatchObject({ 严重: "照收", 说法: expect.stringContaining("像微信号") });
    expect(甲.进不了).toBeUndefined();
    expect(乙.值.phone).toBe("13800000002");
    expect(乙.问题.find((q) => q.字段 === "phone")).toMatchObject({ 严重: "照收", 说法: expect.stringContaining("原文并进备注") });
    expect(乙.值.remark).toContain("13800000002（微信同号）");
  });

  it("号码格夹字母的几种写法：带「微信：」前缀取后半段；号码和微信两段的号当电话、那段进微信；表里另有微信列的不覆盖", () => {
    const [甲, 乙, 丙] = 排("姓名,手机号\n张三,微信：sqin17548955941\n李四,13800000003 / wxid_a13800001111\n王五,138O0001111");
    expect(甲).toMatchObject({ 值: { wechat: "sqin17548955941" } });
    expect(甲.进不了).toBeUndefined();
    expect(甲.值.remark).toContain("手机号：微信：sqin17548955941");
    expect(乙.值).toMatchObject({ phone: "13800000003", wechat: "wxid_a13800001111" });
    expect(乙.进不了).toBeUndefined();
    expect(乙.值.remark).toContain("手机号：13800000003 / wxid_a13800001111");
    expect(丙.值.wechat).toBe("138O0001111");
    expect(丙.进不了).toBeUndefined();
    const 外贸 = 字段表({ ...DEFAULT_BUSINESS, template: "trade" });
    const { 表头, 数据 } = 成表(解析CSV("姓名,电话,微信\n赵六,sqin17548955941,zhao6"));
    const [丁] = 摊开({ 表头, 数据, 映射: 猜列(表头, 外贸), 字段表: 外贸 });
    expect(丁.值.wechat).toBe("zhao6");
    expect(丁.值.remark).toContain("sqin17548955941");
    expect(丁.进不了).toBeUndefined();
  });
});

describe("企业导入（④ ⑤ enterprise-import/clean）", () => {
  const m: 映射 = {
    列: { customer: { 外部: "id", 名称: "name", 负责人: "owner", 电话: "phone" } },
    负责人: { 示例销售: "u-1" },
    值: { 阶段: {}, 线索状态: {}, 跟进类型: {}, 跟进状态: {} },
    默认负责人Id: "u-1",
  };
  let 序 = 0;
  const 条 = (电话: string): 原始记录 => ({ 实体: "customer", 外部ID: `S${++序}`, 字段: { 负责人: "示例销售", 名称: `示例${序}`, 电话 }, 行号: 序 + 1, 出处: "客户.xlsx" });
  const 洗 = (电话: string) => {
    const r = 清洗([条(电话)], m);
    return { 值: r.待写[0].值, 话: r.问题.map((p) => p.说明).join("\n") };
  };

  it("单段带说明：号码照收，原文进备注、报告里说一句（原来说明悄悄丢了）", () => {
    const { 值, 话 } = 洗("13800001111（微信同号）");
    expect(值.phone).toBe("13800001111");
    expect(String(值.remark)).toContain("电话原文：13800001111（微信同号）");
    expect(话).toContain("按 13800001111 导入");
  });

  it("单段号码和字母连着写、前后带别的字：不截数字当电话，原样进备注、报告里说", () => {
    const { 值, 话 } = 洗("Tel sqin17548955941");
    expect(值.phone).toBe("");
    expect(String(值.remark)).toContain("电话：Tel sqin17548955941");
    expect(话).toContain("没截里面的数字当电话");
  });

  it("一格多段：哪段带说明，整格原文也进备注；粘字母的那段按微信，不截数字", () => {
    const 甲 = 洗("13800001111（微信同号）/13900002222");
    expect(甲.值.phone).toBe("13800001111");
    expect(String(甲.值.remark)).toContain("另一个电话：13900002222");
    expect(String(甲.值.remark)).toContain("电话原文：13800001111（微信同号）/13900002222");
    const 乙 = 洗("13800001111 / sqin17548955941");
    expect(乙.值).toMatchObject({ phone: "13800001111", wechat: "sqin17548955941" });
    expect(乙.话).toContain("像微信号");
    // 纯号码的几段照旧，不多塞原文
    const 丙 = 洗("13800001111/13900002222");
    expect(String(丙.值.remark ?? "")).not.toContain("电话原文");
  });
});

describe("导入联系人格拆人（⑥ enterprise-import/excel）", () => {
  it("号码和字母连着写的那段不拆：原样当名字，标出来；正常的照旧拆", () => {
    expect(拆人格("张三 wx:sqin17548955941")).toEqual([{ 名: "张三 wx:sqin17548955941", 电话: [], 邮箱: [], 粘字母: true }]);
    expect(拆人格("李四 138-0000-0002；王五 wxid_a13900000003")).toEqual([
      { 名: "李四", 电话: ["13800000002"], 邮箱: [] },
      { 名: "王五 wxid_a13900000003", 电话: [], 邮箱: [], 粘字母: true },
    ]);
  });
  it("拆联系人：有这种格就在联系人表的提醒里说一句", () => {
    const t: 读出的表 = { 名: "客户.csv", 实体: "customer", 表头: ["客户名称", "联系人"], 行: [["甲公司", "张三 wx:sqin17548955941"]], 行号: [2], 提醒: [] };
    const [, 人] = 拆联系人(t);
    expect(人.提醒.join("\n")).toContain("1 格号码和字母连着写");
    expect(人.行[0]).toContain("张三 wx:sqin17548955941");
  });
});

describe("AI 卡金额（⑦ 认金额）", () => {
  it("「1万」「2.5万」「¥1,234」认得出；负数、「约5万」认不出（不再删掉符号存成别的数）；导入那边是同一个", () => {
    expect(认金额("1万")).toBe(10000);
    expect(认金额("2.5万")).toBe(25000);
    expect(认金额("¥1,234")).toBe(1234);
    expect(认金额("-500")).toBeNull();
    expect(认金额("约5万")).toBeNull();
    expect(导入认金额).toBe(认金额);
  });
});
