/**
 * 重复咨询第一步 · 出口 C（lib/enterprise/repeat-inquiry.ts、customers/repeat-inquiry-actions.ts）：
 *   - 市场成员查号码撞上同事名下的客户：负责人能接指定分配时 查号码 带 出口C（按钮），框数据给负责人名、渠道、有没有撞上的联系人
 *   - 建：客户 = 撞上的那位、负责人 = 客户负责人、创建人 = 市场成员、渠道 = 这次选的、分配方式 = 指定分配、标「老客户重复咨询」；
 *     记一条算数的分配记录（计入负责人本月已分）、进线索验证、沟通记在新线索上（记录人 = 市场成员）；客户的负责人、来源、联系人、旧项目不改
 *   - 线跟负责人走（E-213）：负责人是外贸，新线索、流转线、分配记录都是外贸
 *   - 撞号台账记「新建线索」，不计入预警
 *   - 不给的：不是市场成员、客户在公海；框打开后换了负责人 = 作废；负责人到持有上限 = 一行项目不写、照挑不到人收尾（见下）
 *   - 交销售（客户 E-213 第一节 2、3 问取 A，E-218 二②）：负责人接不了指定分配（暂停 / 禁止、停用离职、不是销售）= 同一个事务里先挑人，
 *     线索直接建在挑中的销售名下（不经过市场成员名下），记自动分配、计入本月已分、进线索验证；客户不动（负责人是市场成员的也不算市场转客户）；
 *     不过「分配方式谁能用」（系统分）；挑不到人（都暂停 / 禁止、都满额、这条线没人、规则「线索分配」关着）= 整笔不建，市场成员看不到客户名、指派不了；
 *     照 P-转-38 提醒能分配的人：撞号台账记「没人接：原因」，这条线的销售管理 + 系统管理员收通知（编号、渠道、沟通摘要，不带客户名；规则关着只发系统管理员）；
 *     框打开时就挑不到：框照开、先说清。事务里挑中的人刚满额 = 顺延下一位（顺延到没人 = 同样没建）；有判无效待补的先补发（不计数、补位用掉）；
 *     没建回 { ok: true, 没建: true }（不是失败）；通知 key 按客户 + 发起人 + 10 分钟一格，同一人隔几分钟再交不重复提醒；
 *     线判不出两条线的销售管理都收；发起人自己不收，去掉他一个不剩 = 「请找销售管理」；规则关着正文建议打开规则或手动处理
 *   - 项目列表按原始客户编号命中那一支：短纯数字（「2024」）不触发（看成客户编号严，共用的 看成客户编号 不变）；销售用编号搜不到他看不到的同事的重复咨询线索
 *   - 没有选人：交了 ownerId / 接手人之类的参数也不认，负责人由系统定（E-218 二①）
 *   - 命名加序（E-218）：同一位客户第 2 次起「-2」「-3」，序号读只读字段 repeatSeq（含回收站、已结束的），改名不影响；(原始客户, 序号) 唯一；
 *     序号只给出口 C 记：查重领取建的记原始客户、序号空（不占号、领几次都不撞索引）
 *   - 只读来源字段：编辑项目改不了 source / repeatOfCustomerId / repeatSeq；改了名标记还在；详情给「原始客户编号 + 第几次」
 *   - 对接人：挂号码撞上的那位（不改他）或新建一位（不设主联系人）
 *   - 同事客户的名称不露给市场成员：项目名「重复咨询-客户编号」、成功的话只说转给负责人跟进；项目列表里也看不到客户名
 *   - 防重复提交：同一客户、同一发起人 10 分钟内已建过就认那一条，不再建、不再计数；只认出口 C 自己建的（之前查重领取建的同标记线索不算）
 *   - 详情「其他在推项目」不算回收站里的
 *   - 「未建线索」待补建记录（P-公海-15 后半）：挑不到人 / 负责人到持有上限整笔没建时，撞号台账那一行存客户编号、渠道、对接人、沟通、原因、通知了谁、交的人和时间，不写客户名
 *   - 主路径负责人到持有上限（用户 11-23）：照挑不到人处理——不建、待补建记录、通知这条线的销售管理和系统管理员（规则关着只发系统管理员），框打开就说
 *   - 负责人是销售管理：走主路径（指定分配）；两边同时交序号撞了唯一索引：整笔回滚重来，最多 3 次
 *   - 三态照现状（E-213 第一节 1）：建新线索、进线索验证、终判、那条沟通都重开倒计时；额度只认那条有效沟通回满
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "t", role: "SALES", title: "", avatar: null as string | null } }));
/** 序号撞号：还要撞几次（出口 C 建线索时，先在同一个事务里用同一个号连写两行，抛真的唯一约束错，模拟两边同时交读到同一个最大号） */
const 撞号 = vi.hoisted(() => ({ 次: 0, 撞了: 0 }));
vi.mock("@/lib/enterprise/dedupe-claim", async (原) => {
  const m = await 原<typeof import("@/lib/enterprise/dedupe-claim")>();
  const 建: typeof m.查重领取建线索项目 = async (tx, a) => {
    if (撞号.次 > 0 && typeof a.项目名 === "function") {
      撞号.次 -= 1;
      撞号.撞了 += 1;
      const 序 = await m.重复咨询下一序号(tx, a.customerId);
      for (const name of ["同时交的那笔", "这一笔"]) {
        await tx.project.create({ data: { name, customerId: a.customerId, ownerId: a.接手人, creatorId: a.创建人, source: "repeat-inquiry", repeatOfCustomerId: a.customerId, repeatSeq: 序 } });
      }
    }
    return m.查重领取建线索项目(tx, a);
  };
  return { ...m, 查重领取建线索项目: 建 };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma, defaultClient } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 自动分配不参与key, 本月已分, 不设配额key, 月份 } from "@/lib/enterprise/lead-assign";
