/**
 * 重复咨询第一步 · 出口 C（lib/enterprise/repeat-inquiry.ts、customers/repeat-inquiry-actions.ts）：
 *   - 市场成员查号码撞上同事名下的客户：负责人能接指定分配时 查号码 带 出口C（按钮），框数据给负责人名、渠道、有没有撞上的联系人
 *   - 建：客户 = 撞上的那位、负责人 = 客户负责人、创建人 = 市场成员、渠道 = 这次选的、分配方式 = 指定分配、标「老客户重复咨询」；
 *     记一条算数的分配记录（计入负责人本月已分）、进线索验证、沟通记在新线索上（记录人 = 市场成员）；客户的负责人、来源、联系人、旧项目不改
 *   - 线跟负责人走（E-213）：负责人是外贸，新线索、流转线、分配记录都是外贸
 *   - 撞号台账记「新建线索」，不计入预警
 *   - 不给的：不是市场成员、负责人暂停参与分配、负责人是市场成员、客户在公海；框打开后换了负责人 = 作废；负责人到持有上限 = 一行不写
 *   - 对接人：挂号码撞上的那位（不改他）或新建一位（不设主联系人）
 *   - 同事客户的名称不露给市场成员：项目名「重复咨询-客户编号」、成功的话只说转给负责人跟进；项目列表里也看不到客户名
 *   - 防重复提交：同一客户、同一发起人 10 分钟内已建过就认那一条，不再建、不再计数
 *   - 详情「其他在推项目」不算回收站里的
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "t", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 自动分配不参与key, 本月已分 } from "@/lib/enterprise/lead-assign";
import { 超时转生效key } from "@/lib/enterprise/reply-overdue";
import { 默认组织规则 } from "@/lib/project/org-rules";
import { 查号码 } from "@/app/(app)/customers/number-actions";
import { 出口C建线索, 出口C框数据 } from "@/app/(app)/customers/repeat-inquiry-actions";
import type { 查重领取沟通 } from "@/app/(app)/customers/pool-actions";
import { 不是市场成员出口C话, 出口C作废话, 负责人接不了话, 负责人到上限话, 客户其他在推项目, 出口C已转话 } from "@/lib/enterprise/repeat-inquiry";
import { 读项目列表 } from "@/lib/project/list";
import { 以谁的身份 } from "@/lib/enterprise/visibility";
import { 重复咨询来源 } from "@/lib/project/system-created";

type 人 = { id: string; name: string };
let 总管: 人, 市场: 人, 市场管: 人, 外贸甲: 人, 乙: 人;
let 老渠道: string, 新渠道: string;
let 进池 = 0;
async function 造人(key: string, name: string, bizRole: string, line?: string): Promise<人> {
  const u = await prisma.user.create({ data: { email: `${key}@x`, name, title: "", role: "SALES", password: "x", createdAt: new Date(Date.UTC(2026, 0, 1 + ++进池)) } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, ...(line ? { line } : {}) } });
  return { id: u.id, name };
}
const 当 = (u: 人) => { mocks.user = { ...mocks.user, id: u.id, name: u.name }; };

let 序 = 0;
/** 同事名下的客户：来源老渠道，主联系人王经理手机就是查的号；名下一条在推的旧项目 */
async function 同事客户(owner: string): Promise<{ id: string; 号: string; 王: string; 旧: string }> {
  序 += 1;
  const 号 = `1390000${String(序).padStart(4, "0")}`;
  const c = await prisma.customer.create({ data: { name: `老客户${序}`, phone: 号, salesOwnerId: owner, channelId: 老渠道, attributionChannelId: 老渠道, customerNo: 序 } });
  const 王 = await prisma.contact.create({ data: { name: "王经理", position: "采购", phone: 号, isPrimary: true, customerId: c.id } });
  const 旧 = await prisma.project.create({ data: { name: `旧项目${序}`, customerId: c.id, ownerId: owner, creatorId: owner, phase: "商机", node: "明确需求", channelId: 老渠道 } });
  return { id: c.id, 号, 王: 王.id, 旧: 旧.id };
}
const 沟通 = (补: Partial<查重领取沟通> = {}): 查重领取沟通 => ({ type: "PHONE", content: "老客户来电问新一期报价", occurredAt: "2026-11-20 10:00", ...补 });
/** 一行不写：客户名下还是只有旧项目、没有分配记录、没有沟通 */
async function 没动(customerId: string) {
  expect(await prisma.project.count({ where: { customerId } })).toBe(1);
  expect(await prisma.entLeadAssign.count()).toBe(0);
  expect(await prisma.followUp.count({ where: { customerId } })).toBe(0);
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  总管 = await 造人("boss", "总管某", "director");
  市场 = await 造人("mkt", "渠运某", "channel_ops");
  市场管 = await 造人("mktm", "市管某", "marketing_mgr");
  外贸甲 = await 造人("jia", "外贸甲某", "sales", "外贸");
  乙 = await 造人("yi", "销售乙某", "sales", "内贸");
  await setSetting("business", { projectMode: true });
  await setSetting(规则.线索分配.key, true);
  await setSetting(自动分配不参与key, { [总管.id]: "禁止" });
  await setSetting(超时转生效key, "2020-01-01T00:00:00.000Z");
  invalidateSettingsCache();
  老渠道 = (await prisma.channel.create({ data: { name: "展会|首次", channelOwnerId: 总管.id } })).id;
  新渠道 = (await prisma.channel.create({ data: { name: "小红书|笔记", channelOwnerId: 总管.id } })).id;
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("出口 C：在负责人名下新建线索", () => {
  it("市场成员查号码撞上同事客户：给按钮；框数据给负责人名、渠道、撞上的联系人", async () => {
    const c = await 同事客户(外贸甲.id);
    当(市场);
    expect(await 查号码("手机号", c.号)).toMatchObject({ ok: true, 状态: "重复", 出口C: { 负责人名: 外贸甲.name } });
    const 框 = await 出口C框数据("手机号", c.号);
    expect(框).toMatchObject({ ok: true, 负责人名: 外贸甲.name, 有撞上的联系人: true });
    if (框.ok) expect(框.渠道们.some((x) => x.id === 新渠道)).toBe(true);
    // 市场管理也能用
    当(市场管);
    expect(await 查号码("手机号", c.号)).toMatchObject({ 出口C: { 负责人名: 外贸甲.name } });
  });

  it("建：负责人名下、市场成员建、这次的渠道、指定分配、带标记；计入本月已分、进线索验证、沟通记在新线索上；线跟负责人（外贸）；客户和旧项目不改", async () => {
    const c = await 同事客户(外贸甲.id);
    const 客户前 = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
    const 联系人前 = await prisma.contact.findMany({ where: { customerId: c.id }, orderBy: { id: "asc" } });
    当(市场);
    const r = await 出口C建线索("手机号", c.号, 沟通(), { 渠道: 新渠道, 对接人: { 撞上的: true }, 负责人名: 外贸甲.name });
    if (!r.ok) throw new Error(r.error);
    expect(r).toEqual({ ok: true, 提示: 出口C已转话(外贸甲.name), 负责人: 外贸甲.name });
    expect(r.提示).not.toMatch(/老客户|重复咨询-/);

    const p = await prisma.project.findFirstOrThrow({ where: { customerId: c.id, id: { not: c.旧 } } });
    expect(p).toMatchObject({
      name: `重复咨询-NO.${String(序).padStart(5, "0")}`,
      ownerId: 外贸甲.id, creatorId: 市场.id, channelId: 新渠道, source: 重复咨询来源,
      phase: "线索", node: "线索验证", result: null, pooledAt: null, bizLine: "外贸", flowLine: "外贸", contactId: c.王, assignMode: "指定分配",
    });
    const 记 = await prisma.entLeadAssign.findFirstOrThrow({ where: { projectId: p.id } });
    expect(记).toMatchObject({ toUserId: 外贸甲.id, fromUserId: 市场.id, byUserId: 市场.id, kind: "营销", counted: true, line: "外贸", way: "指定分配" });
    expect(await 本月已分(外贸甲.id)).toBe(1);
    // 对接人挂撞上的王经理、他的信息不改
    expect(await prisma.contact.findMany({ where: { customerId: c.id }, orderBy: { id: "asc" } })).toEqual(联系人前);
    // 沟通记在新线索上、记录人是市场成员
    const 跟 = await prisma.followUp.findMany({ where: { customerId: c.id }, include: { projectNode: true } });
    expect(跟).toHaveLength(1);
    expect(跟[0]).toMatchObject({ ownerId: 市场.id, content: "老客户来电问新一期报价" });
    expect(跟[0].projectNode?.projectId).toBe(p.id);
    // 通知负责人（指定分配那一种）、话里带「重复线索」的提示
    const 通知 = await prisma.entNotice.findMany({ where: { userId: 外贸甲.id, kind: "分配" } });
    expect(通知).toHaveLength(1);
    expect(通知[0]).toMatchObject({ link: `/projects/${p.id}`, body: expect.stringContaining("线索验证时选「重复线索」") });
    // 客户负责人、来源不改；旧项目不动
    const 客户后 = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
    expect([客户后.salesOwnerId, 客户后.channelId, 客户后.attributionChannelId]).toEqual([客户前.salesOwnerId, 客户前.channelId, 客户前.attributionChannelId]);
    expect(await prisma.project.findUniqueOrThrow({ where: { id: c.旧 } })).toMatchObject({ ownerId: 外贸甲.id, phase: "商机", node: "明确需求", result: null });
    // 撞号台账：记「新建线索」，不计入预警
    const 台账 = await prisma.entDupeHit.findMany({ where: { customerId: c.id } });
    expect(台账.map((x) => x.result)).toContain("新建线索");
    expect(台账.every((x) => x.warnTier === 0)).toBe(true);
  });

  it("同事客户的名称不露给市场成员（按组织看客户开着、他看不到这位客户）：项目列表里有这条线索（名字是重复咨询-编号），客户名一处都没有", async () => {
    await setSetting(规则.按组织看客户.key, true);
    invalidateSettingsCache();
    忘掉企业版范围();
    const c = await 同事客户(外贸甲.id);
    当(市场);
    const r = await 出口C建线索("手机号", c.号, 沟通(), { 渠道: 新渠道, 对接人: { 撞上的: true }, 负责人名: 外贸甲.name });
    if (!r.ok) throw new Error(r.error);
    expect(JSON.stringify(r)).not.toContain("老客户");
    const me = { id: 市场.id, name: 市场.name, email: "mkt@x", role: "SALES", title: "" };
    const 列表 = JSON.stringify(await 以谁的身份(市场.id, () => 读项目列表(me as never, { pageSize: "100" })));
    expect(列表).toContain("重复咨询-NO.");
    expect(列表).not.toContain("老客户");
  });

  it("防重复提交：同一客户、同一人 10 分钟内再交（两个标签页）= 认第一条，不再建、不再计数、沟通只记一条", async () => {
    const c = await 同事客户(外贸甲.id);
    当(市场);
    const 交 = () => 出口C建线索("手机号", c.号, 沟通(), { 渠道: 新渠道, 对接人: { 撞上的: true }, 负责人名: 外贸甲.name });
    const [一, 二] = [await 交(), await 交()];
    expect(一).toMatchObject({ ok: true });
    expect(二).toEqual(一);
    expect(await prisma.project.count({ where: { customerId: c.id } })).toBe(2);
    expect(await prisma.entLeadAssign.count()).toBe(1);
    expect(await 本月已分(外贸甲.id)).toBe(1);
    expect(await prisma.followUp.count({ where: { customerId: c.id } })).toBe(1);
    // 10 分钟以后再来：是新的一次咨询，照建
    await prisma.project.updateMany({ where: { customerId: c.id, id: { not: c.旧 } }, data: { createdAt: new Date(Date.now() - 11 * 60_000) } });
    expect(await 交()).toMatchObject({ ok: true });
    expect(await prisma.project.count({ where: { customerId: c.id } })).toBe(3);
    expect(await 本月已分(外贸甲.id)).toBe(2);
  });

  it("新的对接人：在客户下新建一位（不设主联系人），只挂在新线索上", async () => {
    const c = await 同事客户(乙.id);
    当(市场);
    const r = await 出口C建线索("手机号", c.号, 沟通(), { 渠道: 新渠道, 对接人: { 名字: "赵工", 职务: "技术" }, 负责人名: 乙.name });
    if (!r.ok) throw new Error(r.error);
    const 赵 = await prisma.contact.findFirstOrThrow({ where: { customerId: c.id, name: "赵工" } });
    expect(赵.isPrimary).toBe(false);
    const p = await prisma.project.findFirstOrThrow({ where: { customerId: c.id, id: { not: c.旧 } } });
    expect(p).toMatchObject({ bizLine: "内贸", contactId: 赵.id });
  });

  it("不是市场成员：没按钮、交了也拒", async () => {
    const c = await 同事客户(外贸甲.id);
    当(乙);
    const 查 = await 查号码("手机号", c.号);
    expect(查).toMatchObject({ ok: true, 状态: "重复" });
    expect(查).not.toHaveProperty("出口C");
    expect(await 出口C建线索("手机号", c.号, 沟通(), { 渠道: 新渠道, 对接人: { 撞上的: true } })).toEqual({ ok: false, error: 不是市场成员出口C话 });
    await 没动(c.id);
  });

  it("负责人接不了指定分配（暂停参与分配、负责人是市场成员）：没按钮、交了也拒", async () => {
    const c = await 同事客户(外贸甲.id);
    await setSetting(自动分配不参与key, { [总管.id]: "禁止", [外贸甲.id]: "暂停" });
    invalidateSettingsCache();
    当(市场);
    expect(await 查号码("手机号", c.号)).not.toHaveProperty("出口C");
    expect(await 出口C建线索("手机号", c.号, 沟通(), { 渠道: 新渠道, 对接人: { 撞上的: true } })).toEqual({ ok: false, error: 负责人接不了话 });
    await 没动(c.id);

    const d = await 同事客户(市场管.id);
    expect(await 查号码("手机号", d.号)).not.toHaveProperty("出口C");
  });

  it("客户在公海：不走出口 C", async () => {
    const c = await 同事客户(外贸甲.id);
    await prisma.customerPool.create({ data: { customerId: c.id, userId: 外贸甲.id, reason: "手动" } });
    当(市场);
    expect(await 查号码("手机号", c.号)).not.toHaveProperty("出口C");
    expect(await 出口C建线索("手机号", c.号, 沟通(), { 渠道: 新渠道, 对接人: { 撞上的: true } })).toEqual({ ok: false, error: 出口C作废话 });
  });

  it("框打开后客户换了负责人：这次作废，一行不写", async () => {
    const c = await 同事客户(外贸甲.id);
    当(市场);
    await prisma.customer.update({ where: { id: c.id }, data: { salesOwnerId: 乙.id } });
    expect(await 出口C建线索("手机号", c.号, 沟通(), { 渠道: 新渠道, 对接人: { 撞上的: true }, 负责人名: 外贸甲.name })).toEqual({ ok: false, error: 出口C作废话 });
    expect(await prisma.entLeadAssign.count()).toBe(0);
    expect(await prisma.followUp.count({ where: { customerId: c.id } })).toBe(0);
  });

  it("渠道、沟通必填：缺了一行不写", async () => {
    const c = await 同事客户(外贸甲.id);
    当(市场);
    expect((await 出口C建线索("手机号", c.号, 沟通(), { 对接人: { 撞上的: true } })).ok).toBe(false);
    expect((await 出口C建线索("手机号", c.号, 沟通({ content: "  " }), { 渠道: 新渠道, 对接人: { 撞上的: true } })).ok).toBe(false);
    await 没动(c.id);
  });

  it("负责人到了持有上限：一行不写，话里不带别人的持有数", async () => {
    const c = await 同事客户(外贸甲.id);
    await setSetting("orgRules", { ...默认组织规则, 公海: { ...默认组织规则.公海, 持有上限开: true, 默认上限: 10, 每人上限: { [外贸甲.id]: 1 } } });
    invalidateSettingsCache();
    当(市场);
    const r = await 出口C建线索("手机号", c.号, 沟通(), { 渠道: 新渠道, 对接人: { 撞上的: true } });
    expect(r).toEqual({ ok: false, error: 负责人到上限话(外贸甲.name) });
    expect(负责人到上限话(外贸甲.name)).not.toMatch(/\d/);
    await 没动(c.id);
  });
});

describe("撞号台账：「新建线索」不计入预警次数", () => {
  it("同一人 7 天内先前两次都是新建线索：第三次查不触发第一档；两次是拦截的照旧触发", async () => {
    const 早 = new Date(Date.now() - 3600_000);
    const 台账 = (customerId: string, 号: string, owner: string, result: string) =>
      prisma.entDupeHit.createMany({ data: [0, 1].map(() => ({ userId: 市场.id, keyType: "手机号", keyValue: 号, customerId, ownerId: owner, result, createdAt: 早 })) });
    const c = await 同事客户(外贸甲.id);
    const d = await 同事客户(乙.id);
    await 台账(c.id, c.号, 外贸甲.id, "新建线索");
    await 台账(d.id, d.号, 乙.id, "拦截");
    当(市场);
    await 查号码("手机号", c.号);
    await 查号码("手机号", d.号);
    const 新行 = async (customerId: string) => (await prisma.entDupeHit.findFirstOrThrow({ where: { customerId, createdAt: { gt: 早 } } })).warnTier;
    expect(await 新行(c.id)).toBe(0);
    expect(await 新行(d.id)).toBe(1);
  });
});

describe("项目详情：这位客户其他在推的项目", () => {
  it("我负责的给名字，同事负责的只给个数；结束的、公海里的、回收站里的、这一条自己都不算", async () => {
    const c = await 同事客户(外贸甲.id);
    const 我的 = await prisma.project.create({ data: { name: "甲的另一条", customerId: c.id, ownerId: 外贸甲.id, creatorId: 外贸甲.id, phase: "线索", node: "潜客培育" } });
    await prisma.project.create({ data: { name: "乙的", customerId: c.id, ownerId: 乙.id, creatorId: 乙.id, phase: "线索", node: "潜客培育" } });
    await prisma.project.create({ data: { name: "丢了的", customerId: c.id, ownerId: 外贸甲.id, creatorId: 外贸甲.id, phase: "商机", node: "共识方案", result: "丢单" } });
    await prisma.project.create({ data: { name: "公海里的", customerId: c.id, ownerId: "", creatorId: 外贸甲.id, phase: "线索", node: "潜客培育", pooledAt: new Date() } });
    await prisma.project.create({ data: { name: "回收站里的", customerId: c.id, ownerId: 外贸甲.id, creatorId: 外贸甲.id, phase: "线索", node: "潜客培育", deletedAt: new Date() } });
    const r = await 客户其他在推项目(外贸甲.id, 我的.id, c.id);
    expect(r.我的.map((x) => x.id)).toEqual([c.旧]);
    expect(r.我的[0].name).toMatch(/^旧项目/);
    expect(r.同事的).toBe(1);
    // 乙看：自己那条给名字，甲的两条只给个数
    const 乙看 = await 客户其他在推项目(乙.id, 我的.id, c.id);
    expect([乙看.我的.map((x) => x.name), 乙看.同事的]).toEqual([["乙的"], 1]);
  });
});

