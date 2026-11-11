/**
 * 全站币种 · 第 2 块（2026-10-03）：商机 / 签约存币种，各处合计按币种分开、不换汇。
 *   - 存：saveContract 收 currency；不给用本位币；编辑不给就不动；认不得的拦（商机的保存入口 2026-11-11 删了，企业版走不到）
 *   - 签约：外币留到分（ContractMoney.amountExact），Contract.amount 照旧写整数
 *   - 查重：同日同额要**同币种**才算可能重复
 *   - 合计：数据页回看只算一种币、给切换；AI 问数据按币种分行；建议卡带币种
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "我", email: "me@local", role: "ADMIN", title: "管理员", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 造本人, 造客户 } from "./r2-data-helpers";
import { saveContract, listContractLinks } from "@/app/(app)/customers/actions";
import { 加载复盘 } from "@/app/(app)/overview/data";
import { runQuery } from "@/lib/report-run";
import { buildProposal, describeProposal } from "@/lib/agent/proposals";
import { 签约合计 } from "@/lib/money-db";
import { 合并合计, 币种符号 } from "@/lib/currency";
import { 金额格式 } from "@/lib/money-input";
import { invalidateSettingsCache } from "@/lib/settings";
import { DEFAULT_BUSINESS } from "@/lib/business-config";

let 我: string;
beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  我 = (await 造本人()).id;
  mocks.user = { ...mocks.user, id: 我 };
});
afterAll(async () => { await prisma.$disconnect(); });

/** 造一个带币种的商机（直接写库：商机的保存入口 2026-11-11 删了） */
const 商机 = (customerId: string, currency: string) =>
  prisma.opportunity.create({ data: { name: "询盘", customerId, amount: 1000, stage: "初步沟通", status: "OPEN", probability: 20, ownerId: 我, money: { create: { currency } } } });

describe("纯函数", () => {
  it("金额框：小数只在整数部分加千分位（原来 1234.5678 会写成 1,234.5,678）", () => {
    const 失焦 = { userTyping: false, input: "" };
    expect(金额格式(1234.5678, 失焦)).toBe("1,234.5678");
    expect(金额格式(3250.5, 失焦)).toBe("3,250.5");
    expect(金额格式(1000000, 失焦)).toBe("1,000,000");
  });

  it("合并合计 / 币种符号", () => {
    const 合 = 合并合计([{ 币种: "USD", 合计: 100 }], [{ 币种: "USD", 合计: 50 }, { 币种: "EUR", 合计: 20 }]);
    expect(合).toEqual([{ 币种: "USD", 合计: 150 }, { 币种: "EUR", 合计: 20 }]);
    expect(币种符号("CNY")).toBe("¥");
    expect(币种符号("USD")).toContain("$");
    expect(币种符号("EUR")).toBe("€");
  });

  it("签约合计：有精确值用精确值，老签约（没有币种行）算人民币", () => {
    expect(签约合计([
      { amount: 3251, money: { currency: "USD", amountExact: 3250.5 } },
      { amount: 100, money: { currency: "USD", amountExact: null } },
      { amount: 19800 },
    ])).toEqual([{ 币种: "CNY", 合计: 19800 }, { 币种: "USD", 合计: 3350.5 }]);
  });
});

describe("签约存币种和精确金额", () => {
  it("美元带分：精确值进 ContractMoney，Contract.amount 写四舍五入的整数", async () => {
    const c = await 造客户(我);
    const r = await saveContract({ customerId: c.id, amount: 3250.5, currency: "USD", signedAt: new Date(), remark: null });
    expect(r.ok).toBe(true);
    const k = await prisma.contract.findFirstOrThrow({ include: { money: true } });
    expect(k.amount).toBe(3251);
    expect(k.money).toMatchObject({ currency: "USD", amountExact: 3250.5 });
  });

  it("查重要同币种：同一天 US$ 100 和 ¥ 100 不是同一笔；同币种同额才弹确认，回来的金额带币种", async () => {
    const c = await 造客户(我);
    const 今天 = new Date();
    expect((await saveContract({ customerId: c.id, amount: 100, currency: "USD", signedAt: 今天, remark: null })).ok).toBe(true);
    expect((await saveContract({ customerId: c.id, amount: 100, currency: "CNY", signedAt: 今天, remark: null })).ok).toBe(true);
    const 又一笔 = await saveContract({ customerId: c.id, amount: 100, currency: "USD", signedAt: 今天, remark: null });
    expect(又一笔.ok).toBe(false);
    expect("duplicate" in 又一笔 && 又一笔.duplicate).toMatchObject({ amount: 100, currency: "USD" });
  });

  it("编辑不给币种：查重按原来的币种比，存完币种也不变", async () => {
    const c = await 造客户(我);
    await saveContract({ customerId: c.id, amount: 200, currency: "EUR", signedAt: new Date(), remark: null });
    const k = await prisma.contract.findFirstOrThrow();
    const r = await saveContract({ id: k.id, customerId: c.id, amount: 210, signedAt: new Date(), remark: "改了" });
    expect(r.ok).toBe(true);
    expect((await prisma.contractMoney.findUniqueOrThrow({ where: { contractId: k.id } })).currency).toBe("EUR");
  });

  it("登记签约弹窗列的商机带币种（勾上时币种跟着带）", async () => {
    const c = await 造客户(我);
    await 商机(c.id, "GBP");
    const r = await listContractLinks(c.id);
    expect(r.商机.map((o) => o.currency)).toEqual(["GBP"]);
  });
});

