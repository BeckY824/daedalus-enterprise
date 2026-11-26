/**
 * 公海的撤销领取 / 撤销分配只撤「我自己刚才那一下」（2026-10-28 越权排查，接 ent-undo-owner-scope）：
 *   撤销提示条把 原负责人（每位领取前归谁）传回服务端。原来只认「现在还归我、不在公海、原负责人在职」，
 *   业务员把自己名下的客户当「刚领的」撤、原负责人填成同事，就能绕过交接把客户塞到同事名下（再放回公海）。
 *   现在负责人真换过的还要对上换负责人记录（lib/owner-log-db.ts 是我刚换的）。
 *   - 伪造撤销领取：不动，不进公海，不写撤销记录
 *   - 真领的照常撤：还给原负责人、放回公海
 *   - 老板撤自己的分配照常；另一位老板撤不了（那一下不是他做的）
 *   - 只认 30 分钟内的那一下（2026-10-28 审查）：隔了半小时以上的领取 / 分配撤不了
 *   - 负责人没换过的（分给原负责人）认领取记录：主管填 给谁 = 负责人，塞不进从没进过公海的客户；真分的照常撤
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "ADMIN", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
// 撤销放进公海发「回到你名下」通知那一刻，操作日志里有没有「撤销了刚才的放进公海」（小修 1126-g 第 2 条）
const 通知时 = vi.hoisted(() => ({ 日志数: [] as number[] }));
vi.mock("@/lib/enterprise/notice-sources", async (原) => {
  const m = await 原<typeof import("@/lib/enterprise/notice-sources")>();
  return {
    ...m,
    客户撤销放回通知: async (...a: Parameters<typeof m.客户撤销放回通知>) => {
      const { prisma: db } = await import("@/lib/prisma");
      通知时.日志数.push(await db.auditLog.count({ where: { summary: { startsWith: "撤销了刚才的放进公海" } } }));
      return m.客户撤销放回通知(...a);
    },
  };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting } from "@/lib/settings";
import { 无负责人占位邮箱 } from "@/lib/pool";
import { 放进公海, 领取, 分配公海, 撤销公海 } from "@/app/(app)/customers/pool-actions";

type 人 = { id: string; role: string };
let 老板: 人, 老板二: 人, 组长: 人, 小王: 人, 小李: 人;
let 号 = 0;

async function 建(email: string, role: string): Promise<人> {
  const u = await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } });
  return { id: u.id, role };
}
const 当 = (p: 人) => { mocks.user = { ...mocks.user, id: p.id, role: p.role, name: p.id }; };
// 企业版客户没有电话（E-260）：号记在主要联系人上（放回公海查联系方式按联系人的号判）
const 客户 = (salesOwnerId: string) =>
  prisma.customer.create({ data: { name: `客户${++号}`, phone: "", salesOwnerId, contacts: { create: { name: `联系人${号}`, phone: `1390000${String(号).padStart(4, "0")}`, isPrimary: true } } } });
const 归谁 = async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id } })).salesOwnerId;
const 在公海 = async (id: string) => (await prisma.customerPool.count({ where: { customerId: id } })) > 0;
const 占位 = async () => (await prisma.user.findUniqueOrThrow({ where: { email: 无负责人占位邮箱 } })).id;
const 原负责人记录 = async (customerId: string) => (await prisma.customerOwnerLog.findFirst({ where: { customerId, kind: "pool-release" }, orderBy: { at: "desc" } }))?.fromOwnerId;
const 撤销记录数 = (customerId: string) => prisma.customerOwnerLog.count({ where: { customerId, kind: "undo" } });
/** 把这位客户的换负责人记录往前挪 分钟 分钟（模拟「隔了一阵子才撤」） */
const 记录挪到 = async (customerId: string, 分钟: number) => {
  const at = new Date(Date.now() - 分钟 * 60_000);
  await prisma.customerOwnerLog.updateMany({ where: { customerId }, data: { at } });
  await prisma.customerClaim.updateMany({ where: { customerId }, data: { at } });
};

beforeEach(async () => {
  await resetDb();
  号 = 0;
  老板 = await 建("boss", "ADMIN");
  老板二 = await 建("boss2", "ADMIN");
  组长 = await 建("lead", "MANAGER");
  小王 = await 建("wang", "SALES");
  小李 = await 建("li", "SALES");
  await prisma.entMember.createMany({
    data: [
      { userId: 老板.id, bizRole: "director" },
      { userId: 老板二.id, bizRole: "director" },
      { userId: 组长.id, bizRole: "sales_mgr" },
      { userId: 小王.id, managerId: 组长.id },
      { userId: 小李.id, managerId: 组长.id },
    ],
  });
  当(老板);
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("enterprise.rule.org_scope", true);
});
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { await prisma.$disconnect(); });