import { 超时转生效key } from "@/lib/enterprise/reply-overdue";
import { 默认组织规则 } from "@/lib/project/org-rules";
import { 查号码 } from "@/app/(app)/customers/number-actions";
import { 出口C建线索, 出口C框数据 } from "@/app/(app)/customers/repeat-inquiry-actions";
import type { 查重领取沟通 } from "@/app/(app)/customers/pool-actions";
import { 不是市场成员出口C话, 出口C作废话, 负责人到上限话, 负责人到上限预告话, 负责人到上限为什么, 客户其他在推项目, 出口C已转话, 出口C已转过话, 出口C交销售已分话, 出口C项目名, 重复咨询原始客户, 出口C没人接话, 出口C没人接预告话, 规则关着为什么, 待补建没写成话, 待补建没写成交的人话 } from "@/lib/enterprise/repeat-inquiry";
import { 查重领取 } from "@/app/(app)/customers/pool-actions";
import { 读项目详情 } from "@/app/(app)/projects/[id]/load";
import { 分配谁能用key, 分配方式id } from "@/lib/enterprise/assign-use";
import { 读项目列表 } from "@/lib/project/list";
import { 分配线索, 项目分配线, 分配带走的项目 } from "@/app/(app)/leads/assign-actions";
import { 公海项目市场转 } from "@/lib/enterprise/market-transfer";
import { 读组织 } from "@/lib/enterprise/org";
import { 是系统管理员of } from "@/lib/enterprise/org-core";
import { 线索初判Action, 编辑项目 } from "@/app/(app)/projects/actions";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { 以谁的身份 } from "@/lib/enterprise/visibility";
import { 重复咨询来源 } from "@/lib/project/system-created";
import { 看成客户编号, 看成客户编号严 } from "@/lib/customer-no";
import { 读未建线索, type 未建线索记录 } from "@/lib/enterprise/dupe-ledger";
import { 默认三态规则 } from "@/lib/project/org-rules";
import { 三态夜扫 } from "@/lib/enterprise/tri-state-db";
import { 读一位三态 } from "@/lib/enterprise/tri-state-hold";
import { 加天 } from "@/lib/enterprise/tri-state";
import { beijingDay } from "@/lib/business-clock";

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
    // 按组织看客户开着（正式库的样子）：市场成员看不到同事的客户、联系人、项目，事务里照样写得进（3703 实操查出节点没推、对接人报删了）
    await setSetting(规则.按组织看客户.key, true);
    invalidateSettingsCache();
    忘掉企业版范围();
    const c = await 同事客户(外贸甲.id);
    const 客户前 = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
    const 联系人前 = await prisma.contact.findMany({ where: { customerId: c.id }, orderBy: { id: "asc" } });
    当(市场);
    // 带上市场成员的身份跑（限定层按它收）
    // 没有选人（E-218 二①）：交了 ownerId / 接手人 / toUserId 也不认，负责人照客户现负责人写
    const 夹带 = { 渠道: 新渠道, 对接人: { 撞上的: true }, 负责人名: 外贸甲.name, ownerId: 乙.id, 负责人: 乙.id, 接手人: 乙.id, toUserId: 乙.id };
    const r = await 以谁的身份(市场.id, () => 出口C建线索("手机号", c.号, 沟通(), 夹带 as never));
    if (!r.ok) throw new Error(r.error);
    expect(r).toEqual({ ok: true, 提示: 出口C已转话(外贸甲.name), 负责人: 外贸甲.name });
    expect(r.提示).not.toMatch(/老客户|重复咨询-/);

    const p = await prisma.project.findFirstOrThrow({ where: { customerId: c.id, id: { not: c.旧 } } });
    expect(p).toMatchObject({
      name: `重复咨询-NO.${String(序).padStart(5, "0")}`,
      ownerId: 外贸甲.id, creatorId: 市场.id, channelId: 新渠道, source: 重复咨询来源,
      phase: "线索", node: "线索验证", result: null, pooledAt: null, bizLine: "外贸", flowLine: "外贸", contactId: c.王, assignMode: "指定分配",
      repeatOfCustomerId: c.id, repeatSeq: 1,
    });
    expect(await 本月已分(乙.id)).toBe(0);
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
    // 负责人在线索验证面板里判得了：判无效（原因重复线索）交复核
    当(外贸甲);
    忘掉企业版范围();
    const 判 = await 以谁的身份(外贸甲.id, () => 线索初判Action(p.id, "无效", { invalidReason: "重复线索" }));
    expect(判).toMatchObject({ ok: true });
    expect(await prisma.entLeadVerify.findUniqueOrThrow({ where: { projectId: p.id } })).toMatchObject({ verdict: "初验无效", invalidReason: "重复线索" });
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
    expect(二).toEqual({ ok: true, 提示: 出口C已转过话(外贸甲.name, 10), 负责人: 外贸甲.name });
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

  it("防重复提交只认出口 C 自己建的：同一人 10 分钟内先查重领取了这位公海客户（同样带标记），再走出口 C 照建", async () => {
    // 公海客户：原负责人外贸甲，领了按区域（139 → 内贸）自动分给乙
    const c = await 同事客户(外贸甲.id);
    await prisma.customerPool.create({ data: { customerId: c.id, userId: 外贸甲.id, reason: "手动" } });
    当(市场);
    const 领 = await 查重领取("手机号", c.号, 沟通(), c.id, { 渠道: 新渠道, 对接人: { 原id: c.王 } });
    if (!领.ok) throw new Error(领.error);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).salesOwnerId).toBe(乙.id);
    const 领的 = await prisma.project.findFirstOrThrow({ where: { customerId: c.id, source: 重复咨询来源 } });
    // 查重领取带来源标记、记原始客户，但不占序号（序号只给出口 C 记）
    expect(领的).toMatchObject({ creatorId: 市场.id, ownerId: 乙.id, repeatOfCustomerId: c.id, repeatSeq: null });
    // 几分钟后同一号码又来咨询：客户在乙名下，出口 C 在乙名下新建（不当成重复提交）
    const r = await 出口C建线索("手机号", c.号, 沟通(), { 渠道: 新渠道, 对接人: { 撞上的: true }, 负责人名: 乙.name });
    expect(r).toEqual({ ok: true, 提示: 出口C已转话(乙.name), 负责人: 乙.name });
    expect(await prisma.project.count({ where: { customerId: c.id, source: 重复咨询来源 } })).toBe(2);
    expect(await prisma.project.findFirstOrThrow({ where: { customerId: c.id, repeatSeq: 1 } })).toMatchObject({ ownerId: 乙.id, name: 出口C项目名(序) });
    // 再交一次才是重复提交
    expect(await 出口C建线索("手机号", c.号, 沟通(), { 渠道: 新渠道, 对接人: { 撞上的: true }, 负责人名: 乙.name })).toEqual({ ok: true, 提示: 出口C已转过话(乙.name, 10), 负责人: 乙.name });
    expect(await prisma.project.count({ where: { customerId: c.id, source: 重复咨询来源 } })).toBe(2);
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

  it("负责人到了持有上限（用户 11-23 照挑不到人处理）：框打开就说；交了一行项目不写，留待补建记录、通知这条线的销售管理 + 系统管理员；话里不带别人的持有数", async () => {
    const 内销管 = await 造人("smgr1", "内销管某", "sales_mgr", "内贸");
    const 外销管 = await 造人("smgr2", "外销管某", "sales_mgr", "外贸");
    const c = await 同事客户(外贸甲.id);
    await setSetting("orgRules", { ...默认组织规则, 公海: { ...默认组织规则.公海, 持有上限开: true, 默认上限: 10, 每人上限: { [外贸甲.id]: 1 } } });
    invalidateSettingsCache();
    当(市场);
    await 查号码("手机号", c.号);
    expect(await 出口C框数据("手机号", c.号)).toMatchObject({ ok: true, 交销售: false, 没人接: 负责人到上限预告话(外贸甲.name, "销售管理") });
    // 填新的对接人：还没建（不建线索就不在客户下加人），名字、职务记在待补建里
    const r = await 出口C建线索("手机号", c.号, 沟通(), { 渠道: 新渠道, 对接人: { 名字: "李采购", 职务: "采购" } });
    expect(r).toEqual({ ok: true, 没建: true, 提示: 负责人到上限话(外贸甲.name, "销售管理") });
    expect(负责人到上限话(外贸甲.name, "销售管理")).not.toMatch(/\d/);
    await 没动(c.id);
    expect(await prisma.contact.count({ where: { customerId: c.id } })).toBe(1);
    // 台账：查号码那一行并成「没人接：负责人到上限」，同一行存待补建记录
    const 账 = await prisma.entDupeHit.findMany({ where: { customerId: c.id } });
    expect(账.map((x) => [x.userId, x.result])).toEqual([[市场.id, `没人接：${负责人到上限为什么}`]]);
    const 记 = JSON.parse(账[0].unbuilt!) as 未建线索记录;
    expect(记).toMatchObject({
      状态: "待补建", 类: "到上限", 客户编号: 出口C项目名(序).replace("重复咨询-", ""), 渠道: { id: 新渠道, 名: "小红书|笔记" },
      对接人: { 新建: { 名字: "李采购", 职务: "采购" } }, 沟通: { 类型: "PHONE", 内容: "老客户来电问新一期报价" },
      没建原因: 负责人到上限为什么, 线: "外贸", 客户负责人: { id: 外贸甲.id, 名: 外贸甲.name }, 交的人: { id: 市场.id, 名: 市场.name },
    });
    expect(记.通知了.类别).toBe("销售管理");
    expect(记.通知了.人.map((x) => x.id).sort()).toEqual([外销管.id, 总管.id].sort());
    expect(JSON.stringify(记)).not.toContain(`老客户${序}`);
    // 通知：外贸（负责人的线）的销售管理 + 系统管理员；内贸的销售管理、市场成员自己不收；不带客户名、号码、别人的持有数
    const 通 = await prisma.entNotice.findMany({ where: { kind: "待分配" } });
    expect(通.map((x) => x.userId).sort()).toEqual([外销管.id, 总管.id].sort());
    expect(通.map((x) => x.userId)).not.toContain(内销管.id);
    for (const n of 通) {
      const 字 = `${n.title}\n${n.body}`;
      expect(字).toContain("持有上限");
      expect(字).toContain("小红书|笔记");
      expect(字).toContain("老客户来电问新一期报价");
      expect(字).not.toContain(`老客户${序}`);
      expect(字).not.toContain(c.号);
    }
  });

  it("负责人到持有上限、规则「线索分配」关着：只通知系统管理员（同 P-公海-15 前半）", async () => {
    await 造人("smgr2", "外销管某", "sales_mgr", "外贸");
    const c = await 同事客户(外贸甲.id);
    await setSetting(规则.线索分配.key, false);
    await setSetting("orgRules", { ...默认组织规则, 公海: { ...默认组织规则.公海, 持有上限开: true, 默认上限: 10, 每人上限: { [外贸甲.id]: 1 } } });
    invalidateSettingsCache();
    当(市场);
    expect(await 出口C建线索("手机号", c.号, 沟通(), { 渠道: 新渠道, 对接人: { 撞上的: true } })).toEqual({ ok: true, 没建: true, 提示: 负责人到上限话(外贸甲.name, "系统管理员") });
    expect((await prisma.entNotice.findMany({ where: { kind: "待分配" } })).map((x) => x.userId)).toEqual([总管.id]);
    const 记 = JSON.parse((await prisma.entDupeHit.findFirstOrThrow({ where: { customerId: c.id } })).unbuilt!) as 未建线索记录;
    expect(记).toMatchObject({ 类: "到上限", 对接人: { 撞上的联系人: c.王 }, 通知了: { 类别: "系统管理员", 人: [{ id: 总管.id, 名: 总管.name }] } });
    await 没动(c.id);
  });

  it("负责人是销售管理（能接指定分配）：走主路径，建在他名下、记指定分配、计入他本月已分，不交销售", async () => {
    const 内销管 = await 造人("smgr1", "内销管某", "sales_mgr", "内贸");
    const c = await 同事客户(内销管.id);
    当(市场);
    expect(await 出口C框数据("手机号", c.号)).toMatchObject({ ok: true, 负责人名: 内销管.name, 交销售: false });
    expect(await 出口C建线索("手机号", c.号, 沟通(), { 渠道: 新渠道, 对接人: { 撞上的: true }, 负责人名: 内销管.name }))
      .toEqual({ ok: true, 提示: 出口C已转话(内销管.name), 负责人: 内销管.name });
    const p = await prisma.project.findFirstOrThrow({ where: { customerId: c.id, id: { not: c.旧 } } });
    expect(p).toMatchObject({ ownerId: 内销管.id, creatorId: 市场.id, assignMode: "指定分配", bizLine: "内贸", flowLine: "内贸", source: 重复咨询来源, repeatSeq: 1 });
    expect(await prisma.entLeadAssign.findFirstOrThrow({ where: { projectId: p.id } })).toMatchObject({ toUserId: 内销管.id, way: "指定分配", counted: true, line: "内贸" });
    expect(await 本月已分(内销管.id)).toBe(1);
    expect(await 本月已分(乙.id)).toBe(0);
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
  async function 造(c: { id: string }) {
    const 这条 = await prisma.project.create({ data: { name: "重复咨询-这条", customerId: c.id, ownerId: 外贸甲.id, creatorId: 市场.id, phase: "线索", node: "线索验证" } });
    await prisma.project.create({ data: { name: "乙的", customerId: c.id, ownerId: 乙.id, creatorId: 乙.id, phase: "线索", node: "潜客培育" } });
    await prisma.project.create({ data: { name: "丢了的", customerId: c.id, ownerId: 外贸甲.id, creatorId: 外贸甲.id, phase: "商机", node: "共识方案", result: "丢单" } });
    await prisma.project.create({ data: { name: "公海里的", customerId: c.id, ownerId: "", creatorId: 外贸甲.id, phase: "线索", node: "潜客培育", pooledAt: new Date() } });
    await prisma.project.create({ data: { name: "回收站里的", customerId: c.id, ownerId: 外贸甲.id, creatorId: 外贸甲.id, phase: "线索", node: "潜客培育", deletedAt: new Date() } });
    return 这条.id;
  }

  it("看得到的给名字（同项目切换条一个口径）；结束的、公海里的、回收站里的、这一条自己都不算；重复线索名跟字典现名", async () => {
    const c = await 同事客户(外贸甲.id);
    const 这条 = await 造(c);
    const r = await 以谁的身份(总管.id, () => 客户其他在推项目(这条, c.id));
    expect(r.看得到.map((x) => x.name)).toEqual([expect.stringMatching(/^旧项目/), "乙的"]);
    expect(r.看不到).toBe(0);
    expect(r.重复线索名).toBe("重复线索");
    await prisma.entDictItem.create({ data: { id: "dict-invalid-5", kind: "invalid", name: "老客户同一需求", sort: 5 } });
    expect((await 客户其他在推项目(这条, c.id)).重复线索名).toBe("老客户同一需求");
  });

  it("按组织看客户开着：看不到的只给个数，名字不露", async () => {
    await setSetting(规则.按组织看客户.key, true);
    invalidateSettingsCache();
    忘掉企业版范围();
    const c = await 同事客户(外贸甲.id);
    const 这条 = await 造(c);
    const 乙看 = await 以谁的身份(乙.id, () => 客户其他在推项目(这条, c.id));
    expect(乙看.看得到.map((x) => x.name)).toEqual(["乙的"]);
    expect(乙看.看不到).toBe(1);
    忘掉企业版范围();
    const 总管看 = await 以谁的身份(总管.id, () => 客户其他在推项目(这条, c.id));
    expect(总管看.看得到.length + 总管看.看不到).toBe(2);
  });
});

