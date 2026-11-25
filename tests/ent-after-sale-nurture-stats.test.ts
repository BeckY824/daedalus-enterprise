/**
 * 后售培育阶段 2：数据页统计拆行（11-25，客户 E-292 选 A；总表 P-界面-65；方案-售后回访与后售培育 第六节「2 统计拆行」、第十节第 1、5 条）。
 *   - 「各进程的项目」和线索瀑布里，潜客培育后面多一行后售培育（没有也摆 0）；潜客培育那行只数不是后售的
 *   - 现在 / 一段两边：潜客 + 后售 = 改前的潜客培育；公海（退回公海）、判无效、没判无效（线索流失）、领走的历史四组各自也是
 *   - 结束在潜客培育的（线索流失 / 判无效）也按客户那一片落到后售那行
 *   - 仅记录用、历史分析回填的照旧两行都不算
 *   - 阶段、按人、结局、公海、四段漏斗（线索→商机→订单→交付）、线索转商机、外币不拆、数不变
 * 「改前」= 同一批项目，把那个交付结清的项目挪到一位名下没有别的项目的客户上（没人是后售），其余一格不动。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/enterprise/switch", () => ({ 企业版: () => true }));

import { prisma } from "@/lib/prisma";
import { 看已删 } from "@/lib/enterprise/soft-delete-core";
import { resetDb } from "./reset";
import { 项目现在, 项目一段, 线索节点of, 统计节点们, type 项目现在 as 现在, type 线索节点格 } from "../src/app/(app)/overview/project-stats";
import { 后售培育名, 企业版字典 } from "@/lib/project/stage-dict";
import { 仅记录用来源, 历史分析来源 } from "@/lib/project/system-created";

let 王: string, 李: string, 后客: string, 新客: string, 空客: string, 交付结清: string;
let 序 = 0;

const 建 = (customerId: string, o: Record<string, unknown> = {}) =>
  prisma.project.create({ data: { name: `项目${++序}`, customerId, ownerId: 王, creatorId: 王, phase: "线索", node: "潜客培育", ...o } });

/** 每位客户名下一样的一套：潜客培育的（在推、公海、判无效、流失、领走的历史分析、仅记录用、公海里的历史分析），另带线索验证、商机各一个 */
async function 一套(c: string) {
  await 建(c);
  await 建(c, { pooledAt: new Date() });
  const 判 = await 建(c, { result: "线索流失", closedAt: new Date() });
  await prisma.entLeadVerify.create({ data: { projectId: 判.id, finalResult: "无效线索" } });
  await 建(c, { result: "线索流失", closedAt: new Date() });
  await 建(c, { source: 历史分析来源, ownerId: 李 });
  await 建(c, { source: 仅记录用来源 });
  await 建(c, { source: 历史分析来源, pooledAt: new Date() });
  await 建(c, { node: "线索验证" });
  await 建(c, { phase: "商机", node: "痛点挖掘", amount: 100 });
}

const 年 = () => {
  const y = new Date().getFullYear();
  return { from: new Date(y, 0, 1), to: new Date(y, 11, 31, 23, 59, 59, 999) };
};
const 行 = (rs: readonly 线索节点格[], node: string) => rs.find((r) => r.node === node)!;
const 四样 = (r: 线索节点格) => [r.count, r.流失, r.判无效, r.退回公海];
const 节 = (数: 现在, node: string) => 数.节点.find((n) => n.phase === "线索" && n.node === node)!;
/** 改后的潜客 + 后售，各格加起来 */
const 合 = (rs: readonly 线索节点格[]) => 四样(行(rs, "潜客培育")).map((v, i) => v + 四样(行(rs, 后售培育名))[i]);
/** 把交付结清挪走 = 改前（没人是后售） */
const 挪走 = () => prisma.project.update({ where: { id: 交付结清 }, data: { customerId: 空客 } });

beforeEach(async () => {
  await resetDb();
  王 = (await prisma.user.create({ data: { email: "w@t", password: "x", name: "王", role: "SALES" } })).id;
  李 = (await prisma.user.create({ data: { email: "l@t", password: "x", name: "李", role: "SALES" } })).id;
  const 客 = (name: string, phone: string) => prisma.customer.create({ data: { name, phone, salesOwnerId: 王 } }).then((c) => c.id);
  后客 = await 客("老客户甲", "13900000001");
  新客 = await 客("新客户乙", "13900000002");
  空客 = await 客("别的客户丙", "13900000003");
  await 一套(后客);
  await 一套(新客);
  交付结清 = (await 建(后客, { phase: "订单", node: "尾款结算", result: "交付结清", amount: 500, closedAt: new Date() })).id;
});
afterAll(async () => void (await prisma.$disconnect()));

describe("统计节点们 / 线索节点of（纯函数）", () => {
  it("线索阶段潜客培育后面插后售培育，别的阶段不动；后售的行数进后售那行，没有也摆 0", () => {
    expect(统计节点们("线索", 企业版字典)).toEqual(["潜客培育", 后售培育名, "线索验证", "线索推进"]);
    expect(统计节点们("商机", 企业版字典)).toEqual([...企业版字典.节点们.商机]);
    const r = 线索节点of([
      { phase: "线索", node: "潜客培育", result: null, 后售: true },
      { phase: "线索", node: "潜客培育", result: "线索流失", 后售: true },
      { phase: "线索", node: "潜客培育", result: null },
    ], 企业版字典);
    expect(r.map((x) => [x.node, ...四样(x)])).toEqual([["潜客培育", 1, 0, 0, 0], [后售培育名, 1, 1, 0, 0], ["线索验证", 0, 0, 0, 0], ["线索推进", 0, 0, 0, 0]]);
    expect(线索节点of([], 企业版字典).map((x) => x.node)).toContain(后售培育名);
  });
});