describe("数据页回看：只算一种币，给切换", () => {
  async function 两种币() {
    const c = await 造客户(我);
    const 今天 = new Date();
    await saveContract({ customerId: c.id, amount: 19800, currency: "CNY", signedAt: 今天, remark: null });
    await saveContract({ customerId: c.id, amount: 3000, currency: "USD", signedAt: 今天, remark: null });
    await saveContract({ customerId: c.id, amount: 250.5, currency: "USD", signedAt: 今天, remark: "尾款" });
  }
  const 本月 = () => {
    const n = new Date();
    return [new Date(n.getFullYear(), n.getMonth(), 1), new Date(n.getFullYear(), n.getMonth() + 1, 1)] as const;
  };

  it("默认看本位币；币种们列出每种各签了多少", async () => {
    await 两种币();
    const [from, to] = 本月();
    const r = await 加载复盘(from, to, "day", { 本位币: "CNY" });
    expect(r.币种).toBe("CNY");
    expect(r.total).toEqual({ amount: 19800, count: 1 });
    expect(r.币种们).toEqual([{ 币种: "CNY", 合计: 19800 }, { 币种: "USD", 合计: 3250.5 }]);
  });

  it("选了美元：总额、笔数、趋势都只算美元，金额用精确值", async () => {
    await 两种币();
    const [from, to] = 本月();
    const r = await 加载复盘(from, to, "day", { 想看: "USD", 本位币: "CNY" });
    expect(r.币种).toBe("USD");
    expect(r.total).toEqual({ amount: 3250.5, count: 2 });
    expect(r.trend.reduce((s, t) => s + t.amount, 0)).toBe(3250.5);
  });

  it("想看的币这一段没有、本位币也没有：看签得最多的那种，不给一页空的", async () => {
    const c = await 造客户(我);
    await saveContract({ customerId: c.id, amount: 500, currency: "EUR", signedAt: new Date(), remark: null });
    const [from, to] = 本月();
    const r = await 加载复盘(from, to, "day", { 想看: "JPY", 本位币: "CNY" });
    expect(r.币种).toBe("EUR");
    expect(r.total.amount).toBe(500);
  });
});

describe("AI 问数据 / 建议卡 / 转介绍", () => {
  it("签约金额按币种分行；只有一种币时行名不加后缀", async () => {
    const c = await 造客户(我);
    await saveContract({ customerId: c.id, amount: 19800, currency: "CNY", signedAt: new Date(), remark: null });
    const 一种 = await runQuery({ metric: "contract_amount", groupBy: null, from: null, to: null }, DEFAULT_BUSINESS);
    expect(一种).toEqual([{ label: "全部", value: 19800, currency: "CNY" }]);
    await saveContract({ customerId: c.id, amount: 3250.5, currency: "USD", signedAt: new Date(), remark: null });
    const 两种 = await runQuery({ metric: "contract_amount", groupBy: null, from: null, to: null }, DEFAULT_BUSINESS);
    expect(两种).toEqual([
      { label: "全部（CNY）", value: 19800, currency: "CNY" },
      { label: "全部（USD）", value: 3250.5, currency: "USD" },
    ]);
  });

  it("建议卡：currency 认得就收，空用本位币，认不得报错；描述里金额带币种", () => {
    const 客户 = { id: "c1", name: "Acme" };
    const b = { ...DEFAULT_BUSINESS, currency: "USD" };
    const 签 = buildProposal("p1", "add_contract", 客户, { amount: 3200, signedAt: "2026-10-03", reason: "邮件确认了" }, b);
    expect(签.ok && 签.proposal).toMatchObject({ kind: "add_contract", currency: "USD" });
    if (签.ok) expect(describeProposal(签.proposal, "客户")).toContain("US$ 3,200");
    const 欧 = buildProposal("p2", "add_contract", 客户, { amount: 100, currency: "eur", signedAt: "2026-10-03", reason: "询盘" }, b);
    expect(欧.ok && 欧.proposal).toMatchObject({ currency: "EUR" });
    const 坏 = buildProposal("p3", "add_contract", 客户, { amount: 1, currency: "美刀", signedAt: "2026-10-03", reason: "x" }, b);
    expect(坏.ok).toBe(false);
  });
});
