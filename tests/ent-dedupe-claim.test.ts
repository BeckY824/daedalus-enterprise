/**
 * 市场成员经号码查重领公海客户（员工反馈 F-016；客户 11-19：「可以进行该公海项目/客户的领取，但……1.必须写沟通记录；2.只能自动分配」）。
 *   - 市场成员查重撞上公海客户能领；客户整体给自动挑中的销售（不落市场成员名下），名下公海项目一起带走
 *   - 新建线索项目（现行，用户 11-19「客户来源以首次永不变更，项目来源以每次新建的为主……客户联系人不变，项目对接人以录入为主」）：
 *     另建一条线索项目（渠道 = 这次选的、对接人 = 这次录的、创建人 = 市场成员、自动分配），沟通挂在它上面，只它计本月已分；
 *     客户的渠道 / 归属渠道、主联系人、原有联系人信息都不改；不补潜客培育
 *     对接人：选客户原有的就挂他（不拿名字认人、不改他，没名字也挂），选「新的人」填名字新建一位（不设主联系人）；渠道必填、不默认带客户来源
 *   - 只领旧项目（查重领取口径.新建线索项目 = false）：多条公海项目取最近进公海的一条（线索公海带出来的不计本月已分）；零项目客户补潜客培育那一条（计）
 *   - 那条项目分配方式「自动分配」、记一行算数的分配记录（计入接手人本月已分，P-转-29）、沟通挂在它上面、通知接手人（P-转-17）、操作日志一条
 *   - 号码没撞上公海 / 不写沟通 / 不是市场成员 / 挑不到人：一行不写（挑不到人整笔回滚、沟通也不记）
 *   - 公海页「领取」对市场成员照旧不开（P-公海-01）
 *   - 原负责人回避（P-公海-04）：用户 11-19「仅对创建人豁免，对其他人有效」——自动分配不挑原负责人、他是客户创建人就能挑；
 *     发起领取的市场成员是原负责人：是客户创建人放行，不是照旧拦（占位账号 + 自己放进公海、开着限定读也认得出）
 *   - 进不来的：移交中、标了无效、设了「只看某人」、兼销售的市场成员、自动分配停用 / 不给市场用
 *   - 挑中的人超了持有上限：顺延下一位；都超了只说原因，不露别人的持有数
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
import { 无负责人占位邮箱 } from "@/lib/pool";
import { 查重领取, 查重领取框数据, 领取, type 查重领取沟通, type 查重领取新项目 } from "@/app/(app)/customers/pool-actions";
import { 查号码 } from "@/app/(app)/customers/number-actions";
import { 不是市场成员查重领取话, 没撞上公海话, 查重领取口径, 落对接人, 查重领取作废 } from "@/lib/enterprise/dedupe-claim";
import { 以谁的身份 } from "@/lib/enterprise/visibility";
import { 只看某人键 } from "@/lib/enterprise/org-core";
import { 默认组织规则 } from "@/lib/project/org-rules";
import { 分配谁能用key } from "@/lib/enterprise/assign-use";
import { 原负责人不能领回提示 } from "@/lib/enterprise/pool-rules";
/** pool-actions.ts 里的那句（"use server" 文件不导出常量） */
const 无效不能领提示 = "标了无效的客户不能领取，要系统管理员先恢复";
import { 不能领公海话 } from "@/lib/enterprise/permissions";

type 人 = { id: string; name: string };
let 总管: 人, 市场: 人, 甲: 人, 乙: 人;
/** 老渠道 = 客户首次的来源（领了也不改）；新渠道 = 这次选的 */
let 老渠道: string, 新渠道: string;
let 进池 = 0;
async function 造人(key: string, name: string, bizRole: string, line?: string): Promise<人> {
  // 建号时间 = 进池先后：甲早于乙，没有回避时本月已分一样多就轮到甲
  const u = await prisma.user.create({ data: { email: `${key}@x`, name, title: "", role: "SALES", password: "x", createdAt: new Date(Date.UTC(2026, 0, 1 + ++进池)) } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, ...(line ? { line } : {}) } });
  return { id: u.id, name };
}
const 当 = (u: 人) => { mocks.user = { ...mocks.user, id: u.id, name: u.name }; };

let 序 = 0;
const 号of = (n: number) => `1390000${String(n).padStart(4, "0")}`;
/**
 * 客户公海里的客户：负责人还是 原（部署前进公海的老数据，原负责人 = 他）；创建人另记。
 * 来源是老渠道（渠道 + 归属渠道）；主联系人王经理（采购）手机就是查的号，另有一位李工
 */