/** 一位都没撤成（不在撤销范围：不归这人了、过了时限、不是这一下领 / 换的）：ok:false 说清为什么，撤销条不报「已撤销」（复审 11-26 M1） */
const 撤不了 = (动作: "领取" | "分配") => ({ ok: false, error: `这位${动作 === "分配" ? "已经不归分到的人、不是你刚才分的" : "已经不归你"}、原负责人已停用或过了撤销时限，这次没有撤销` });

describe("公海撤销只撤自己刚才那一下", () => {
  it("业务员拿自己的客户伪造撤销领取：不还给同事、不进公海、不写撤销记录", async () => {
    const c = await 客户(小王.id);
    const t = await prisma.task.create({ data: { title: "回电", customerId: c.id, ownerId: 小王.id } });
    当(小王);
    const r = await 撤销公海("领取", [{ id: c.id, 值: 小李.id }], { 计划: [], 待办: [t.id], 商机: [], 项目: [] });
    expect(r).toEqual(撤不了("领取"));
    expect(await 归谁(c.id)).toBe(小王.id);
    expect(await 在公海(c.id)).toBe(false);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).ownerId).toBe(小王.id);
    expect(await 撤销记录数(c.id)).toBe(0);
  });

  it("真从公海领的照常撤：回到公海、负责人清空，原负责人记录还在（M-公海-03、P-撤销-01）", async () => {
    const c = await 客户(小李.id);
    当(小李);
    expect(await 放进公海([c.id], "客户主动终止")).toMatchObject({ ok: true, updated: 1 });
    当(小王);
    const r = await 领取([c.id]);
    if (!r.ok) throw new Error(r.error);
    expect(await 归谁(c.id)).toBe(小王.id);
    expect(await 撤销公海("领取", r.原负责人!, r.带过来)).toMatchObject({ ok: true, updated: 1 });
    expect(await 归谁(c.id)).toBe(await 占位());
    expect(await 在公海(c.id)).toBe(true);
    expect(await 原负责人记录(c.id)).toBe(小李.id);
    expect(await 撤销记录数(c.id)).toBe(0);
  });

  it("老板撤自己的分配照常；另一位老板拿同样的数据撤不了", async () => {
    const c = await 客户(小李.id);
    当(小李);
    await 放进公海([c.id], "客户主动终止");
    当(老板);
    const r = await 分配公海([c.id], 小王.id);
    if (!r.ok) throw new Error(r.error);
    当(老板二);
    expect(await 撤销公海("分配", r.原负责人!, r.带过来, 小王.id)).toEqual(撤不了("分配"));
    expect(await 归谁(c.id)).toBe(小王.id);
    当(老板);
    expect(await 撤销公海("分配", r.原负责人!, r.带过来, 小王.id)).toMatchObject({ ok: true, updated: 1 });
    expect(await 归谁(c.id)).toBe(await 占位());
    expect(await 在公海(c.id)).toBe(true);
    expect(await 原负责人记录(c.id)).toBe(小李.id);
  });

  it("只认 30 分钟内的那一下：31 分钟前领的撤不了，不还、不进公海、不写撤销记录", async () => {
    const c = await 客户(小李.id);
    当(小李);
    await 放进公海([c.id], "客户主动终止");
    当(小王);
    const r = await 领取([c.id]);
    if (!r.ok) throw new Error(r.error);
    await 记录挪到(c.id, 31);
    expect(await 撤销公海("领取", r.原负责人!, r.带过来)).toEqual(撤不了("领取"));
    expect(await 归谁(c.id)).toBe(小王.id);
    expect(await 在公海(c.id)).toBe(false);
    expect(await 撤销记录数(c.id)).toBe(0);
  });

  it("31 分钟前的分配老板也撤不了", async () => {
    const c = await 客户(小李.id);
    当(小李);
    await 放进公海([c.id], "客户主动终止");
    当(老板);
    const r = await 分配公海([c.id], 小王.id);
    if (!r.ok) throw new Error(r.error);
    await 记录挪到(c.id, 31);
    expect(await 撤销公海("分配", r.原负责人!, r.带过来, 小王.id)).toEqual(撤不了("分配"));
    expect(await 归谁(c.id)).toBe(小王.id);
  });
  it("负责人没换过的：主管填 给谁 = 负责人，塞不进从没进过公海的客户", async () => {
    const c = await 客户(小李.id);
    当(组长);
    expect(await 撤销公海("分配", [{ id: c.id, 值: 小李.id }], undefined, 小李.id)).toEqual(撤不了("分配"));
    expect(await 在公海(c.id)).toBe(false);
    expect(await 撤销记录数(c.id)).toBe(0);
  });

  it("分给原负责人的照常撤：放回公海；31 分钟前的撤不了", async () => {
    const c = await 客户(小李.id);
    当(小李);
    await 放进公海([c.id], "客户主动终止");
    当(老板);
    const r = await 分配公海([c.id], 小李.id);
    if (!r.ok) throw new Error(r.error);
    expect(await 撤销公海("分配", r.原负责人!, r.带过来, 小李.id)).toMatchObject({ ok: true, updated: 1 });
    expect(await 在公海(c.id)).toBe(true);
    const r2 = await 分配公海([c.id], 小李.id);
    if (!r2.ok) throw new Error(r2.error);
    await 记录挪到(c.id, 31);
    expect(await 撤销公海("分配", r2.原负责人!, r2.带过来, 小李.id)).toEqual(撤不了("分配"));
    expect(await 在公海(c.id)).toBe(false);
  });
});