describe("现在", () => {
  it("去掉拆行会红：客户有交付结清时后售培育那行 = 1、潜客培育那行少 1", async () => {
    const 后 = await 项目现在("CNY");
    await 挪走();
    const 前 = await 项目现在("CNY");
    // 在推、不在公海：老客户甲 那个 + 领走的历史分析（李）那个
    expect([节(后, "潜客培育").count, 节(后, 后售培育名).count]).toEqual([2, 2]);
    expect([节(前, "潜客培育").count, 节(前, 后售培育名).count]).toEqual([4, 0]);
    expect(四样(行(后.线索节点, 后售培育名))).toEqual([1, 1, 1, 1]);
    expect(四样(行(后.线索节点, "潜客培育"))).toEqual([1, 1, 1, 1]);
  });

  it("潜客 + 后售 = 改前潜客：节点那行；瀑布四格（停着、流失 = 没判无效、判无效、退回公海 = 公海）各自；领走的历史那组", async () => {
    const 后 = await 项目现在("CNY");
    // 领走的历史分析单看：李只有那两个（老客户甲、新客户乙各一），一个落后售、一个落潜客
    const 李后 = await 项目现在("CNY", 李);
    await 挪走();
    const 前 = await 项目现在("CNY");
    const 李前 = await 项目现在("CNY", 李);
    expect([节(李后, "潜客培育").count, 节(李后, 后售培育名).count]).toEqual([1, 1]);
    expect(节(李前, "潜客培育").count).toBe(2);
    expect(节(后, "潜客培育").count + 节(后, 后售培育名).count).toBe(节(前, "潜客培育").count);
    expect(合(后.线索节点)).toEqual(四样(行(前.线索节点, "潜客培育")));
    expect(四样(行(前.线索节点, 后售培育名))).toEqual([0, 0, 0, 0]);
    // 别的节点、阶段那排、按人、结局、公海、四段漏斗、线索转商机、外币一格不变
    const 不拆 = (d: 现在) => ({ ...d, 节点: d.节点.filter((n) => n.node !== "潜客培育" && n.node !== 后售培育名), 线索节点: d.线索节点.filter((n) => n.node !== "潜客培育" && n.node !== 后售培育名) });
    expect(不拆(后)).toEqual(不拆(前));
  });

  it("只看一个人：同样拆、同样加得回去；公海的照旧不算在谁头上", async () => {
    const 后 = await 项目现在("CNY", 王);
    await 挪走();
    const 前 = await 项目现在("CNY", 王);
    expect([节(后, "潜客培育").count, 节(后, 后售培育名).count]).toEqual([1, 1]);
    expect(节(前, "潜客培育").count).toBe(2);
    expect(合(后.线索节点)).toEqual(四样(行(前.线索节点, "潜客培育")));
    expect(后.阶段).toEqual(前.阶段);
    expect(后.按人).toEqual(前.按人);
  });

  it("仅记录用、历史分析（公海里的）两行都不算；交付结清软删了 / 只是旧名成功交付", async () => {
    // 老客户甲再添一个仅记录用、一个公海里的历史分析：两行都不动
    const 先 = await 项目现在("CNY");
    await 建(后客, { source: 仅记录用来源 });
    await 建(后客, { source: 历史分析来源, pooledAt: new Date() });
    const 添 = await 项目现在("CNY");
    expect(添.节点).toEqual(先.节点);
    expect(添.线索节点).toEqual(先.线索节点);
    // 旧名成功交付照样算（同 after-sale.ts 交付结清的项目）
    await prisma.project.update({ where: { id: 交付结清 }, data: { result: "成功交付" } });
    expect(节(await 项目现在("CNY"), 后售培育名).count).toBe(2);
    // 软删了就不算（进回收站 = deletedAt 有值）：回到潜客培育
    await prisma.project.update({ where: { id: 交付结清 }, data: { deletedAt: new Date() } });
    expect(await 看已删(() => prisma.project.count({ where: { id: 交付结清 } }))).toBe(1);
    const 删 = await 项目现在("CNY");
    expect([节(删, "潜客培育").count, 节(删, 后售培育名).count]).toEqual([4, 0]);
  });
});

describe("一段", () => {
  it("瀑布拆后售那行、加得回去（判无效、流失跟着拆）；新建、漏斗、走势、按人、转商机都不变", async () => {
    const { from, to } = 年();
    const 后 = await 项目一段(from, to, "month", "CNY");
    await 挪走();
    const 前 = await 项目一段(from, to, "month", "CNY");
    expect(合(后.线索节点)).toEqual(四样(行(前.线索节点, "潜客培育")));
    expect(四样(行(前.线索节点, 后售培育名))).toEqual([0, 0, 0, 0]);
    // 老客户甲那套里结束在潜客培育的（判无效一个、流失一个）落在后售那行
    const 后售 = 行(后.线索节点, 后售培育名);
    expect([后售.流失, 后售.判无效]).toEqual([1, 1]);
    expect(后售.count).toBeGreaterThan(0);
    const 不拆 = (d: typeof 后) => ({ ...d, 线索节点: d.线索节点.filter((n) => n.node !== "潜客培育" && n.node !== 后售培育名) });
    expect(不拆(后)).toEqual(不拆(前));
  });

  it("只看一个人：一样加得回去", async () => {
    const { from, to } = 年();
    const 后 = await 项目一段(from, to, "month", "CNY", 王);
    await 挪走();
    const 前 = await 项目一段(from, to, "month", "CNY", 王);
    expect(合(后.线索节点)).toEqual(四样(行(前.线索节点, "潜客培育")));
    expect(后.合计).toEqual(前.合计);
    expect(后.漏斗).toEqual(前.漏斗);
  });
});