async function 公海客户(原: string, 创建人?: string): Promise<{ id: string; 号: string; 王: string; 李: string }> {
  序 += 1;
  const 号 = 号of(序);
  const c = await prisma.customer.create({ data: { name: `公海客户${序}`, phone: 号, salesOwnerId: 原, channelId: 老渠道, attributionChannelId: 老渠道 } });
  await prisma.customerPool.create({ data: { customerId: c.id, userId: 原, reason: "手动" } });
  if (创建人) await prisma.customerCreator.create({ data: { customerId: c.id, userId: 创建人 } });
  const 李 = await prisma.contact.create({ data: { name: "李工", position: "技术", customerId: c.id, createdAt: new Date("2026-01-02T00:00:00Z") } });
  const 王 = await prisma.contact.create({ data: { name: "王经理", position: "采购", phone: 号, isPrimary: true, customerId: c.id, createdAt: new Date("2026-01-03T00:00:00Z") } });
  return { id: c.id, 号, 王: 王.id, 李: 李.id };
}
/** 新建线索项目那条路交的：这次选新渠道、对接人照带出来的王经理 */
const 新 = (c: { 王: string }, 补: Partial<查重领取新项目> = {}): 查重领取新项目 => ({ 渠道: 新渠道, 对接人: { 原id: c.王 }, ...补 });
const 联系人快照 = (customerId: string) => prisma.contact.findMany({ where: { customerId }, orderBy: { id: "asc" }, select: { id: true, name: true, position: true, phone: true, isPrimary: true } });
/** 线索公海里的项目：负责人清空、留痕里记着放回的人 */
async function 公海项目(customerId: string, 放的人: string, pooledAt: Date): Promise<string> {
  序 += 1;
  const p = await prisma.project.create({ data: { name: `公海项目${序}`, customerId, ownerId: "", creatorId: 放的人, pooledAt } });
  await prisma.projectNodeLog.create({ data: { projectId: p.id, userId: 放的人, kind: "pool-release", fromOwnerId: 放的人, toPhase: "线索", toNode: "潜客培育", at: pooledAt } });
  return p.id;
}
const 沟通 = (补: Partial<查重领取沟通> = {}): 查重领取沟通 => ({ type: "PHONE", content: "客户来电咨询报价", occurredAt: "2026-11-19 10:00", ...补 });
/** 一行不写：客户还在公海、负责人没变、没有沟通、没有分配记录 */
async function 没动(customerId: string, 原: string) {
  const c = await prisma.customer.findUniqueOrThrow({ where: { id: customerId }, include: { pool: true } });
  expect(c.pool).not.toBeNull();
  expect(c.salesOwnerId).toBe(原);
  expect(await prisma.followUp.count({ where: { customerId } })).toBe(0);
  expect(await prisma.entLeadAssign.count()).toBe(0);
  expect(await prisma.project.count({ where: { customerId, pooledAt: null } })).toBe(0);
  expect(await prisma.contact.count({ where: { customerId } })).toBe(2);
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  总管 = await 造人("boss", "总管某", "director");
  市场 = await 造人("mkt", "渠运某", "channel_ops");
  甲 = await 造人("jia", "销售甲某", "sales", "内贸");
  乙 = await 造人("yi", "销售乙某", "sales", "内贸");
  await setSetting("business", { projectMode: true });
  await setSetting(规则.线索分配.key, true);
  await setSetting(自动分配不参与key, { [总管.id]: "禁止" });
  invalidateSettingsCache();
  老渠道 = (await prisma.channel.create({ data: { name: "展会|首次", channelOwnerId: 总管.id } })).id;
  新渠道 = (await prisma.channel.create({ data: { name: "小红书|笔记", channelOwnerId: 总管.id } })).id;
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); 查重领取口径.新建线索项目 = true; });
afterAll(async () => { await prisma.$disconnect(); });