describe("交销售：客户负责人接不了指定分配，新线索按区域自动分给销售、客户不动", () => {
  const 交 = (c: { 号: string }, 负责人名: string, 补: object = {}) =>
    出口C建线索("手机号", c.号, 沟通(), { 渠道: 新渠道, 对接人: { 撞上的: true }, 负责人名, ...补 } as never);

  it("负责人暂停参与分配：键写交销售；按客户号码定内贸、自动分给内贸销售（计入本月已分、进线索验证）；夹带的选人参数不认；客户和旧项目不动", async () => {
    // 按组织看客户开着（正式库的样子）：市场成员看不到同事的客户，建在自己名下再自动分照样分得出去
    await setSetting(规则.按组织看客户.key, true);
    await setSetting(自动分配不参与key, { [总管.id]: "禁止", [外贸甲.id]: "暂停" });
    invalidateSettingsCache();
    忘掉企业版范围();
    const c = await 同事客户(外贸甲.id);
    const 客户前 = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
    当(市场);
    expect(await 以谁的身份(市场.id, () => 查号码("手机号", c.号))).toMatchObject({ 状态: "重复", 出口C: { 负责人名: 外贸甲.name, 交销售: true } });
    expect(await 以谁的身份(市场.id, () => 出口C框数据("手机号", c.号))).toMatchObject({ ok: true, 负责人名: 外贸甲.name, 交销售: true });
    // 夹带外贸甲（客户负责人）当接手人：不认，照区域挑（手机号 139 → 内贸 → 乙）
    const r = await 以谁的身份(市场.id, () => 交(c, 外贸甲.name, { ownerId: 外贸甲.id, 接手人: 外贸甲.id, toUserId: 外贸甲.id }));
    expect(r).toEqual({ ok: true, 提示: 出口C交销售已分话(乙.name, 外贸甲.name), 负责人: 外贸甲.name });
    const p = await prisma.project.findFirstOrThrow({ where: { customerId: c.id, id: { not: c.旧 } } });
    expect(p).toMatchObject({
      name: 出口C项目名(序, 1), ownerId: 乙.id, creatorId: 市场.id, channelId: 新渠道, source: 重复咨询来源, repeatOfCustomerId: c.id, repeatSeq: 1,
      phase: "线索", node: "线索验证", awaitAssignAt: null, assignMode: "自动分配", flowLine: "内贸", contactId: c.王,
    });
    const 记 = await prisma.entLeadAssign.findFirstOrThrow({ where: { projectId: p.id } });
    expect(记).toMatchObject({ toUserId: 乙.id, counted: true, way: "自动分配", line: "内贸" });
    expect(await 本月已分(乙.id)).toBe(1);
    expect(await 本月已分(外贸甲.id)).toBe(0);
    // 沟通记在新线索上、记录人是市场成员
    const 跟 = await prisma.followUp.findMany({ where: { customerId: c.id }, include: { projectNode: true } });
    expect(跟.map((x) => [x.ownerId, x.projectNode?.projectId])).toEqual([[市场.id, p.id]]);
    // 客户不动、旧项目不动
    const 客户后 = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
    expect([客户后.salesOwnerId, 客户后.channelId]).toEqual([客户前.salesOwnerId, 客户前.channelId]);
    expect(await prisma.project.findUniqueOrThrow({ where: { id: c.旧 } })).toMatchObject({ ownerId: 外贸甲.id, phase: "商机" });
    // 接手的乙收到分配通知
    expect(await prisma.entNotice.count({ where: { userId: 乙.id, kind: "自动分配", link: { startsWith: `/projects/${p.id}` } } })).toBe(1);
  });

  it("客户负责人是市场成员（市场管理名下）：交销售分给销售，客户仍在市场管理名下（不算市场转客户）", async () => {
    const c = await 同事客户(市场管.id);
    当(市场);
    expect(await 查号码("手机号", c.号)).toMatchObject({ 出口C: { 负责人名: 市场管.name, 交销售: true } });
    const r = await 交(c, 市场管.name);
    expect(r).toEqual({ ok: true, 提示: 出口C交销售已分话(乙.name, 市场管.name), 负责人: 市场管.name });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).salesOwnerId).toBe(市场管.id);
    expect(await prisma.project.findUniqueOrThrow({ where: { id: c.旧 } })).toMatchObject({ ownerId: 市场管.id });
    const p = await prisma.project.findFirstOrThrow({ where: { customerId: c.id, id: { not: c.旧 } } });
    expect(p).toMatchObject({ ownerId: 乙.id, node: "线索验证" });
    expect(await prisma.customerOwnerLog.count({ where: { customerId: c.id } })).toBe(0);
  });

  it("负责人账号停用（离职）：同样交销售", async () => {
    const c = await 同事客户(外贸甲.id);
    await prisma.user.update({ where: { id: 外贸甲.id }, data: { active: false } });
    当(市场);
    expect(await 查号码("手机号", c.号)).toMatchObject({ 出口C: { 交销售: true } });
    expect(await 交(c, 外贸甲.name)).toMatchObject({ ok: true, 提示: 出口C交销售已分话(乙.name, 外贸甲.name) });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).salesOwnerId).toBe(外贸甲.id);
  });

  it("挑不到人（这条线的销售都暂停了）：框打开就说，交了整笔不建（没有项目、没有分配记录、没有沟通）；市场成员名下什么都没有、看不到客户名", async () => {
    await setSetting(自动分配不参与key, { [总管.id]: "禁止", [外贸甲.id]: "暂停", [乙.id]: "暂停" });
    invalidateSettingsCache();
    const c = await 同事客户(外贸甲.id);
    当(市场);
    const 为什么 = "能接的销售都暂停或禁止了自动分配";
    // 框照开、先说清（这条线没有销售管理：通知只发系统管理员）；交了整笔不建
    expect(await 出口C框数据("手机号", c.号)).toMatchObject({ ok: true, 交销售: true, 没人接: 出口C没人接预告话(为什么, "系统管理员") });
    expect(await 交(c, 外贸甲.name)).toEqual({ ok: true, 没建: true, 提示: 出口C没人接话(为什么, "系统管理员") });
    await 没动(c.id);
    expect(await prisma.project.count({ where: { ownerId: 市场.id } })).toBe(0);
    expect((await prisma.entDupeHit.findFirstOrThrow({ where: { customerId: c.id } })).result).toBe(`没人接：${为什么}`);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).salesOwnerId).toBe(外贸甲.id);
    const me = { id: 市场.id, name: 市场.name, email: "mkt@x", role: "SALES", title: "" };
    const 列表 = JSON.stringify(await 以谁的身份(市场.id, () => 读项目列表(me as never, { pageSize: "100" })));
    expect(列表).not.toContain("老客户");
    expect(列表).not.toContain("重复咨询-NO.");
  });

  it("挑不到人（这条线的销售都禁止分配）：同样整笔不建", async () => {
    await setSetting(自动分配不参与key, { [总管.id]: "禁止", [外贸甲.id]: "禁止", [乙.id]: "禁止" });
    invalidateSettingsCache();
    const c = await 同事客户(外贸甲.id);
    当(市场);
    expect(await 查号码("手机号", c.号)).toMatchObject({ 出口C: { 负责人名: 外贸甲.name, 交销售: true } });
    expect(await 交(c, 外贸甲.name)).toEqual({ ok: true, 没建: true, 提示: 出口C没人接话("能接的销售都暂停或禁止了自动分配", "系统管理员") });
    await 没动(c.id);
  });

  it("负责人禁止分配：交销售，按区域分给别的销售", async () => {
    await setSetting(自动分配不参与key, { [总管.id]: "禁止", [外贸甲.id]: "禁止" });
    invalidateSettingsCache();
    const c = await 同事客户(外贸甲.id);
    当(市场);
    expect(await 交(c, 外贸甲.name)).toEqual({ ok: true, 提示: 出口C交销售已分话(乙.name, 外贸甲.name), 负责人: 外贸甲.name });
    expect(await prisma.project.findFirstOrThrow({ where: { customerId: c.id, source: 重复咨询来源 } })).toMatchObject({ ownerId: 乙.id, creatorId: 市场.id, awaitAssignAt: null, node: "线索验证" });
  });

  it("规则「线索分配」关着：没有自动分配，交销售整笔不建（框打开就说）；只通知系统管理员，这条线的销售管理不收", async () => {
    await setSetting(规则.线索分配.key, false);
    invalidateSettingsCache();
    const 销管 = await 造人("smgr", "销管某", "sales_mgr", "内贸");
    const c = await 同事客户(外贸甲.id);
    await prisma.user.update({ where: { id: 外贸甲.id }, data: { active: false } });
    当(市场);
    expect(await 出口C框数据("手机号", c.号)).toMatchObject({ ok: true, 没人接: 出口C没人接预告话(规则关着为什么, "系统管理员") });
    expect(await 交(c, 外贸甲.name)).toEqual({ ok: true, 没建: true, 提示: 出口C没人接话(规则关着为什么, "系统管理员") });
    await 没动(c.id);
    expect(await prisma.project.count({ where: { ownerId: 市场.id } })).toBe(0);
    const 通 = await prisma.entNotice.findMany({ where: { kind: "待分配" }, select: { userId: true, body: true } });
    expect(通.map((x) => x.userId)).toEqual([总管.id]);
    // 规则关着：建议打开规则或手动处理，不建议调配额 / 恢复参与分配（没有自动分配，调了也没用）
    expect(通[0].body).toContain("请在组织规则里打开线索分配，或手动处理");
    expect(通[0].body).not.toMatch(/调配额|恢复参与分配/);
    expect(await prisma.entNotice.count({ where: { userId: 销管.id } })).toBe(0);
  });

  it("是系统分、不过「分配方式谁能用」：市场成员的角色用不了自动分配，交销售照样分出去", async () => {
    await setSetting(分配谁能用key, { [分配方式id.自动]: ["sales_mgr"] });
    await setSetting(自动分配不参与key, { [总管.id]: "禁止", [外贸甲.id]: "暂停" });
    invalidateSettingsCache();
    const c = await 同事客户(外贸甲.id);
    当(市场);
    expect(await 交(c, 外贸甲.name)).toMatchObject({ ok: true, 提示: 出口C交销售已分话(乙.name, 外贸甲.name) });
    expect(await prisma.project.findFirstOrThrow({ where: { customerId: c.id, source: 重复咨询来源 } })).toMatchObject({ ownerId: 乙.id, assignMode: "自动分配" });
  });

  it("交销售分出去以后：市场成员（按组织看客户开着）列表里没有客户名、详情不露客户和联系人、改不了负责人", async () => {
    await setSetting(规则.按组织看客户.key, true);
    await setSetting(自动分配不参与key, { [总管.id]: "禁止", [外贸甲.id]: "暂停" });
    invalidateSettingsCache();
    忘掉企业版范围();
    const c = await 同事客户(外贸甲.id);
    当(市场);
    expect(await 以谁的身份(市场.id, () => 交(c, 外贸甲.name))).toMatchObject({ ok: true });
    const p = await prisma.project.findFirstOrThrow({ where: { customerId: c.id, source: 重复咨询来源 } });
    expect(p.ownerId).toBe(乙.id);
    const me = { id: 市场.id, name: 市场.name, email: "mkt@x", role: "SALES", title: "" };
    忘掉企业版范围();
    const 列表 = await 以谁的身份(市场.id, () => 读项目列表(me as never, { pageSize: "100" }));
    const 行 = 列表.行.find((x) => x.id === p.id);
    expect(行).toBeTruthy();
    expect(JSON.stringify(列表)).not.toContain("老客户");
    忘掉企业版范围();
    const 详 = await 以谁的身份(市场.id, () => 读项目详情(me as never, p.id));
    if (详.种 === "有") expect(详.露).toBe(false);
    expect(JSON.stringify(详)).not.toMatch(/老客户|王经理/);
    // 改不了负责人：分配线索、编辑项目都不认
    忘掉企业版范围();
    expect(await 以谁的身份(市场.id, () => 分配线索({ projectId: p.id, toUserId: 外贸甲.id }))).toMatchObject({ ok: false });
    await 以谁的身份(市场.id, () => 编辑项目(p.id, { ownerId: 市场.id } as never)).catch(() => undefined);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).ownerId).toBe(乙.id);
  });
});