/**
 * 撤销放进公海也照领取 / 分配的口径（复审 11-26 M1）：一位都没撤成回 ok:false + 原因，撤销条不再报「已撤销」；
 * 撤成一部分带 有没撤成 + 整句提示。原来放进这一支照旧回 ok:true, updated:0，客户早被人领走了界面还说「已撤销」
 */
describe("撤销放进公海：没撤成的要说出来", () => {
  it("放进去之后被同事领走了：一位都没撤成，ok:false 说清原因，客户还归领走的人", async () => {
    const c = await 客户(小李.id);
    当(小李);
    expect(await 放进公海([c.id], "客户主动终止")).toMatchObject({ ok: true, updated: 1 });
    当(小王);
    expect(await 领取([c.id])).toMatchObject({ ok: true, updated: 1 });
    当(小李);
    expect(await 撤销公海("放进", [{ id: c.id, 值: "" }])).toEqual({ ok: false, error: "这位已经被人领走或分走了，这次没有撤销" });
    expect(await 归谁(c.id)).toBe(小王.id);
  });

  /*
    A 标签页已经撤回了，B 标签页再点撤销（PR 472 审查第 3 条）：原来走「不在公海」报「被人领走或分走了」、ok:false。
    其实是自己刚才撤回的：算撤成、说「刚才已经撤回了」（同撤销领取 / 分配的已撤回）
  */
  it("放进公海 → 撤销 → 再撤销：第二次说「这位刚才已经撤回了」，算撤成", async () => {
    const c = await 客户(小李.id);
    当(小李);
    expect(await 放进公海([c.id], "客户主动终止")).toMatchObject({ ok: true, updated: 1 });
    expect(await 撤销公海("放进", [{ id: c.id, 值: "" }])).toEqual({ ok: true, updated: 1, unchanged: 0, 没权限: 0 });
    expect(await 撤销公海("放进", [{ id: c.id, 值: "" }])).toEqual({ ok: true, updated: 0, unchanged: 0, 没权限: 0, 已撤回: 1, 提示: "这位刚才已经撤回了" });
    expect(await 归谁(c.id)).toBe(小李.id);
    expect(await 在公海(c.id)).toBe(false);
  });

  it("撤销放进公海：操作日志先记、再发通知（另一个标签页同时撤时按日志认已撤回，窗口缩小，小修 1126-g 第 2 条）", async () => {
    const c = await 客户(小李.id);
    当(小李);
    await 放进公海([c.id], "客户主动终止");
    通知时.日志数.length = 0;
    expect(await 撤销公海("放进", [{ id: c.id, 值: "" }])).toMatchObject({ ok: true, updated: 1 });
    expect(通知时.日志数).toEqual([1]);
  });

  it("批量再撤销：撤回之后动没动过按每位自己的撤回时刻比，合成一次查后照旧（小修 1126-g 第 2 条）", async () => {
    const a = await 客户(小李.id);
    const b = await 客户(小李.id);
    const d = await 客户(小李.id);
    当(小李);
    await 放进公海([a.id, b.id, d.id], "客户主动终止");
    expect(await 撤销公海("放进", [{ id: a.id, 值: "" }])).toMatchObject({ ok: true, updated: 1 });
    expect(await 撤销公海("放进", [b, d].map((x) => ({ id: x.id, 值: "" })))).toMatchObject({ ok: true, updated: 2 });
    // a 那条撤销日志挪到 10 分钟前；a 撤回之后（5 分钟前）有一条领取记录 → a 算动过；
    // b 的换负责人记录也在 5 分钟前，但在 b 自己撤回（刚才）之前 → b 仍算已撤回
    const 分前 = (n: number) => new Date(Date.now() - n * 60_000);
    await prisma.auditLog.updateMany({ where: { summary: { startsWith: "撤销了刚才的放进公海：1 位" } }, data: { at: 分前(10) } });
    await prisma.customerClaim.create({ data: { customerId: a.id, userId: 小王.id, at: 分前(5) } });
    await prisma.customerOwnerLog.create({ data: { customerId: b.id, userId: 小王.id, fromOwnerId: 小李.id, toOwnerId: 小李.id, at: 分前(5) } });
    expect(await 撤销公海("放进", [a, b, d].map((x) => ({ id: x.id, 值: "" })))).toEqual({
      ok: true, updated: 0, unchanged: 1, 没权限: 0, 已撤回: 2, 有没撤成: true,
      提示: "2 位刚才已经撤回了；1 位已经被人领走或分走了，这次没有撤销",
    });
  });

  // 小修 1126-g 第 3 条：判法只认领取 / 换负责人两张表。市场分配、离职交接、超时自动转、撤回交接换负责人不写换负责人记录，
  // 撤回之后被这几条路换走的，照样认成已撤回（只影响那句话，不写库）。钉住现状，改判法时这条要跟着改
  it("判法局限：撤回之后负责人被不写换负责人记录的路换走，照样说刚才已经撤回了、不动负责人", async () => {
    const c = await 客户(小李.id);
    当(小李);
    await 放进公海([c.id], "客户主动终止");
    expect(await 撤销公海("放进", [{ id: c.id, 值: "" }])).toMatchObject({ ok: true, updated: 1 });
    await prisma.customer.update({ where: { id: c.id }, data: { salesOwnerId: 小王.id } });
    expect(await 撤销公海("放进", [{ id: c.id, 值: "" }])).toEqual({ ok: true, updated: 0, unchanged: 0, 没权限: 0, 已撤回: 1, 提示: "这位刚才已经撤回了" });
    expect(await 归谁(c.id)).toBe(小王.id);
    expect(await 在公海(c.id)).toBe(false);
  });

  it("撤回之后又放进公海、被同事领走了：再撤销照旧说被人领走", async () => {
    const c = await 客户(小李.id);
    当(小李);
    await 放进公海([c.id], "客户主动终止");
    expect(await 撤销公海("放进", [{ id: c.id, 值: "" }])).toMatchObject({ ok: true, updated: 1 });
    await 放进公海([c.id], "客户主动终止");
    当(小王);
    expect(await 领取([c.id])).toMatchObject({ ok: true, updated: 1 });
    当(小李);
    expect(await 撤销公海("放进", [{ id: c.id, 值: "" }])).toEqual({ ok: false, error: "这位已经被人领走或分走了，这次没有撤销" });
    expect(await 归谁(c.id)).toBe(小王.id);
  });

  it("撤销条的撤回不认别人的操作日志：同事撤回过同一位，不算我撤回的", async () => {
    const c = await 客户(小李.id);
    当(小李);
    await 放进公海([c.id], "客户主动终止");
    await 撤销公海("放进", [{ id: c.id, 值: "" }]);
    当(小王);
    expect(await 撤销公海("放进", [{ id: c.id, 值: "" }])).toEqual({ ok: false, error: "这位已经被人领走或分走了，这次没有撤销" });
  });

  it("批量退回公海后的撤销条再点一次：两位都说已撤回，算撤成", async () => {
    const a = await 客户(小李.id);
    const b = await 客户(小李.id);
    当(小李);
    expect(await 放进公海([a.id, b.id], "客户主动终止")).toMatchObject({ ok: true, updated: 2 });
    const 原 = [{ id: a.id, 值: "" }, { id: b.id, 值: "" }];
    expect(await 撤销公海("放进", 原)).toEqual({ ok: true, updated: 2, unchanged: 0, 没权限: 0 });
    expect(await 撤销公海("放进", 原)).toEqual({ ok: true, updated: 0, unchanged: 0, 没权限: 0, 已撤回: 2, 提示: "2 位刚才已经撤回了" });
  });

  it("批量里撤成、已撤回、被领走混着：撤成的照撤，拼成一句、带 有没撤成", async () => {
    const a = await 客户(小李.id);
    const b = await 客户(小李.id);
    const d = await 客户(小李.id);
    当(小李);
    expect(await 放进公海([a.id, b.id, d.id], "客户主动终止")).toMatchObject({ ok: true, updated: 3 });
    expect(await 撤销公海("放进", [{ id: a.id, 值: "" }])).toMatchObject({ ok: true, updated: 1 });
    当(小王);
    await 领取([b.id]);
    当(小李);
    expect(await 撤销公海("放进", [a, b, d].map((x) => ({ id: x.id, 值: "" })))).toEqual({
      ok: true, updated: 1, unchanged: 1, 没权限: 0, 已撤回: 1, 有没撤成: true,
      提示: "已撤销 1 位；1 位刚才已经撤回了；1 位已经被人领走或分走了，这次没有撤销",
    });
    expect(await 归谁(a.id)).toBe(小李.id);
    expect(await 归谁(b.id)).toBe(小王.id);
    expect(await 归谁(d.id)).toBe(小李.id);
    expect(await 在公海(d.id)).toBe(false);
  });

  it("过了撤销时限：还在公海里，ok:false 说过了时限", async () => {
    const c = await 客户(小李.id);
    当(小李);
    await 放进公海([c.id], "客户主动终止");
    await prisma.customerPool.updateMany({ where: { customerId: c.id }, data: { at: new Date(Date.now() - 31 * 60_000) } });
    expect(await 撤销公海("放进", [{ id: c.id, 值: "" }])).toEqual({ ok: false, error: "这位过了撤销时限或不是你放进公海的，这次没有撤销" });
    expect(await 在公海(c.id)).toBe(true);
  });

  it("两位里一位被领走：撤成的照撤，带 有没撤成 + 整句提示", async () => {
    const a = await 客户(小李.id);
    const b = await 客户(小李.id);
    当(小李);
    expect(await 放进公海([a.id, b.id], "客户主动终止")).toMatchObject({ ok: true, updated: 2 });
    当(小王);
    await 领取([b.id]);
    当(小李);
    expect(await 撤销公海("放进", [{ id: a.id, 值: "" }, { id: b.id, 值: "" }])).toEqual({
      ok: true, updated: 1, unchanged: 1, 没权限: 0, 有没撤成: true, 提示: "已撤销 1 位；1 位已经被人领走或分走了，这次没有撤销",
    });
    expect(await 归谁(a.id)).toBe(小李.id);
    expect(await 在公海(a.id)).toBe(false);
    expect(await 归谁(b.id)).toBe(小王.id);
  });

  /*
    批量里有没放的（本来就在公海、被拦下的）：放进公海 回 放了（这次真放进去的那几位），撤销条只拿它们撤（复审 M1）。
    原来撤销按勾选的全部撤，没放的那几位落进「没撤成」，撤销条按出错样式报「被人领走 / 过了时限」
  */
  it("批量里一位已在公海、一位没权限：放了 只有真放的那位，按它撤干净，不报没撤成", async () => {
    const 放的 = await 客户(小李.id);
    const 已在 = await 客户(小王.id);
    const 别人的 = await 客户(小王.id);
    当(小王);
    await 放进公海([已在.id], "客户主动终止");
    当(小李);
    const r = await 放进公海([放的.id, 已在.id, 别人的.id], "客户主动终止");
    expect(r).toMatchObject({ ok: true, updated: 1, unchanged: 1, 没权限: 1, 放了: [放的.id] });
    if (!r.ok) throw new Error("没放成");
    expect(await 撤销公海("放进", r.放了!.map((id) => ({ id, 值: "" })))).toEqual({ ok: true, updated: 1, unchanged: 0, 没权限: 0 });
    expect(await 归谁(放的.id)).toBe(小李.id);
    expect(await 在公海(已在.id)).toBe(true);
    expect(await 归谁(别人的.id)).toBe(小王.id);
  });

  it("勾选里有 30 分钟内我自己放进去的那位：这次没放他，撤销不把他一起拿回来", async () => {
    const 早放 = await 客户(小李.id);
    const 这次 = await 客户(小李.id);
    当(小李);
    await 放进公海([早放.id], "客户主动终止");
    const r = await 放进公海([早放.id, 这次.id], "客户主动终止");
    expect(r).toMatchObject({ ok: true, updated: 1, unchanged: 1, 放了: [这次.id] });
    if (!r.ok) throw new Error("没放成");
    expect(await 撤销公海("放进", r.放了!.map((id) => ({ id, 值: "" })))).toMatchObject({ ok: true, updated: 1 });
    expect(await 在公海(早放.id)).toBe(true);
    expect(await 在公海(这次.id)).toBe(false);
  });
});