describe("新建线索项目（用户 11-19：项目来源以每次新建的为主、项目对接人以录入为主）", () => {
  it("能领：另建一条线索项目（这次的渠道、王经理对接、市场成员建、自动分配），沟通挂它上面、只它计本月已分；旧公海项目同给甲；客户来源和联系人不改", async () => {
    const c = await 公海客户(总管.id);
    const 早 = await 公海项目(c.id, 总管.id, new Date("2026-11-01T00:00:00Z"));
    const 晚 = await 公海项目(c.id, 总管.id, new Date("2026-11-10T00:00:00Z"));
    const 联系人前 = await 联系人快照(c.id);
    当(市场);
    expect(await 查号码("手机号", c.号)).toMatchObject({ ok: true, 状态: "公海待捞", 市场可领: true });
    const r = await 查重领取("手机号", c.号, 沟通(), c.id, 新(c));
    if (!r.ok) throw new Error(r.error);
    expect(r.接手人).toBe(甲.name);
    expect(r.提示).toContain("新建的线索项目");
    const 客 = await prisma.customer.findUniqueOrThrow({ where: { id: c.id }, include: { pool: true } });
    expect(客).toMatchObject({ salesOwnerId: 甲.id, pool: null, channelId: 老渠道, attributionChannelId: 老渠道 });
    // 客户联系人不变：没多一位、名字职务号码主联系人都照旧
    expect(await 联系人快照(c.id)).toEqual(联系人前);
    const 们 = await prisma.project.findMany({ where: { customerId: c.id } });
    // 不补潜客培育：旧的两条 + 新建的一条
    expect(们).toHaveLength(3);
    expect(们.filter((p) => p.id === 早 || p.id === 晚).map((p) => [p.ownerId, p.pooledAt])).toEqual([[甲.id, null], [甲.id, null]]);
    const 新项目 = 们.find((p) => p.id !== 早 && p.id !== 晚)!;
    expect(新项目).toMatchObject({ ownerId: 甲.id, creatorId: 市场.id, channelId: 新渠道, contactId: c.王, assignMode: "自动分配", pooledAt: null, bizLine: "内贸" });
    // 市场分给销售：进线索验证（同新线索自动分配）
    expect(新项目.node).toBe("线索验证");
    const 记 = await prisma.entLeadAssign.findMany();
    expect(记).toHaveLength(1);
    expect(记[0]).toMatchObject({ projectId: 新项目.id, toUserId: 甲.id, byUserId: 市场.id, counted: true, way: "自动分配", line: "内贸" });
    expect(await 本月已分(甲.id)).toBe(1);
    const 跟进 = await prisma.followUp.findMany({ where: { customerId: c.id }, include: { projectNode: true } });
    expect(跟进).toHaveLength(1);
    expect(跟进[0]).toMatchObject({ ownerId: 市场.id, content: "客户来电咨询报价", type: "PHONE" });
    expect(跟进[0].projectNode?.projectId).toBe(新项目.id);
    expect(await prisma.entNotice.count({ where: { userId: 甲.id, kind: "自动分配" } })).toBe(1);
    const 日志 = await prisma.auditLog.findFirst({ where: { entity: "Customer", entityId: c.id, action: "claim" } });
    expect(日志?.summary).toContain("经号码查重");
    expect(日志?.summary).toContain("新建线索项目");
    // 项目上也有一条「分配新线索」；通知里说名下还带出来几条旧项目
    expect((await prisma.auditLog.findFirst({ where: { entity: "Project", entityId: 新项目.id } }))?.summary).toMatch(/^分配新线索「.*」给 销售甲某（内贸）$/);
    const 通知 = await prisma.entNotice.findFirstOrThrow({ where: { userId: 甲.id, kind: "自动分配" } });
    expect(JSON.stringify(通知)).toContain("名下还有 2 条从公海带出来的旧项目");
  });

  it("零项目客户：只建这一条新线索项目，不补潜客培育", async () => {
    const c = await 公海客户(总管.id);
    当(市场);
    const r = await 查重领取("手机号", c.号, 沟通(), null, 新(c));
    if (!r.ok) throw new Error(r.error);
    const 们 = await prisma.project.findMany({ where: { customerId: c.id } });
    expect(们).toHaveLength(1);
    expect(们[0]).toMatchObject({ ownerId: 甲.id, creatorId: 市场.id, channelId: 新渠道, assignMode: "自动分配" });
    expect(await prisma.followUpProject.count({ where: { projectId: 们[0].id } })).toBe(1);
    expect(await 本月已分(甲.id)).toBe(1);
  });

  it("选的是客户原有的王经理：直接挂他，交来的名字职务不管（不拿名字认人），他的信息一律不改", async () => {
    const c = await 公海客户(总管.id);
    const 前 = await 联系人快照(c.id);
    当(市场);
    const r = await 查重领取("手机号", c.号, 沟通(), c.id, 新(c, { 对接人: { 原id: c.王, 名字: "王小姐", 职务: "采购总监" } }));
    if (!r.ok) throw new Error(r.error);
    expect((await prisma.project.findFirstOrThrow({ where: { customerId: c.id } })).contactId).toBe(c.王);
    expect(await 联系人快照(c.id)).toEqual(前);
  });

  it("号码撞上的那位没填名字：框里默认就是他，直接挂他、不要名字", async () => {
    const c = await 公海客户(总管.id);
    await prisma.contact.update({ where: { id: c.王 }, data: { name: "" } });
    当(市场);
    const 框 = await 查重领取框数据("手机号", c.号);
    if (!框.ok) throw new Error(框.error);
    expect(框.默认对接人).toBe(c.王);
    const r = await 查重领取("手机号", c.号, 沟通(), c.id, 新(c));
    if (!r.ok) throw new Error(r.error);
    expect((await prisma.project.findFirstOrThrow({ where: { customerId: c.id } })).contactId).toBe(c.王);
    expect(await prisma.contact.count({ where: { customerId: c.id } })).toBe(2);
  });

  it("选「新的人」：名字必填，在客户下新建一位（不设主联系人），只挂这条新项目；和李工同名也新建，不拿名字认人；王经理仍是主联系人", async () => {
    const c = await 公海客户(总管.id);
    const 前 = await 联系人快照(c.id);
    当(市场);
    const r = await 查重领取("手机号", c.号, 沟通(), c.id, 新(c, { 对接人: { 原id: null, 名字: "李工", 职务: "助理" } }));
    if (!r.ok) throw new Error(r.error);
    const 后 = await 联系人快照(c.id);
    expect(后).toHaveLength(3);
    expect(后.filter((x) => 前.some((y) => y.id === x.id))).toEqual(前);
    const 新人 = 后.find((x) => !前.some((y) => y.id === x.id))!;
    expect(新人).toMatchObject({ name: "李工", position: "助理", isPrimary: false, phone: null });
    expect(await prisma.contactCustomer.count({ where: { contactId: 新人.id, customerId: c.id } })).toBe(1);
    expect((await prisma.project.findFirstOrThrow({ where: { customerId: c.id } })).contactId).toBe(新人.id);
  });

  it("事务里再核对接人：认完到写入之间被删 / 移到别的客户名下，抛作废整笔回滚", async () => {
    const c = await 公海客户(总管.id);
    const 别家 = await prisma.customer.create({ data: { name: "别家", phone: 号of(801), salesOwnerId: 乙.id } });
    await prisma.contact.update({ where: { id: c.王 }, data: { deletedAt: new Date() } });
    await expect(prisma.$transaction((tx) => 落对接人(tx, c.id, { 挂: c.王 }, 市场.id))).rejects.toBeInstanceOf(查重领取作废);
    await prisma.contact.update({ where: { id: c.李 }, data: { customerId: 别家.id } });
    await expect(prisma.$transaction((tx) => 落对接人(tx, c.id, { 挂: c.李 }, 市场.id))).rejects.toBeInstanceOf(查重领取作废);
  });

  it("渠道必填、不默认带客户来源；停用的渠道不认；对接人必填；带出来的那位不在这位客户名下不认：一行不写", async () => {
    const c = await 公海客户(总管.id);
    const 别家 = await prisma.customer.create({ data: { name: "别家", phone: 号of(800), salesOwnerId: 乙.id } });
    const 别家人 = await prisma.contact.create({ data: { name: "王经理", customerId: 别家.id } });
    const 停用 = await prisma.channel.create({ data: { name: "停了的", channelOwnerId: 总管.id, active: false } });
    当(市场);
    const 拒 = async (n: 查重领取新项目 | undefined, 含: string) => {
      const r = await 查重领取("手机号", c.号, 沟通(), c.id, n);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain(含);
    };
    await 拒(undefined, "请选这次的渠道");
    await 拒(新(c, { 渠道: "" }), "请选这次的渠道");
    await 拒(新(c, { 渠道: 停用.id }), "停用");
    await 拒(新(c, { 对接人: { 原id: null, 名字: "  " } }), "请填写这次的对接人");
    await 拒(新(c, { 对接人: null }), "请填写这次的对接人");
    await 拒(新(c, { 对接人: { 原id: 别家人.id, 名字: "王经理" } }), "不在这位客户名下");
    await 没动(c.id, 总管.id);
  });

  it("挑不到人：新联系人、新项目、沟通都不留（整笔回滚）", async () => {
    const c = await 公海客户(总管.id);
    await setSetting(自动分配不参与key, { [总管.id]: "禁止", [甲.id]: "暂停", [乙.id]: "禁止" });
    invalidateSettingsCache();
    当(市场);
    const r = await 查重领取("手机号", c.号, 沟通(), c.id, 新(c, { 对接人: { 原id: null, 名字: "新来的赵总" } }));
    expect(r.ok).toBe(false);
    expect(await prisma.contact.count({ where: { name: "新来的赵总" } })).toBe(0);
    await 没动(c.id, 总管.id);
    expect(await prisma.project.count({ where: { customerId: c.id } })).toBe(0);
  });

  it("框数据：渠道们、客户联系人（带职务）、默认对接人 = 号码撞上的王经理；不是市场成员不给", async () => {
    const c = await 公海客户(总管.id);
    当(市场);
    const 框 = await 查重领取框数据("手机号", c.号);
    if (!框.ok) throw new Error(框.error);
    expect(框.新建线索项目).toBe(true);
    expect(框.默认对接人).toBe(c.王);
    expect(框.联系人们).toEqual(expect.arrayContaining([{ id: c.王, name: "王经理", position: "采购" }, { id: c.李, name: "李工", position: "技术" }]));
    expect(框.渠道们.map((x) => x.id)).toEqual(expect.arrayContaining([老渠道, 新渠道]));
    当(乙);
    expect(await 查重领取框数据("手机号", c.号)).toEqual({ ok: false, error: 不是市场成员查重领取话 });
  });
});