describe("交销售之后的再分配：带标记的线索分给销售，客户仍不动", () => {
  it("带标记的线索在新线索待分配（存量数据 / 之后被放回待分配的），总管理手动分给销售：客户还在市场管理名下；分配弹窗预看也不说客户会转走", async () => {
    const c = await 同事客户(市场管.id);
    const p = await prisma.project.create({ data: {
      name: 出口C项目名(序), customerId: c.id, ownerId: 市场.id, creatorId: 市场.id, phase: "线索", node: "潜客培育", bizLine: "内贸",
      source: 重复咨询来源, repeatOfCustomerId: c.id, repeatSeq: 1, awaitAssignAt: new Date(),
    } });
    当(总管);
    expect(await 项目分配线(p.id)).toMatchObject({ 市场转客户: false });
    expect(await 分配带走的项目([p.id], 乙.id)).toMatchObject({ 项目数: 0 });
    expect(await 分配线索({ projectId: p.id, toUserId: 乙.id })).toMatchObject({ ok: true });
    expect(await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ ownerId: 乙.id, awaitAssignAt: null });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).salesOwnerId).toBe(市场管.id);
    expect(await prisma.project.findUniqueOrThrow({ where: { id: c.旧 } })).toMatchObject({ ownerId: 市场管.id });
    // 对照：不带标记的同类线索照旧算市场转客户（预看说会转）
    const 普通 = await prisma.project.create({ data: { name: "普通线索", customerId: c.id, ownerId: 市场.id, creatorId: 市场.id, phase: "线索", node: "潜客培育", bizLine: "内贸" } });
    expect(await 项目分配线(普通.id)).toMatchObject({ 市场转客户: true });
    // 线索公海分配 / 领取（P-公海-11 那条判定）：带标记的不转客户，不带的照转
    const org = await 读组织();
    expect(await 公海项目市场转(prisma, org, { id: p.id, customerId: c.id }, 外贸甲.id, false)).toBeNull();
    expect(await 公海项目市场转(prisma, org, { id: 普通.id, customerId: c.id }, 外贸甲.id, false)).toMatchObject({ 原: 市场管.id });
  });
});