describe("只领旧项目（查重领取口径.新建线索项目 = false，好退回的那条路）", () => {
  beforeEach(() => { 查重领取口径.新建线索项目 = false; });

  it("能领：客户整体给自动挑中的销售，最近进公海的那条项目记自动分配（公海带出来的不计本月已分）、挂上沟通，通知接手人、记操作日志", async () => {
    const c = await 公海客户(总管.id);
    const 早 = await 公海项目(c.id, 总管.id, new Date("2026-11-01T00:00:00Z"));
    const 晚 = await 公海项目(c.id, 总管.id, new Date("2026-11-10T00:00:00Z"));
    当(市场);
    const r = await 查重领取("手机号", c.号, 沟通());
    if (!r.ok) throw new Error(r.error);
    // 甲建号早、本月都 0 条：轮到甲
    expect(r.接手人).toBe(甲.name);
    const 客 = await prisma.customer.findUniqueOrThrow({ where: { id: c.id }, include: { pool: true } });
    expect(客.salesOwnerId).toBe(甲.id);
    expect(客.pool).toBeNull();
    // 名下公海项目都随客户给甲；只有最近进公海的那条记自动分配、挂沟通
    const 们 = await prisma.project.findMany({ where: { customerId: c.id } });
    expect(们.map((p) => [p.id, p.ownerId, p.pooledAt])).toEqual(expect.arrayContaining([[早, 甲.id, null], [晚, 甲.id, null]]));
    expect(们.find((p) => p.id === 晚)?.assignMode).toBe("自动分配");
    const 记 = await prisma.entLeadAssign.findMany();
    expect(记).toHaveLength(1);
    // 从线索公海带出来的那条不计本月已分（同 assign-actions：counted && !pooledAt）
    expect(记[0]).toMatchObject({ projectId: 晚, toUserId: 甲.id, byUserId: 市场.id, counted: false, way: "自动分配", line: "内贸" });
    expect(await 本月已分(甲.id)).toBe(0);
    expect((await prisma.auditLog.findFirst({ where: { entity: "Project", entityId: 晚 } }))?.summary).toContain("，不计数");
    const 跟进 = await prisma.followUp.findMany({ where: { customerId: c.id }, include: { projectNode: true } });
    expect(跟进).toHaveLength(1);
    expect(跟进[0]).toMatchObject({ ownerId: 市场.id, content: "客户来电咨询报价", type: "PHONE" });
    expect(跟进[0].projectNode?.projectId).toBe(晚);
    expect(await prisma.entNotice.count({ where: { userId: 甲.id, kind: "自动分配" } })).toBe(1);
    const 日志 = await prisma.auditLog.findFirst({ where: { entity: "Customer", entityId: c.id, action: "claim" } });
    expect(日志?.summary).toContain("经号码查重");
    expect(日志?.summary).toContain(甲.name);
  });

  it("零项目客户：出公海补潜客培育那一条，分配方式自动分配，沟通挂在它上面", async () => {
    const c = await 公海客户(总管.id);
    当(市场);
    const r = await 查重领取("手机号", c.号, 沟通());
    if (!r.ok) throw new Error(r.error);
    const 们 = await prisma.project.findMany({ where: { customerId: c.id } });
    expect(们).toHaveLength(1);
    expect(们[0]).toMatchObject({ ownerId: 甲.id, creatorId: 市场.id, assignMode: "自动分配", node: "潜客培育" });
    expect(await prisma.contact.count({ where: { customerId: c.id } })).toBe(2);
    const 跟进 = await prisma.followUpProject.findMany({ where: { projectId: 们[0].id } });
    expect(跟进).toHaveLength(1);
    expect(await prisma.entLeadAssign.count({ where: { projectId: 们[0].id, counted: true } })).toBe(1);
    expect(await 本月已分(甲.id)).toBe(1);
  });

  it("框数据：只给记沟通那几格（不要渠道、对接人）", async () => {
    const c = await 公海客户(总管.id);
    当(市场);
    expect(await 查重领取框数据("手机号", c.号)).toMatchObject({ ok: true, 新建线索项目: false, 客户名: expect.stringMatching(/^公海客户/), 渠道们: [], 联系人们: [] });
  });
});

describe("市场成员查重领公海客户：拦的几种", () => {
  it("号码没撞上公海里的客户：不领（在销售名下的、没人录过的都一样），也不信交来的客户 id", async () => {
    const 在名下 = await prisma.customer.create({ data: { name: "乙的客户", phone: 号of(900), salesOwnerId: 乙.id } });
    const c = await 公海客户(总管.id);
    当(市场);
    expect(await 查重领取("手机号", 号of(900), 沟通(), null, 新(c))).toEqual({ ok: false, error: 没撞上公海话 });
    expect(await 查重领取("手机号", 号of(901), 沟通(), null, 新(c))).toEqual({ ok: false, error: 没撞上公海话 });
    // 号码撞的是公海客户 c，交来的 id 却是别的：按最新结论说，不领
    expect(await 查重领取("手机号", c.号, 沟通(), 在名下.id, 新(c))).toEqual({ ok: false, error: 没撞上公海话 });
    await 没动(c.id, 总管.id);
  });

  it("不写沟通（内容空）被拒，一行不写", async () => {
    const c = await 公海客户(总管.id);
    当(市场);
    const r = await 查重领取("手机号", c.号, 沟通({ content: "   " }), null, 新(c));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("沟通内容");
    await 没动(c.id, 总管.id);
  });

  it("不是市场成员（销售）不走这条：照旧去公海页领", async () => {
    const c = await 公海客户(总管.id);
    当(乙);
    expect(await 查重领取("手机号", c.号, 沟通(), null, 新(c))).toEqual({ ok: false, error: 不是市场成员查重领取话 });
    expect(await 查号码("手机号", c.号)).not.toHaveProperty("市场可领");
    await 没动(c.id, 总管.id);
  });

  it("自动分配挑不到人（销售都暂停 / 禁止了）：不领、整笔回滚，沟通也不记，说清原因", async () => {
    const c = await 公海客户(总管.id);
    await 公海项目(c.id, 总管.id, new Date("2026-11-10T00:00:00Z"));
    await setSetting(自动分配不参与key, { [总管.id]: "禁止", [甲.id]: "暂停", [乙.id]: "禁止" });
    invalidateSettingsCache();
    当(市场);
    const r = await 查重领取("手机号", c.号, 沟通(), null, 新(c));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^没有自动分出去：.*这次没领，客户还在公海，沟通也没记/);
    const 客 = await prisma.customer.findUniqueOrThrow({ where: { id: c.id }, include: { pool: true } });
    expect(客.pool).not.toBeNull();
    expect(await prisma.followUp.count({ where: { customerId: c.id } })).toBe(0);
    expect(await prisma.entLeadAssign.count()).toBe(0);
    expect(await prisma.project.count({ where: { customerId: c.id, pooledAt: { not: null } } })).toBe(1);
  });

  it("移交中、标了无效：框打不开、领不了，一行不写", async () => {
    const c = await 公海客户(总管.id);
    await prisma.entHandover.create({ data: { kind: "转让", fromUserId: 总管.id, toUserId: 乙.id, byUserId: 总管.id, customerIds: JSON.stringify([c.id]) } });
    当(市场);
    const 框 = await 查重领取框数据("手机号", c.号);
    expect(框.ok).toBe(false);
    if (!框.ok) expect(框.error).toContain("正在移交");
    const r = await 查重领取("手机号", c.号, 沟通(), c.id, 新(c));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("正在移交");
    await 没动(c.id, 总管.id);
    const d = await 公海客户(总管.id);
    await prisma.customer.update({ where: { id: d.id }, data: { poolInvalidAt: new Date() } });
    expect(await 查重领取框数据("手机号", d.号)).toEqual({ ok: false, error: 无效不能领提示 });
    expect(await 查重领取("手机号", d.号, 沟通(), d.id, 新(d))).toEqual({ ok: false, error: 无效不能领提示 });
    await 没动(d.id, 总管.id);
  });

  it("设了「只看某人」的市场成员、兼销售的市场成员：不是这条路，查号码也不给键", async () => {
    const c = await 公海客户(总管.id);
    await setSetting(只看某人键, { [市场.id]: 甲.id });
    invalidateSettingsCache();
    忘掉企业版范围();
    当(市场);
    expect(await 查重领取("手机号", c.号, 沟通(), c.id, 新(c))).toEqual({ ok: false, error: 不是市场成员查重领取话 });
    expect(await 查号码("手机号", c.号)).not.toHaveProperty("市场可领");
    const 兼 = await 造人("mix", "兼销售某", "channel_ops,sales", "内贸");
    当(兼);
    expect(await 查重领取("手机号", c.号, 沟通(), c.id, 新(c))).toEqual({ ok: false, error: 不是市场成员查重领取话 });
    expect(await 查重领取框数据("手机号", c.号)).toEqual({ ok: false, error: 不是市场成员查重领取话 });
    await 没动(c.id, 总管.id);
  });

  it("自动分配不给市场角色用（谁能用里去掉）：按现有的话拦，一行不写", async () => {
    const c = await 公海客户(总管.id);
    await setSetting(分配谁能用key, { "dict-assign-1": ["sales"] });
    invalidateSettingsCache();
    当(市场);
    const r = await 查重领取("手机号", c.号, 沟通(), c.id, 新(c));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/自动分配/);
    await 没动(c.id, 总管.id);
  });

  it("挑中的人超了持有上限：顺延下一位；都超了只说原因，不露别的销售的持有数和上限", async () => {
    const 规 = (每人上限: Record<string, number>) => setSetting("orgRules", { ...默认组织规则, 公海: { ...默认组织规则.公海, 持有上限开: true, 默认上限: 10, 每人上限 } });
    await 规({ [甲.id]: 0 });
    invalidateSettingsCache();
    const c = await 公海客户(总管.id);
    当(市场);
    const r = await 查重领取("手机号", c.号, 沟通(), c.id, 新(c));
    if (!r.ok) throw new Error(r.error);
    expect(r.接手人).toBe(乙.name);
    await 规({ [甲.id]: 0, [乙.id]: 0 });
    invalidateSettingsCache();
    const d = await 公海客户(总管.id);
    const r2 = await 查重领取("手机号", d.号, 沟通(), d.id, 新(d));
    expect(r2).toEqual({ ok: false, error: "没有自动分出去：能接的销售名下客户都到持有上限了。这次没领，客户还在公海，沟通也没记；请找销售管理处理" });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: d.id }, include: { pool: true } })).pool).not.toBeNull();
    expect(await prisma.followUp.count({ where: { customerId: d.id } })).toBe(0);
    expect(await prisma.project.count({ where: { customerId: d.id } })).toBe(0);
    expect(await prisma.entLeadAssign.count()).toBe(1);
  });

  it("公海页「领取」对市场成员照旧不开（P-公海-01）", async () => {
    const c = await 公海客户(总管.id);
    当(市场);
    expect(await 领取([c.id])).toEqual({ ok: false, error: 不能领公海话 });
  });
});