describe("命名加序与只读来源字段（E-218）", () => {
  /** 防重 10 分钟：把已建的挪到 11 分钟前，下一次算新的一次咨询 */
  const 挪早 = (customerId: string) => prisma.project.updateMany({ where: { customerId, source: 重复咨询来源 }, data: { createdAt: new Date(Date.now() - 11 * 60_000) } });
  const 交 = (c: { 号: string }) => 出口C建线索("手机号", c.号, 沟通(), { 渠道: 新渠道, 对接人: { 撞上的: true }, 负责人名: 外贸甲.name });

  it("第一次不带序，第二次起 -2、-3；回收站里的、已结束的都算进去；序号读字段不读名字（改了名照样往下排）", async () => {
    const c = await 同事客户(外贸甲.id);
    const 号 = 出口C项目名(序);
    expect(号).toBe(`重复咨询-NO.${String(序).padStart(5, "0")}`);
    当(市场);
    const 名们 = async () => (await prisma.project.findMany({ where: { customerId: c.id, source: 重复咨询来源 }, orderBy: { repeatSeq: "asc" }, select: { name: true, repeatSeq: true } }));
    expect(await 交(c)).toMatchObject({ ok: true });
    await 挪早(c.id);
    expect(await 交(c)).toMatchObject({ ok: true });
    expect(await 名们()).toEqual([{ name: 号, repeatSeq: 1 }, { name: `${号}-2`, repeatSeq: 2 }]);
    // 第 2 条进回收站、第 1 条结束了，再把第 1 条改成别的名字：第 3 次照样是 -3（不重号、不看名字）
    await prisma.project.update({ where: { repeatOfCustomerId_repeatSeq: { repeatOfCustomerId: c.id, repeatSeq: 2 } }, data: { deletedAt: new Date() } });
    await prisma.project.update({ where: { repeatOfCustomerId_repeatSeq: { repeatOfCustomerId: c.id, repeatSeq: 1 } }, data: { result: "线索流失", name: "重复咨询-NO.99999-7" } });
    await 挪早(c.id);
    expect(await 交(c)).toMatchObject({ ok: true });
    const 第三 = await prisma.project.findUniqueOrThrow({ where: { repeatOfCustomerId_repeatSeq: { repeatOfCustomerId: c.id, repeatSeq: 3 } } });
    expect(第三.name).toBe(`${号}-3`);
    // 别的客户各数各的
    const d = await 同事客户(外贸甲.id);
    expect(await 交(d)).toMatchObject({ ok: true });
    expect(await prisma.project.findFirstOrThrow({ where: { customerId: d.id, source: 重复咨询来源 } })).toMatchObject({ name: 出口C项目名(序), repeatSeq: 1 });
  });

  it("序号只给出口 C 记：先查重领取过（repeatSeq 空、不占号），出口 C 第一次不带序、repeatSeq = 1，再一次 -2；同一位客户查重领取两次不撞唯一索引", async () => {
    const c = await 同事客户(外贸甲.id);
    当(市场);
    // 查重领取两次（领完再进公海再领）：两条都记原始客户、序号都空，唯一索引里空值互不相撞
    for (let i = 0; i < 2; i++) {
      // 每次都当外贸甲放进公海的（按区域自动分给乙；内贸只有乙一个，乙当原负责人放的会挑不到人，所以第二次先把客户挪回外贸甲名下）
      await prisma.customer.update({ where: { id: c.id }, data: { salesOwnerId: 外贸甲.id } });
      await prisma.customerPool.create({ data: { customerId: c.id, userId: 外贸甲.id, reason: "手动" } });
      const 领 = await 查重领取("手机号", c.号, 沟通(), c.id, { 渠道: 新渠道, 对接人: { 原id: c.王 } });
      if (!领.ok) throw new Error(领.error);
    }
    const 领的 = await prisma.project.findMany({ where: { customerId: c.id, source: 重复咨询来源 }, select: { name: true, repeatOfCustomerId: true, repeatSeq: true } });
    expect(领的).toHaveLength(2);
    for (const x of 领的) expect(x).toMatchObject({ repeatOfCustomerId: c.id, repeatSeq: null });
    expect(领的.some((x) => x.name.startsWith("重复咨询"))).toBe(false);
    // 客户现在在乙名下：出口 C 第一次 = 「重复咨询-NO.x」不带序、repeatSeq 1；再一次 = -2
    const 号 = 出口C项目名(序);
    const 交乙 = () => 出口C建线索("手机号", c.号, 沟通(), { 渠道: 新渠道, 对接人: { 撞上的: true }, 负责人名: 乙.name });
    await 挪早(c.id);
    expect(await 交乙()).toMatchObject({ ok: true });
    await 挪早(c.id);
    expect(await 交乙()).toMatchObject({ ok: true });
    const 出口C的 = await prisma.project.findMany({ where: { customerId: c.id, source: 重复咨询来源, repeatSeq: { not: null } }, orderBy: { repeatSeq: "asc" }, select: { name: true, repeatSeq: true } });
    expect(出口C的).toEqual([{ name: 号, repeatSeq: 1 }, { name: `${号}-2`, repeatSeq: 2 }]);
    // 详情：查重领取的只给原始客户编号、不带第几次
    expect(await 重复咨询原始客户({ repeatOfCustomerId: c.id, repeatSeq: null })).toEqual({ 客户编号: `NO.${String(序).padStart(5, "0")}`, 第几次: null });
  });

  it("项目列表（检索读字段）：按数据来源「老客户重复咨询」筛；搜原始客户编号（NO.00001 或 00001）命中负责人改了名的那条", async () => {
    const c = await 同事客户(外贸甲.id);
    当(市场);
    expect(await 交(c)).toMatchObject({ ok: true });
    const p = await prisma.project.findFirstOrThrow({ where: { customerId: c.id, source: 重复咨询来源 } });
    await prisma.project.update({ where: { id: p.id }, data: { name: "华东新一期" } });
    当(总管);
    const me = { id: 总管.id, name: 总管.name, email: "boss@x", role: "SALES", title: "" };
    const ids = async (sp: object) => (await 以谁的身份(总管.id, () => 读项目列表(me as never, { pageSize: "100", ...sp }))).行.map((x) => x.id).sort();
    expect(await ids({})).toEqual([c.旧, p.id].sort());
    expect(await ids({ source: 重复咨询来源 })).toEqual([p.id]);
    // 别的值当没筛
    expect(await ids({ source: "history-analysis" })).toEqual([c.旧, p.id].sort());
    const 号 = String(序).padStart(5, "0");
    expect(await ids({ keyword: `NO.${号}` })).toEqual([p.id]);
    expect(await ids({ keyword: 号 })).toEqual([p.id]);
    expect(await ids({ keyword: "NO.99998" })).toEqual([]);
  });

  it("同一位客户下序号唯一（库里的唯一索引兜底，两边同时交撞了号后到的那笔回滚）", async () => {
    const c = await 同事客户(外贸甲.id);
    const 建 = () => prisma.project.create({ data: { name: "x", customerId: c.id, ownerId: 外贸甲.id, creatorId: 市场.id, source: 重复咨询来源, repeatOfCustomerId: c.id, repeatSeq: 1 } });
    await 建();
    await expect(建()).rejects.toMatchObject({ code: "P2002" });
  });

  it("两边同时交、序号撞了唯一索引：整笔回滚重来，重来读到对方那条接着往下排；一直撞最多试 3 次，照抛、一行不留", async () => {
    const c = await 同事客户(外贸甲.id);
    当(市场);
    撞号.次 = 1;
    撞号.撞了 = 0;
    try {
      const r = await 出口C建线索("手机号", c.号, 沟通(), { 渠道: 新渠道, 对接人: { 撞上的: true } });
      expect(r).toEqual({ ok: true, 提示: 出口C已转话(外贸甲.name), 负责人: 外贸甲.name });
      expect(撞号.撞了).toBe(1);
      // 撞的那一笔整笔回滚了（两行抢号的都不在）：只有重来建成的那一条，序号 1、分配记录一条、沟通一条
      const 新 = await prisma.project.findMany({ where: { customerId: c.id, id: { not: c.旧 } } });
      expect(新.map((x) => [x.name, x.repeatSeq])).toEqual([[出口C项目名(序), 1]]);
      expect(await prisma.entLeadAssign.count()).toBe(1);
      expect(await prisma.followUp.count({ where: { customerId: c.id } })).toBe(1);

      // 一直撞：试 3 次就停，把唯一约束错照抛出去，这位客户名下一行不多
      const d = await 同事客户(外贸甲.id);
      撞号.次 = 9;
      撞号.撞了 = 0;
      await expect(出口C建线索("手机号", d.号, 沟通(), { 渠道: 新渠道, 对接人: { 撞上的: true } })).rejects.toMatchObject({ code: "P2002" });
      expect(撞号.撞了).toBe(3);
      expect(await prisma.project.count({ where: { customerId: d.id } })).toBe(1);
      expect(await prisma.followUp.count({ where: { customerId: d.id } })).toBe(0);
    } finally {
      撞号.次 = 0;
    }
  });

  it("负责人编辑项目改得了名字、改不了来源字段；改名后标记、原始客户、序号都还在；详情给原始客户编号 + 第几次", async () => {
    const c = await 同事客户(外贸甲.id);
    当(市场);
    expect(await 交(c)).toMatchObject({ ok: true });
    const p = await prisma.project.findFirstOrThrow({ where: { customerId: c.id, source: 重复咨询来源 } });
    当(外贸甲);
    忘掉企业版范围();
    const r = await 以谁的身份(外贸甲.id, () => 编辑项目(p.id, { name: "华东新一期", source: null, repeatOfCustomerId: "别的", repeatSeq: 9 } as never));
    expect(r).toMatchObject({ ok: true });
    expect(await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ name: "华东新一期", source: 重复咨询来源, repeatOfCustomerId: c.id, repeatSeq: 1 });
    expect(await 重复咨询原始客户({ repeatOfCustomerId: c.id, repeatSeq: 1 })).toEqual({ 客户编号: `NO.${String(序).padStart(5, "0")}`, 第几次: 1 });
    expect(await 重复咨询原始客户({ repeatOfCustomerId: null, repeatSeq: null })).toBeNull();
  });

  it("守卫：只有建线索那一处写 repeatOfCustomerId / repeatSeq（改项目的入口都不写）", () => {
    const 根 = path.resolve(__dirname, "../src");
    const 写的: string[] = [];
    const 走 = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = path.join(d, f);
        if (f === "generated") continue;
        if (statSync(p).isDirectory()) { 走(p); continue; }
        if (!/\.(ts|tsx)$/.test(f)) continue;
        if (/\b(repeatOfCustomerId|repeatSeq)\s*:/.test(readFileSync(p, "utf8"))) 写的.push(path.relative(根, p));
      }
    };
    走(根);
    // 只拿它当查询条件的（项目列表按原始客户编号搜：where 里比 repeatOfCustomerId），不写：另列，且那个文件里没有带它的 data
    const 只读的 = ["lib/project/list.ts"];
    expect(写的.filter((f) => !只读的.includes(f)).sort()).toEqual(["lib/enterprise/dedupe-claim.ts"]);
    for (const f of 只读的) expect(readFileSync(path.join(根, f), "utf8")).not.toMatch(/data:\s*\{[^}]*\b(repeatOfCustomerId|repeatSeq)\b/);
  });
});