describe("原负责人回避（用户 11-19：仅对创建人豁免，对其他人有效）", () => {
  it("自动分配不挑原负责人（甲放进公海、不是创建人）：本该轮到甲，给了乙", async () => {
    const c = await 公海客户(甲.id, 总管.id);
    当(市场);
    const r = await 查重领取("手机号", c.号, 沟通(), null, 新(c));
    if (!r.ok) throw new Error(r.error);
    expect(r.接手人).toBe(乙.name);
  });

  it("原负责人就是客户创建人：不回避，照常轮到甲", async () => {
    const c = await 公海客户(甲.id, 甲.id);
    当(市场);
    const r = await 查重领取("手机号", c.号, 沟通(), null, 新(c));
    if (!r.ok) throw new Error(r.error);
    expect(r.接手人).toBe(甲.name);
  });

  it("占位负责人的客户：按最近一条 pool-release 认原负责人（甲），照样回避", async () => {
    const 占位 = await prisma.user.create({ data: { email: 无负责人占位邮箱, name: "无负责人", role: "SALES", password: "x", active: false } });
    const c = await 公海客户(占位.id);
    await prisma.customerOwnerLog.create({ data: { customerId: c.id, userId: 甲.id, fromOwnerId: 甲.id, toOwnerId: 占位.id, kind: "pool-release" } });
    当(市场);
    const r = await 查重领取("手机号", c.号, 沟通(), null, 新(c));
    if (!r.ok) throw new Error(r.error);
    expect(r.接手人).toBe(乙.name);
  });

  it("发起的市场成员是原负责人、不是客户创建人：照旧领不回，向导也不给键", async () => {
    const c = await 公海客户(市场.id, 总管.id);
    当(市场);
    expect(await 查号码("手机号", c.号)).toMatchObject({ 状态: "公海待捞", 原负责人是我: true });
    expect(await 查号码("手机号", c.号)).not.toHaveProperty("市场可领");
    expect(await 查重领取("手机号", c.号, 沟通(), null, 新(c))).toEqual({ ok: false, error: 原负责人不能领回提示 });
    await 没动(c.id, 市场.id);
  });

  it("占位账号 + 是市场成员自己放进公海的（开着限定读）：认得出是原负责人，拦下、不给键、框打不开", async () => {
    const 占位 = await prisma.user.create({ data: { email: 无负责人占位邮箱, name: "无负责人", role: "SALES", password: "x", active: false } });
    const c = await 公海客户(占位.id, 总管.id);
    await prisma.customerOwnerLog.create({ data: { customerId: c.id, userId: 市场.id, fromOwnerId: 市场.id, toOwnerId: 占位.id, kind: "pool-release" } });
    当(市场);
    const 查 = await 以谁的身份(市场.id, () => 查号码("手机号", c.号));
    expect(查).toMatchObject({ 状态: "公海待捞", 原负责人是我: true });
    expect(查).not.toHaveProperty("市场可领");
    expect(await 以谁的身份(市场.id, () => 查重领取框数据("手机号", c.号))).toEqual({ ok: false, error: 原负责人不能领回提示 });
    expect(await 以谁的身份(市场.id, () => 查重领取("手机号", c.号, 沟通(), c.id, 新(c)))).toEqual({ ok: false, error: 原负责人不能领回提示 });
    await 没动(c.id, 占位.id);
  });

  it("发起的市场成员是原负责人、又是客户创建人：放行，照常领取 + 写沟通 + 自动分配", async () => {
    const c = await 公海客户(市场.id, 市场.id);
    当(市场);
    const 查 = await 查号码("手机号", c.号);
    expect(查).toMatchObject({ 状态: "公海待捞", 市场可领: true });
    // 两个不同时为真：给了键就不带「原负责人是我」
    expect(查).not.toHaveProperty("原负责人是我");
    const r = await 查重领取("手机号", c.号, 沟通(), null, 新(c));
    if (!r.ok) throw new Error(r.error);
    const 客 = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
    expect(客.salesOwnerId).toBe(甲.id);
    expect(await prisma.followUp.count({ where: { customerId: c.id, ownerId: 市场.id } })).toBe(1);
  });
});