describe("交销售挑不到人：提醒能分配的人（P-转-38）；事务里满额顺延、判无效补发", () => {
  const 交 = (c: { 号: string }, 负责人名: string, 这次 = 沟通()) => 出口C建线索("手机号", c.号, 这次, { 渠道: 新渠道, 对接人: { 撞上的: true }, 负责人名 });
  /** 一条算数的分配记录（本月已分 +1） */
  const 记一条 = (u: 人) => prisma.entLeadAssign.create({ data: { toUserId: u.id, fromUserId: 总管.id, byUserId: 总管.id, line: "内贸", kind: "营销", counted: true, month: 月份(), way: "自动分配" } });
  const 设配额 = (u: 人, quota: number) => prisma.entLeadQuota.create({ data: { userId: u.id, quota, setById: 总管.id } });

  beforeEach(async () => {
    // 客户负责人外贸甲暂停：走交销售；按号码定内贸（只有乙）
    await setSetting(自动分配不参与key, { [总管.id]: "禁止", [外贸甲.id]: "暂停" });
    await setSetting(不设配额key, false);
    invalidateSettingsCache();
  });

  it("全部满额：整笔不建；台账这一行记「没人接：原因」；这条线（内贸）的销售管理 + 系统管理员收通知（编号、渠道、沟通摘要，不带客户名），外贸的销售管理不收", async () => {
    const 内销管 = await 造人("smgr1", "内销管某", "sales_mgr", "内贸");
    const 外销管 = await 造人("smgr2", "外销管某", "sales_mgr", "外贸");
    // 销售管理也在自动分配池里：禁止掉，只看乙
    await setSetting(自动分配不参与key, { [总管.id]: "禁止", [外贸甲.id]: "暂停", [内销管.id]: "禁止", [外销管.id]: "禁止" });
    invalidateSettingsCache();
    await 设配额(乙, 1);
    await 记一条(乙);
    const c = await 同事客户(外贸甲.id);
    当(市场);
    // 先查号码（记一行「拦截」），框打开就说没人接
    await 查号码("手机号", c.号);
    const 为什么 = "能接的销售本月都已满额";
    expect(await 出口C框数据("手机号", c.号)).toMatchObject({ ok: true, 交销售: true, 没人接: 出口C没人接预告话(为什么, "销售管理") });
    expect(await 交(c, 外贸甲.name)).toEqual({ ok: true, 没建: true, 提示: 出口C没人接话(为什么, "销售管理") });
    // 不建：没有新项目、没有新的分配记录、没有沟通
    expect(await prisma.project.count({ where: { customerId: c.id } })).toBe(1);
    expect(await prisma.entLeadAssign.count()).toBe(1);
    expect(await prisma.followUp.count({ where: { customerId: c.id } })).toBe(0);
    // 台账：查号码那一行并成「没人接：原因」
    const 账 = await prisma.entDupeHit.findMany({ where: { customerId: c.id } });
    expect(账.map((x) => [x.userId, x.result])).toEqual([[市场.id, `没人接：${为什么}`]]);
    // 同一行存「未建线索」待补建记录（P-公海-15 后半）：补建要用的都在，不写客户名
    const 记 = JSON.parse(账[0].unbuilt!) as 未建线索记录;
    expect(记).toMatchObject({
      状态: "待补建", 类: "没人接", 客户编号: 出口C项目名(序).replace("重复咨询-", ""), 渠道: { id: 新渠道, 名: "小红书|笔记" }, 对接人: { 撞上的联系人: c.王 },
      沟通: { 类型: "PHONE", 内容: "老客户来电问新一期报价" }, 没建原因: 为什么, 线: "内贸",
      客户负责人: { id: 外贸甲.id, 名: 外贸甲.name }, 交的人: { id: 市场.id, 名: 市场.name },
    });
    expect(new Date(记.沟通.时间).getTime()).toBe(new Date("2026-11-20T10:00:00+08:00").getTime());
    expect(Date.now() - new Date(记.交的时间).getTime()).toBeLessThan(60_000);
    expect(记.通知了.类别).toBe("销售管理");
    expect(记.通知了.人.map((x) => x.名).sort()).toEqual([内销管.name, 总管.name].sort());
    expect(JSON.stringify(记)).not.toContain(`老客户${序}`);
    expect(JSON.stringify(记)).not.toContain(c.号);
    // 通知：内贸销售管理 + 系统管理员（总管），外贸销售管理、市场成员自己不收
    const 通 = await prisma.entNotice.findMany({ where: { kind: "待分配" }, orderBy: { userId: "asc" } });
    expect(通.map((x) => x.userId).sort()).toEqual([内销管.id, 总管.id].sort());
    const 编号 = 出口C项目名(序).replace("重复咨询-", "");
    for (const n of 通) {
      const 字 = `${n.title}\n${n.body}`;
      expect(字).toContain(编号);
      expect(字).toContain("小红书|笔记");
      expect(字).toContain("老客户来电问新一期报价");
      expect(字).toContain(为什么);
      expect(字).not.toContain(`老客户${序}`);
      expect(字).not.toContain(c.号);
      expect(字).toContain("请调配额、恢复参与分配");
    }
  });

  it("同一人 10 分钟内再交一次（隔了几分钟、不在同一分钟）：照样回没建，通知不重复（key = 客户 + 发起人 + 10 分钟一格）；下一格再交才再发", async () => {
    await setSetting(自动分配不参与key, { [总管.id]: "禁止", [外贸甲.id]: "暂停", [乙.id]: "暂停" });
    invalidateSettingsCache();
    const c = await 同事客户(外贸甲.id);
    当(市场);
    const 话 = { ok: true, 没建: true, 提示: 出口C没人接话("能接的销售都暂停或禁止了自动分配", "系统管理员") };
    const 格 = Math.floor(Date.now() / 600_000) * 600_000;
    const 钟 = vi.spyOn(Date, "now");
    try {
      钟.mockReturnValue(格 + 1_000);
      expect(await 交(c, 外贸甲.name)).toEqual(话);
      // 同一格、隔了 3 分钟（默认按内容 + 当前分钟的键挡不住这一下）
      钟.mockReturnValue(格 + 181_000);
      expect(await 交(c, 外贸甲.name, 沟通({ content: "第二次来电：改要两台" }))).toEqual(话);
      expect(await prisma.entNotice.count({ where: { kind: "待分配" } })).toBe(1);
      // 待补建记录：两次都留下（并在同一行、追加成数组，不盖掉第一次），按交的先后
      const 账 = await prisma.entDupeHit.findMany({ where: { customerId: c.id } });
      expect(账).toHaveLength(1);
      expect(JSON.parse(账[0].unbuilt!)).toHaveLength(2);
      const 两次 = 读未建线索(账[0].unbuilt);
      expect(两次.map((x) => x.沟通.内容)).toEqual(["老客户来电问新一期报价", "第二次来电：改要两台"]);
      expect(两次.map((x) => new Date(x.交的时间).getTime())).toEqual([格 + 1_000, 格 + 181_000]);
      // 下一格：算新的一次，再提醒一遍
      钟.mockReturnValue(格 + 601_000);
      expect(await 交(c, 外贸甲.name)).toEqual(话);
      expect(await prisma.entNotice.count({ where: { kind: "待分配" } })).toBe(2);
    } finally {
      钟.mockRestore();
    }
    expect((await prisma.entNotice.findMany({ where: { kind: "待分配" } })).map((x) => x.userId)).toEqual([总管.id, 总管.id]);
    await 没动(c.id);
  });

  it("待补建记录没写成（库出错）：不悄悄丢——通知不说「已留在撞号台账」、改说按通知手动建并带沟通全文，回话也说，操作日志留整份；下一次照发不并", async () => {
    await setSetting(自动分配不参与key, { [总管.id]: "禁止", [外贸甲.id]: "暂停", [乙.id]: "暂停" });
    invalidateSettingsCache();
    const c = await 同事客户(外贸甲.id);
    当(市场);
    await 查号码("手机号", c.号);
    // 库里挡住写待补建（插入、改都挡）：合在撞号那一次的写入、兜底补一行，两路都写不成
    await prisma.$executeRawUnsafe(`CREATE TRIGGER 挡未建1 BEFORE UPDATE OF unbuilt ON EntDupeHit WHEN NEW.unbuilt IS NOT NULL BEGIN SELECT RAISE(ABORT, '模拟写失败'); END`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER 挡未建2 BEFORE INSERT ON EntDupeHit WHEN NEW.unbuilt IS NOT NULL BEGIN SELECT RAISE(ABORT, '模拟写失败'); END`);
    const 错 = vi.spyOn(console, "error").mockImplementation(() => {});
    const 长 = `老客户来电问新一期报价，${"要两台、含安装调试、开专票、".repeat(10)}月底前到货`;
    try {
      const 为什么 = "能接的销售都暂停或禁止了自动分配";
      expect(await 交(c, 外贸甲.name, 沟通({ content: 长 }))).toEqual({ ok: true, 没建: true, 提示: `${出口C没人接话(为什么, "系统管理员")}${待补建没写成交的人话(true)}` });
      // 服务端错误日志
      expect(错.mock.calls.some((x) => String(x[0]).includes("未建线索没记上"))).toBe(true);
      // 台账没有待补建（这一行的结果改动跟着一起回滚了，还是查号码时的「拦截」）
      const 账 = await prisma.entDupeHit.findMany({ where: { customerId: c.id } });
      expect(账.map((x) => [x.result, x.unbuilt])).toEqual([["拦截", null]]);
      // 通知：不说已留在台账，说没写成、按通知手动建；沟通全文（不截 120 字）
      const 通 = await prisma.entNotice.findMany({ where: { kind: "待分配" } });
      expect(通.map((x) => x.userId)).toEqual([总管.id]);
      expect(通[0].body).not.toContain("已留在撞号台账");
      expect(通[0].body).toContain(待补建没写成话);
      expect(通[0].body).toContain(长);
      // 操作日志留整份待补建记录（补建时照它）
      const 日志 = await prisma.auditLog.findMany({ where: { action: "unbuilt_failed" } });
      expect(日志).toHaveLength(1);
      expect([日志[0].userId, 日志[0].entity, 日志[0].entityId]).toEqual([市场.id, "Customer", c.id]);
      expect(日志[0].summary).not.toContain(`老客户${序}`);
      const d = JSON.parse(日志[0].detail!) as { 待补建: 未建线索记录 };
      expect(d.待补建).toMatchObject({ 状态: "待补建", 类: "没人接", 没建原因: 为什么, 沟通: { 内容: 长 }, 交的人: { id: 市场.id } });
      // 同一人马上再交（同一个 10 分钟格）：没写成的那次照发，不按 10 分钟并掉
      await 交(c, 外贸甲.name);
      expect(await prisma.entNotice.count({ where: { kind: "待分配" } })).toBe(2);
    } finally {
      错.mockRestore();
      await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS 挡未建1");
      await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS 挡未建2");
    }
    await 没动(c.id);
  });

  it("负责人没人接、没查号码直接交两次（台账原来没这一行）：第一次新建一行、第二次追加，两次的待补建都在", async () => {
    await setSetting(自动分配不参与key, { [总管.id]: "禁止", [外贸甲.id]: "暂停", [乙.id]: "暂停" });
    invalidateSettingsCache();
    const c = await 同事客户(外贸甲.id);
    当(市场);
    await 交(c, 外贸甲.name);
    let 账 = await prisma.entDupeHit.findMany({ where: { customerId: c.id } });
    expect(账).toHaveLength(1);
    // 第一次：一个对象（迁移 165 起的写法），读的地方两种都认
    expect(Array.isArray(JSON.parse(账[0].unbuilt!))).toBe(false);
    expect(读未建线索(账[0].unbuilt)).toHaveLength(1);
    await 交(c, 外贸甲.name, 沟通({ content: "又来电" }));
    账 = await prisma.entDupeHit.findMany({ where: { customerId: c.id } });
    expect(账).toHaveLength(1);
    expect(读未建线索(账[0].unbuilt).map((x) => x.沟通.内容)).toEqual(["老客户来电问新一期报价", "又来电"]);
    expect(读未建线索(null)).toEqual([]);
    expect(读未建线索("坏")).toEqual([]);
  });

  it("线判不出（客户没区域、没电话，发起人没事业部）：两条线的销售管理 + 系统管理员都收", async () => {
    const 内销管 = await 造人("smgr1", "内销管某", "sales_mgr", "内贸");
    const 外销管 = await 造人("smgr2", "外销管某", "sales_mgr", "外贸");
    await setSetting(自动分配不参与key, { [总管.id]: "禁止", [外贸甲.id]: "暂停", [乙.id]: "暂停", [内销管.id]: "禁止", [外销管.id]: "禁止" });
    invalidateSettingsCache();
    // 只有邮箱的客户：按号码定不了线（查的是邮箱，客户和联系人的电话都空着）
    序 += 1;
    const 邮 = `buyer${序}@example.com`;
    const c = await prisma.customer.create({ data: { name: `老客户${序}`, phone: "", salesOwnerId: 外贸甲.id, channelId: 老渠道, attributionChannelId: 老渠道, customerNo: 序 } });
    await prisma.contact.create({ data: { name: "王经理", email: 邮, isPrimary: true, customerId: c.id } });
    当(市场);
    const 为什么 = "能接的销售都暂停或禁止了自动分配";
    expect(await 出口C框数据("邮箱", 邮)).toMatchObject({ ok: true, 交销售: true, 没人接: 出口C没人接预告话(为什么, "销售管理") });
    expect(await 出口C建线索("邮箱", 邮, 沟通(), { 渠道: 新渠道, 对接人: { 撞上的: true }, 负责人名: 外贸甲.name }))
      .toEqual({ ok: true, 没建: true, 提示: 出口C没人接话(为什么, "销售管理") });
    expect((await prisma.entNotice.findMany({ where: { kind: "待分配" } })).map((x) => x.userId).sort()).toEqual([内销管.id, 外销管.id, 总管.id].sort());
    expect(await prisma.project.count({ where: { customerId: c.id } })).toBe(0);
  });

  it("收件人去掉发起人自己一个不剩（发起人兼任唯一的系统管理员、没有销售管理）：框里和交了都说「请找销售管理」，不发通知", async () => {
    // 总管设了业务线、没勾系统管理员 = 不算系统管理员；市场成员兼总管理（没设业务线）= 唯一的系统管理员
    await prisma.entMember.update({ where: { userId: 总管.id }, data: { line: "外贸" } });
    await prisma.entMember.update({ where: { userId: 市场.id }, data: { bizRole: "channel_ops,director" } });
    await setSetting(自动分配不参与key, { [总管.id]: "禁止", [市场.id]: "禁止", [外贸甲.id]: "暂停", [乙.id]: "暂停" });
    invalidateSettingsCache();
    忘掉企业版范围();
    const org = await 读组织();
    expect([是系统管理员of(org, 市场.id), 是系统管理员of(org, 总管.id)]).toEqual([true, false]);
    const c = await 同事客户(外贸甲.id);
    当(市场);
    const 为什么 = "能接的销售都暂停或禁止了自动分配";
    const 框 = await 出口C框数据("手机号", c.号);
    expect(框).toMatchObject({ ok: true, 交销售: true, 没人接: 出口C没人接预告话(为什么, null) });
    const r = await 交(c, 外贸甲.name);
    expect(r).toEqual({ ok: true, 没建: true, 提示: 出口C没人接话(为什么, null) });
    if (r.ok) expect(r.提示).toContain("请找销售管理");
    expect(r.ok && r.提示).not.toContain("已通知");
    expect(await prisma.entNotice.count({ where: { kind: "待分配" } })).toBe(0);
    await 没动(c.id);
  });

  it("这条线没人（内贸没有销售）：不建，原因写这条线没人；只通知系统管理员", async () => {
    await prisma.entMember.update({ where: { userId: 乙.id }, data: { line: "外贸" } });
    const c = await 同事客户(外贸甲.id);
    当(市场);
    const 为什么 = "内贸上没有能接的销售（或业务线对不上）";
    expect(await 交(c, 外贸甲.name)).toEqual({ ok: true, 没建: true, 提示: 出口C没人接话(为什么, "系统管理员") });
    await 没动(c.id);
    expect((await prisma.entNotice.findMany({ where: { kind: "待分配" } })).map((x) => x.userId)).toEqual([总管.id]);
    expect((await prisma.entDupeHit.findFirstOrThrow({ where: { customerId: c.id } })).result).toBe(`没人接：${为什么}`);
  });

  it("事务里挑中的人刚满额（事务外读的时候还没满）：顺延下一位", async () => {
    const 丙 = await 造人("bing", "销售丙某", "sales", "内贸");
    // 乙 0/1、丙 1/2：事务外挑乙（本月已分最少）
    await 设配额(乙, 1);
    await 设配额(丙, 2);
    await 记一条(丙);
    const c = await 同事客户(外贸甲.id);
    当(市场);
    // 读完候选、进事务之前乙的配额被改成 0（同一刻别处调了配额）：事务里核出乙满了 → 顺延丙
    // 打在底层连接上（prisma 是转发的代理，打在代理上会自己调自己）
    const 原 = defaultClient.$transaction as (...x: unknown[]) => unknown;
    let 第几笔 = 0;
    const spy = vi.spyOn(defaultClient, "$transaction").mockImplementation((async function (this: unknown, ...a: unknown[]) {
      if (typeof a[0] === "function" && ++第几笔 === 1) await defaultClient.entLeadQuota.update({ where: { userId: 乙.id }, data: { quota: 0 } });
      return 原.apply(this, a);
    }) as never);
    try {
      expect(await 交(c, 外贸甲.name)).toEqual({ ok: true, 提示: 出口C交销售已分话(丙.name, 外贸甲.name), 负责人: 外贸甲.name });
    } finally {
      spy.mockRestore();
    }
    // 第一笔事务核出乙满了回滚、第二笔给丙
    expect(第几笔).toBe(2);
    const p = await prisma.project.findFirstOrThrow({ where: { customerId: c.id, source: 重复咨询来源 } });
    expect(p.ownerId).toBe(丙.id);
    expect(await 本月已分(乙.id)).toBe(0);
    expect(await 本月已分(丙.id)).toBe(2);
    expect(await prisma.project.count({ where: { customerId: c.id } })).toBe(2);
  });

  it("事务里挑中的人刚满额、顺延下去没人可挑：回没建（不是失败），台账记「没人接」、通知系统管理员，一行项目 / 分配 / 沟通都不写", async () => {
    // 内贸只有乙 0/1：事务外挑乙；进事务之前乙的配额被改成 0 → 事务里核出满了 → 跳过乙 → 没人了
    await 设配额(乙, 1);
    const c = await 同事客户(外贸甲.id);
    当(市场);
    const 原 = defaultClient.$transaction as (...x: unknown[]) => unknown;
    let 第几笔 = 0;
    const spy = vi.spyOn(defaultClient, "$transaction").mockImplementation((async function (this: unknown, ...a: unknown[]) {
      if (typeof a[0] === "function" && ++第几笔 === 1) await defaultClient.entLeadQuota.update({ where: { userId: 乙.id }, data: { quota: 0 } });
      return 原.apply(this, a);
    }) as never);
    const 为什么 = "能接的销售本月都已满额";
    try {
      expect(await 交(c, 外贸甲.name)).toEqual({ ok: true, 没建: true, 提示: 出口C没人接话(为什么, "系统管理员") });
    } finally {
      spy.mockRestore();
    }
    // 出口 C 的事务只开了一笔（没重挑）；第 2 笔是收尾时撞号台账记「没人接」+ 待补建（同一次写入的小事务）
    expect(第几笔).toBe(2);
    await 没动(c.id);
    expect((await prisma.entDupeHit.findFirstOrThrow({ where: { customerId: c.id } })).result).toBe(`没人接：${为什么}`);
    expect((await prisma.entNotice.findMany({ where: { kind: "待分配" } })).map((x) => x.userId)).toEqual([总管.id]);
  });

  it("判无效补发：有内贸待补的丙先补（本来轮到乙）；分配记录不计数、补位记用在这条上；本月已分不涨", async () => {
    const 丙 = await 造人("bing", "销售丙某", "sales", "内贸");
    await setSetting(不设配额key, true);
    invalidateSettingsCache();
    await 记一条(丙);
    await prisma.entLeadMakeup.create({ data: { userId: 丙.id, projectId: "坏线索", line: "内贸" } });
    const c = await 同事客户(外贸甲.id);
    当(市场);
    expect(await 交(c, 外贸甲.name)).toEqual({ ok: true, 提示: 出口C交销售已分话(丙.name, 外贸甲.name), 负责人: 外贸甲.name });
    const p = await prisma.project.findFirstOrThrow({ where: { customerId: c.id, source: 重复咨询来源 } });
    expect(p.ownerId).toBe(丙.id);
    const 记 = await prisma.entLeadAssign.findFirstOrThrow({ where: { projectId: p.id } });
    expect(记).toMatchObject({ toUserId: 丙.id, counted: false, way: "自动分配" });
    expect(await prisma.entLeadMakeup.findFirstOrThrow()).toMatchObject({ usedAssignId: 记.id, usedProjectId: p.id });
    expect(await 本月已分(丙.id)).toBe(1);
  });
});

describe("项目列表按原始客户编号搜（检索读字段）：这一支短数字不当编号；搜不到看不到的同事线索", () => {
  const 交 = (c: { 号: string }) => 出口C建线索("手机号", c.号, 沟通(), { 渠道: 新渠道, 对接人: { 撞上的: true }, 负责人名: 外贸甲.name });
  const 搜 = async (u: 人, keyword: string) =>
    (await 以谁的身份(u.id, () => 读项目列表({ id: u.id, name: u.name, email: "x@x", role: "SALES", title: "" } as never, { pageSize: "100", keyword }))).行.map((x) => x.id);

  it("销售用编号搜同事名下（他看不到的）重复咨询线索：结果为空；负责人自己搜得到", async () => {
    await setSetting(规则.按组织看客户.key, true);
    invalidateSettingsCache();
    忘掉企业版范围();
    const c = await 同事客户(外贸甲.id);
    当(市场);
    expect(await 以谁的身份(市场.id, () => 交(c))).toMatchObject({ ok: true });
    const p = await prisma.project.findFirstOrThrow({ where: { customerId: c.id, source: 重复咨询来源 } });
    await prisma.project.update({ where: { id: p.id }, data: { name: "华东新一期" } });
    const 号 = `NO.${String(序).padStart(5, "0")}`;
    当(乙);
    expect(await 搜(乙, 号)).toEqual([]);
    当(外贸甲);
    expect(await 搜(外贸甲, 号)).toContain(p.id);
  });

  it("项目列表「按原始客户编号命中」这一支：「2024」这种短数字不触发；「02024」「NO.2024」照搜；共用的 看成客户编号 不变（客户列表 / 公海照旧认短数字）", async () => {
    expect(看成客户编号("2024")).toBe(2024);
    expect(看成客户编号严("2024")).toBeNull();
    expect([看成客户编号严("02024"), 看成客户编号严("NO.2024"), 看成客户编号严("ｎｏ．２０２４")]).toEqual([2024, 2024, 2024]);
    const c = await 同事客户(外贸甲.id);
    await prisma.customer.update({ where: { id: c.id }, data: { customerNo: 2024 } });
    当(市场);
    expect(await 交(c)).toMatchObject({ ok: true });
    const p = await prisma.project.findFirstOrThrow({ where: { customerId: c.id, source: 重复咨询来源 } });
    expect(p.name).toBe("重复咨询-NO.02024");
    // 负责人改了名（名字里不再有这串数字），只剩编号那一支能中
    await prisma.project.update({ where: { id: p.id }, data: { name: "华东新一期" } });
    当(总管);
    expect(await 搜(总管, "2024")).toEqual([]);
    expect(await 搜(总管, "02024")).toEqual([p.id]);
    expect(await 搜(总管, "NO.2024")).toEqual([p.id]);
  });
});

describe("三态照现状（E-213 第一节 1）：出口 C 的四样动静都重开倒计时，额度只认那条有效沟通回满", () => {
  const 今天 = beijingDay(new Date());
  const 前 = (n: number) => 加天(今天, -n);
  const 那天 = (n: number) => new Date(`${前(n)}T10:00:00+08:00`);
  const 今天沟通 = (content: string) => 沟通({ content, occurredAt: `${今天} 00:00` });

  beforeEach(async () => {
    await setSetting("orgRules", { ...默认组织规则, 超时回收: { ...默认组织规则.超时回收, 起算日: 前(150) }, 三态: { ...默认三态规则, 开: true } });
    invalidateSettingsCache();
  });

  /** 120 天前建档、名下旧项目 120 天没动的同事客户：夜扫后在沉睡；20 天前负责人点过一次继续持有（用掉 1 次额度） */
  async function 沉睡客户() {
    const c = await 同事客户(外贸甲.id);
    await prisma.customer.update({ where: { id: c.id }, data: { createdAt: 那天(120) } });
    await prisma.project.update({ where: { id: c.旧 }, data: { createdAt: 那天(120), updatedAt: 那天(120) } });
    await 三态夜扫();
    expect((await prisma.entCustomerClock.findUniqueOrThrow({ where: { customerId: c.id } })).state).toBe("沉睡");
    await prisma.entCustomerStateLog.create({ data: { customerId: c.id, fromState: "沉睡", toState: "沉睡", via: "本人", reason: "还在跟", holdDays: 30, userId: 外贸甲.id, at: 那天(20) } });
    return c;
  }

  it("额度：建新线索、进线索验证都不回满；市场成员记的那条是占位话（「跟进」）也不回满；换一位市场成员记一条有内容的沟通才回满", async () => {
    const c = await 沉睡客户();
    expect((await 读一位三态(c.id))!.继续持有.已用次数).toBe(1);
    当(市场);
    expect((await 出口C建线索("手机号", c.号, 今天沟通("跟进"), { 渠道: 新渠道, 对接人: { 撞上的: true } })).ok).toBe(true);
    const 一 = (await 读一位三态(c.id))!;
    // 倒计时重开了（建新线索、进线索验证当天的节点变更），额度没回满
    expect([一.状态, 一.归零日, 一.继续持有.已用次数]).toEqual(["活跃", 今天, 1]);
    expect((await prisma.entCustomerClock.findUniqueOrThrow({ where: { customerId: c.id } })).quotaResetDay).toBeNull();
    当(市场管);
    expect((await 出口C建线索("手机号", c.号, 今天沟通("老客户来电问新一期报价"), { 渠道: 新渠道, 对接人: { 撞上的: true } })).ok).toBe(true);
    expect((await 读一位三态(c.id))!.继续持有.已用次数).toBe(0);
    expect((await prisma.entCustomerClock.findUniqueOrThrow({ where: { customerId: c.id } })).quotaResetDay).toBe(今天);
  });

  it("倒计时：建新线索（起点节点）、进线索验证、那条沟通、终判，每一样单独都把归零日拨到它那天", async () => {
    const c = await 沉睡客户();
    当(市场);
    expect((await 出口C建线索("手机号", c.号, 今天沟通("老客户来电问新一期报价"), { 渠道: 新渠道, 对接人: { 撞上的: true } })).ok).toBe(true);
    const p = await prisma.project.findFirstOrThrow({ where: { customerId: c.id, id: { not: c.旧 } } });
    const 节点们 = await prisma.projectNodeLog.findMany({ where: { projectId: p.id }, orderBy: [{ at: "asc" }, { id: "asc" }] });
    // 建的时候在起点节点记一行、市场分给销售进线索验证再记一行
    expect(节点们.map((x) => x.toNode)).toEqual(["潜客培育", "线索验证"]);
    // 都挪回 100 天前（钟上的推进底日一起挪，S7 拨过的钟不回退），归零日回到 100 天前
    await prisma.project.update({ where: { id: p.id }, data: { createdAt: 那天(100) } });
    await prisma.projectNodeLog.updateMany({ where: { projectId: p.id }, data: { at: 那天(100) } });
    await prisma.followUp.updateMany({ where: { customerId: c.id }, data: { occurredAt: 那天(100) } });
    await prisma.entCustomerClock.update({ where: { customerId: c.id }, data: { progressDay: 前(100) } });
    expect((await 读一位三态(c.id))!.归零日).toBe(前(100));
    // 一样一样拨回来
    await prisma.projectNodeLog.update({ where: { id: 节点们[0].id }, data: { at: 那天(40) } });
    expect((await 读一位三态(c.id))!.归零日).toBe(前(40));
    await prisma.projectNodeLog.update({ where: { id: 节点们.at(-1)!.id }, data: { at: 那天(30) } });
    expect((await 读一位三态(c.id))!.归零日).toBe(前(30));
    await prisma.followUp.updateMany({ where: { customerId: c.id }, data: { occurredAt: 那天(20) } });
    expect((await 读一位三态(c.id))!.归零日).toBe(前(20));
    // 终判：负责人在线索验证面板判有效（需求状态先选上；推到下一个节点，记一行节点变更）
    当(外贸甲);
    忘掉企业版范围();
    await prisma.project.update({ where: { id: p.id }, data: { demandStatus: "明确需求" } });
    expect(await 以谁的身份(外贸甲.id, () => 线索初判Action(p.id, "有效"))).toMatchObject({ ok: true });
    expect(await prisma.projectNodeLog.count({ where: { projectId: p.id } })).toBe(节点们.length + 1);
    expect((await 读一位三态(c.id))!.归零日).toBe(今天);
  });
});