// 判无效待补（11-20，lib/enterprise/invalid-makeup.ts）：查重领取新建线索项目也是新线索自动分配，有待补的先补发，补发不算本月已分
describe("查重领取用判无效待补", () => {
  it("乙有内贸待补：补发给乙（本来轮到甲），分配记录 counted=false、待补记用在这条上", async () => {
    await prisma.entLeadMakeup.create({ data: { userId: 乙.id, projectId: "坏线索", line: "内贸" } });
    const c = await 公海客户(总管.id);
    当(市场);
    const r = await 查重领取("手机号", c.号, 沟通(), c.id, 新(c));
    if (!r.ok) throw new Error(r.error);
    expect(r.接手人).toBe(乙.name);
    const 记 = await prisma.entLeadAssign.findFirstOrThrow();
    expect(记).toMatchObject({ toUserId: 乙.id, counted: false });
    expect(await prisma.entLeadMakeup.findFirstOrThrow()).toMatchObject({ usedAssignId: 记.id, usedProjectId: 记.projectId });
    expect(await 本月已分(乙.id)).toBe(0);
  });

  it("只领旧公海项目（不计本月已分）：不用待补，照轮转给甲", async () => {
    查重领取口径.新建线索项目 = false;
    await prisma.entLeadMakeup.create({ data: { userId: 乙.id, projectId: "坏线索", line: "内贸" } });
    const c = await 公海客户(总管.id);
    await 公海项目(c.id, 总管.id, new Date("2026-11-01T00:00:00Z"));
    当(市场);
    const r = await 查重领取("手机号", c.号, 沟通(), c.id);
    if (!r.ok) throw new Error(r.error);
    expect(r.接手人).toBe(甲.name);
    expect((await prisma.entLeadMakeup.findFirstOrThrow()).usedAt).toBeNull();
  });
});
