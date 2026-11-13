/**
 * 离职交接也要接手人确认才生效（客户 11-13 原话「离职交接也必须接手人点确认才生效」「避免悄悄转过去没人知道」，企业版固定如此、不做开关）：
 *   - 「项目 → 离职交接」交一位客户 / 交一个项目 / 全部交给：只记一行待确认，负责人不换、备注不写；接手人收到「等你确认」
 *   - 接手人确认：照原来当场交的老规矩转（项目、待办跟着走、记历史负责人、操作人 = 发起人），客户备注留一行（确认当天、操作人写发起人）；发起人收到通知
 *   - 拒收、撤回：原样；只有接手人能拒收，发起人和总管理能撤回、改接手人
 *   - 同一位客户 / 同一个项目不能重复发起；单条在等时不能全部交给，全部在等时不能再单条
 *   - 交接期间被别的路径动了（进了公海、被别人领走）：确认时跳过并说清
 *   - 离职交接不作废（挂满 7 天的申请移交才作废）；看板带挂起天数；恢复启用把他所有没确认的都撤回
 *   - 三态挂起：单条交项目不把他名下客户算成「交接中」
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "a@x", role: "SALES", title: "", avatar: null as string | null },
  项目模式: true,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: mocks.项目模式 }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 等通知推完 } from "@/lib/enterprise/notify";
import { deactivateUser, reactivateUser } from "@/app/(app)/settings/actions";
import { 交接客户, 交接项目, 交接全部 } from "@/app/(app)/projects/handover/actions";
import { 待确认的交接, 确认交接, 撤回交接, 拒收交接, 改接手人 } from "@/app/(app)/customers/handover-actions";
import { 读离职交接, 交接备注行 } from "@/lib/enterprise/offboard-handover";
import { 挂起移交作废 } from "@/lib/enterprise/handover-expire";
import { 离职交接中的 } from "@/lib/enterprise/tri-state-db";
import { beijingDay } from "@/lib/business-clock";

let 系统: string, 上级: string, 离职: string, 接手: string, 别的销售: string;
let 号 = 0;
const 名: Record<string, string> = {};
const 当 = (id: string, role = "SALES") => { mocks.user = { ...mocks.user, id, role, name: 名[id] ?? id }; };
const 建人 = async (email: string, bizRole: string, managerId: string | null = null, role = "SALES") => {
  const id = (await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } })).id;
  await prisma.entMember.create({ data: { userId: id, bizRole, managerId } });
  名[id] = email;
  return id;
};
const 建客户 = (salesOwnerId: string, remark: string | null = null) =>
  prisma.customer.create({ data: { name: `客户${++号}`, phone: `1390000${String(号).padStart(4, "0")}`, salesOwnerId, followStatus: "待跟进", remark } });
const 建项目 = (customerId: string, ownerId: string) => prisma.project.create({ data: { name: `项目${++号}`, customerId, ownerId, creatorId: ownerId } });
const 归谁 = async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id } })).salesOwnerId;
const 项目归谁 = async (id: string) => (await prisma.project.findUniqueOrThrow({ where: { id } })).ownerId;
const 备注 = async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id } })).remark ?? "";
const 状态 = async (id: string) => (await prisma.entHandover.findUniqueOrThrow({ where: { id } })).status;
const 交接通知们 = (userId: string) => prisma.entNotice.findMany({ where: { userId, kind: "交接" }, orderBy: { createdAt: "asc" } });
const 发起了 = (r: { ok: boolean; 交接?: string }) => { expect(r).toMatchObject({ ok: true }); return r.交接!; };

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  mocks.项目模式 = true;
  号 = 0;
  系统 = await 建人("sys", "director", null, "ADMIN");
  上级 = await 建人("mgr", "sales_mgr");
  离职 = await 建人("leaver", "sales", 上级);
  接手 = await 建人("taker", "sales", 上级);
  别的销售 = await 建人("other", "sales");
});
afterEach(() => { vi.unstubAllEnvs(); });

/** 离职的人名下：一位客户（带一个项目、一条待办，备注已有一行）、一个挂在别人客户上的项目、一条线索、一个渠道；办完离职 */
async function 摆数据() {
  const c = await 建客户(离职, "老备注");
  const p跟客户 = await 建项目(c.id, 离职);
  const t = await prisma.task.create({ data: { title: "回电", customerId: c.id, ownerId: 离职 } });
  const 别人客户 = await 建客户(接手);
  const p单独 = await 建项目(别人客户.id, 离职);
  const lead = await prisma.lead.create({ data: { name: "线索甲", ownerId: 离职 } });
  const ch = await prisma.channel.create({ data: { name: "渠道甲|其他", channelOwnerId: 离职 } });
  当(系统, "ADMIN");
  await deactivateUser(离职, "");
  当(上级);
  return { c, p跟客户, t, 别人客户, p单独, lead, ch };
}

describe("发起：只记一行待确认，什么都不换", () => {
  it("交一位客户：负责人、项目、待办、备注都不动；接手人「等你确认」里看得到、看板上这一行等他确认", async () => {
    const d = await 摆数据();
    const r = await 交接客户(离职, d.c.id, 接手);
    expect(r).toMatchObject({ ok: true, message: expect.stringContaining("确认后才转") });
    const id = 发起了(r);
    expect(await 归谁(d.c.id)).toBe(离职);
    expect(await 项目归谁(d.p跟客户.id)).toBe(离职);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: d.t.id } })).ownerId).toBe(离职);
    expect(await 备注(d.c.id)).toBe("老备注");
    expect(await prisma.customerOwnerLog.count()).toBe(0);
    expect(await prisma.entHandover.findUniqueOrThrow({ where: { id } })).toMatchObject({ kind: "离职", way: "客户", fromUserId: 离职, toUserId: 接手, byUserId: 上级, status: "待确认" });

    当(接手);
    const { 等我确认 } = await 待确认的交接();
    expect(等我确认).toHaveLength(1);
    expect(等我确认[0]).toMatchObject({ id, kind: "离职", 我能确认: true, 离职说: `1 位客户：${d.c.name}` });

    当(上级);
    const { 我发起的 } = await 待确认的交接();
    expect(我发起的[0]).toMatchObject({ id, 我能撤回: true, 我能改接手人: true });
    const [p] = await 读离职交接({ id: 上级, role: "SALES" });
    expect(p.客户[0].交接中).toMatchObject({ id, 接手人: "taker", 接手人id: 接手, 我能撤回: true, 挂起天数: 0 });
    expect(p).toMatchObject({ 交接中: false, 单条等确认: 1 });
  });

  it("发起时接手人收到「等你确认」：标题带离职的人和客户名，链客户页（确认在那儿），不带手机号；上级、离职的人不收", async () => {
    const d = await 摆数据();
    发起了(await 交接客户(离职, d.c.id, 接手));
    await 等通知推完();
    const 收到 = await 交接通知们(接手);
    expect(收到).toHaveLength(1);
    expect(收到[0].title).toContain("leaver 离职");
    expect(收到[0].title).toContain(d.c.name);
    expect(收到[0].title).toContain("等你确认");
    expect(收到[0].link).toBe("/customers");
    expect(`${收到[0].title}${收到[0].body}`).not.toContain(d.c.phone!);
    expect(await prisma.entNotice.count({ where: { userId: { in: [上级, 离职] } } })).toBe(0);
  });

  it("交一个项目、全部交给：一样只记待确认；通知说清交的是什么", async () => {
    const d = await 摆数据();
    const p = 发起了(await 交接项目(离职, d.p单独.id, 接手));
    expect(await 项目归谁(d.p单独.id)).toBe(离职);
    expect(await prisma.entHandover.findUniqueOrThrow({ where: { id: p } })).toMatchObject({ way: "项目", projectIds: JSON.stringify([d.p单独.id]) });
    await 等通知推完();
    expect((await 交接通知们(接手))[0].title).toContain(d.p单独.name);
    当(系统, "ADMIN");
    expect(await 撤回交接(p)).toMatchObject({ ok: true });
    当(上级);
    const 全 = await 交接全部(离职, 接手);
    expect(全).toMatchObject({ ok: true, message: expect.stringContaining("1 位客户、2 个项目") });
    const 全id = 发起了(全);
    expect(await 归谁(d.c.id)).toBe(离职);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: d.lead.id } })).ownerId).toBe(离职);
    await 等通知推完();
    const 汇总 = (await 交接通知们(接手)).find((n) => n.dedupeKey === `handover:${全id}:发起`)!;
    expect(汇总.title).toContain("1 位客户、2 个项目");
    expect(汇总.body).toContain(d.c.name);
    // 看板：整张卡在等确认
    const [x] = await 读离职交接({ id: 上级, role: "SALES" });
    expect(x).toMatchObject({ 交接中: true, 整包: { id: 全id, 接手人: "taker" } });
    expect(x.客户[0].交接中?.id).toBe(全id);
    expect(x.项目[0].交接中?.id).toBe(全id);
  });

  it("名下已经没东西：全部交给不建交接", async () => {
    await 建人("empty", "sales", 上级);
    const 空 = Object.keys(名).find((k) => 名[k] === "empty")!;
    当(系统, "ADMIN");
    await deactivateUser(空, "");
    当(上级);
    expect(await 交接全部(空, 接手)).toEqual({ ok: true, message: "TA 名下已经没有要交的了" });
    expect(await prisma.entHandover.count()).toBe(0);
  });
});

describe("不能重复发起", () => {
  it("同一位客户、同一个项目在等就挡；别的客户照交；单条在等不能全部交给，全部在等不能再单条", async () => {
    const d = await 摆数据();
    const c2 = await 建客户(离职);
    const 一 = 发起了(await 交接客户(离职, d.c.id, 接手));
    expect(await 交接客户(离职, d.c.id, 别的销售)).toMatchObject({ ok: false, error: expect.stringContaining("已经交给 taker、在等确认") });
    发起了(await 交接项目(离职, d.p单独.id, 接手));
    expect(await 交接项目(离职, d.p单独.id, 别的销售)).toMatchObject({ ok: false, error: expect.stringContaining("这个项目已经交给") });
    发起了(await 交接客户(离职, c2.id, 别的销售));
    expect(await 交接全部(离职, 接手)).toMatchObject({ ok: false, error: expect.stringContaining("还有 3 笔单条交接在等接手人确认") });
    expect(await prisma.entHandover.count()).toBe(3);
    // 都了结了才能全部交给；全部在等时单条都挡
    for (const h of await prisma.entHandover.findMany({ where: { status: "待确认" } })) expect((await 撤回交接(h.id)).ok).toBe(true);
    void 一;
    发起了(await 交接全部(离职, 接手));
    expect(await 交接客户(离职, c2.id, 别的销售)).toMatchObject({ ok: false, error: expect.stringContaining("全部交给 taker、在等确认") });
  });

  it("两个人同时发起同一位客户：只成一笔", async () => {
    const d = await 摆数据();
    const [a, b] = await Promise.all([交接客户(离职, d.c.id, 接手), 交接客户(离职, d.c.id, 别的销售)]);
    expect([a, b].filter((r) => r.ok)).toHaveLength(1);
    expect(await prisma.entHandover.count({ where: { status: "待确认" } })).toBe(1);
  });
});

describe("接手人确认：才真转", () => {
  it("交一位客户：确认后换负责人，项目、待办跟着走，记历史负责人（操作人 = 发起人），备注留一行（确认当天、操作人写发起人）；发起人收到通知", async () => {
    const d = await 摆数据();
    const id = 发起了(await 交接客户(离职, d.c.id, 接手));
    // 只有接手人能确认
    当(别的销售);
    expect(await 确认交接(id)).toMatchObject({ ok: false, error: "只有接手人自己能确认" });
    expect(await 归谁(d.c.id)).toBe(离职);
    当(接手);
    const r = await 确认交接(id);
    expect(r).toEqual({ ok: true, 客户: 1, 说: "已接手 1 位客户" });
    expect(await 状态(id)).toBe("已确认");
    expect(await 归谁(d.c.id)).toBe(接手);
    expect(await 项目归谁(d.p跟客户.id)).toBe(接手);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: d.t.id } })).ownerId).toBe(接手);
    expect(await 项目归谁(d.p单独.id)).toBe(离职);
    expect(await prisma.customerOwnerLog.findFirst({ where: { customerId: d.c.id } })).toMatchObject({ fromOwnerId: 离职, toOwnerId: 接手, kind: "deactivate", userId: 上级 });
    expect(await 备注(d.c.id)).toBe(`老备注\n${交接备注行(beijingDay(new Date()), "leaver", "taker", "mgr")}`);
    await 等通知推完();
    const 给发起人 = await 交接通知们(上级);
    expect(给发起人).toHaveLength(1);
    expect(给发起人[0].title).toContain("taker 确认接手了 leaver 名下的 1 位客户");
    // 接手人那条「等你确认」标已读
    expect((await prisma.entNotice.findFirstOrThrow({ where: { userId: 接手, dedupeKey: `handover:${id}:发起` } })).readAt).not.toBeNull();
    // 再确认回错
    expect(await 确认交接(id)).toMatchObject({ ok: false });
  });

  it("备注日期用确认当天：发起后隔了几天才确认，写的是确认那天", async () => {
    const d = await 摆数据();
    const id = 发起了(await 交接客户(离职, d.c.id, 接手));
    await prisma.entHandover.update({ where: { id }, data: { createdAt: new Date(Date.now() - 3 * 86_400_000) } });
    当(接手);
    expect((await 确认交接(id)).ok).toBe(true);
    expect(await 备注(d.c.id)).toContain(`${beijingDay(new Date())} 离职交接：原负责人 leaver → 接手人 taker（操作人 mgr）`);
  });

  it("交一个项目：确认后换负责人、记转让痕（操作人 = 发起人）；客户备注不写", async () => {
    const d = await 摆数据();
    const id = 发起了(await 交接项目(离职, d.p单独.id, 接手));
    当(接手);
    expect(await 确认交接(id)).toEqual({ ok: true, 客户: 0, 说: "已接手 1 个项目" });
    expect(await 项目归谁(d.p单独.id)).toBe(接手);
    expect(await prisma.projectNodeLog.findFirst({ where: { projectId: d.p单独.id, kind: "transfer" } })).toMatchObject({ fromOwnerId: 离职, toOwnerId: 接手, userId: 上级 });
    expect(await 备注(d.别人客户.id)).toBe("");
    expect(await 归谁(d.c.id)).toBe(离职);
  });

  it("全部交给：确认后客户、项目、待办、线索、渠道一起走，客户备注各留一行；看板上没有他了", async () => {
    const d = await 摆数据();
    const id = 发起了(await 交接全部(离职, 接手));
    当(接手);
    const r = await 确认交接(id);
    expect(r).toMatchObject({ ok: true, 客户: 1, 说: expect.stringContaining("已接手 1 位客户、2 个项目") });
    expect(await 归谁(d.c.id)).toBe(接手);
    expect(await 项目归谁(d.p跟客户.id)).toBe(接手);
    expect(await 项目归谁(d.p单独.id)).toBe(接手);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: d.t.id } })).ownerId).toBe(接手);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: d.lead.id } })).ownerId).toBe(接手);
    expect((await prisma.channel.findUniqueOrThrow({ where: { id: d.ch.id } })).channelOwnerId).toBe(接手);
    expect(await 备注(d.c.id)).toContain("离职交接：原负责人 leaver → 接手人 taker（操作人 mgr）");
    expect(await 读离职交接({ id: 上级, role: "SALES" })).toEqual([]);
    expect(await prisma.auditLog.findFirst({ where: { action: "handover", summary: { contains: "确认接手离职成员" } } })).not.toBeNull();
  });

  it("全部交给：发起之后他名下又多了一位，确认时按那时候重新分拣，一起转", async () => {
    const d = await 摆数据();
    const id = 发起了(await 交接全部(离职, 接手));
    const 后来的 = await 建客户(离职);
    当(接手);
    expect(await 确认交接(id)).toMatchObject({ ok: true, 客户: 2 });
    expect(await 归谁(后来的.id)).toBe(接手);
    expect(await 归谁(d.c.id)).toBe(接手);
  });

  it("交接期间被放回公海、被别人领走：确认时跳过并说清，交接照样了结", async () => {
    const d = await 摆数据();
    const c2 = await 建客户(离职);
    const 一 = 发起了(await 交接客户(离职, d.c.id, 接手));
    const 二 = 发起了(await 交接客户(离职, c2.id, 接手));
    // 一：进了公海；二：被别人领走（负责人换成别的销售）
    await prisma.customerPool.create({ data: { customerId: d.c.id, reason: "手动" } });
    await prisma.customer.update({ where: { id: c2.id }, data: { salesOwnerId: 别的销售 } });
    当(接手);
    expect(await 确认交接(一)).toEqual({ ok: true, 客户: 0, 说: expect.stringContaining("没有转到你名下") });
    expect(await 确认交接(二)).toMatchObject({ ok: true, 客户: 0 });
    expect(await 归谁(d.c.id)).toBe(离职);
    expect(await 归谁(c2.id)).toBe(别的销售);
    expect(await 备注(d.c.id)).toBe("老备注");
    expect(await 状态(一)).toBe("已确认");
    await 等通知推完();
    expect((await 交接通知们(上级)).some((n) => n.title.includes("没有转到"))).toBe(true);
  });

  it("全部交给：一位被别人领走了，其余照转，提示里说跳过了几位", async () => {
    const d = await 摆数据();
    const c2 = await 建客户(离职);
    const id = 发起了(await 交接全部(离职, 接手));
    await prisma.customer.update({ where: { id: c2.id }, data: { salesOwnerId: 别的销售 } });
    当(接手);
    expect(await 确认交接(id)).toMatchObject({ ok: true, 客户: 1, 说: expect.stringContaining("另有 1 位客户在交接期间已被处理") });
    expect(await 归谁(d.c.id)).toBe(接手);
    expect(await 归谁(c2.id)).toBe(别的销售);
  });
});

describe("拒收、撤回、改接手人", () => {
  it("拒收：什么都不转，发起人收到；之后能重新交给别人", async () => {
    const d = await 摆数据();
    const id = 发起了(await 交接客户(离职, d.c.id, 接手));
    当(别的销售);
    expect(await 拒收交接(id)).toMatchObject({ ok: false, error: "只有接手人自己能拒收" });
    当(接手);
    expect(await 拒收交接(id)).toMatchObject({ ok: true });
    expect(await 状态(id)).toBe("已拒收");
    expect(await 归谁(d.c.id)).toBe(离职);
    expect(await 备注(d.c.id)).toBe("老备注");
    await 等通知推完();
    expect((await 交接通知们(上级))[0].title).toContain("拒收了你发起的离职交接（1 位客户）");
    当(上级);
    发起了(await 交接客户(离职, d.c.id, 别的销售));
  });

  it("撤回：发起人、总管理能撤，别人撤不了；撤回后原样、接手人收到不用确认了、确认回错", async () => {
    const d = await 摆数据();
    const id = 发起了(await 交接客户(离职, d.c.id, 接手));
    当(别的销售);
    expect((await 撤回交接(id)).ok).toBe(false);
    当(接手);
    expect((await 撤回交接(id)).ok).toBe(false);
    当(上级);
    expect(await 撤回交接(id)).toMatchObject({ ok: true });
    expect(await 归谁(d.c.id)).toBe(离职);
    当(接手);
    expect((await 确认交接(id)).ok).toBe(false);
    await 等通知推完();
    expect((await 交接通知们(接手)).map((n) => n.title).join("|")).toContain("撤回了交给你的交接");
    // 总管理撤上级发起的
    当(上级);
    const 二 = 发起了(await 交接客户(离职, d.c.id, 接手));
    当(系统, "ADMIN");
    expect(await 撤回交接(二)).toMatchObject({ ok: true });
  });

  it("改接手人：发起人能改；新接手人确认才转，原接手人确认不了；改成离职的人、只读的不行", async () => {
    const d = await 摆数据();
    const id = 发起了(await 交接客户(离职, d.c.id, 接手));
    当(别的销售);
    expect(await 改接手人(id, 别的销售)).toMatchObject({ ok: false, error: "只有发起人或总管理能改接手人" });
    当(上级);
    expect((await 改接手人(id, 离职)).ok).toBe(false);
    expect(await 改接手人(id, 别的销售)).toMatchObject({ ok: true });
    当(接手);
    expect((await 确认交接(id)).ok).toBe(false);
    当(别的销售);
    expect((await 确认交接(id)).ok).toBe(true);
    expect(await 归谁(d.c.id)).toBe(别的销售);
    await 等通知推完();
    expect((await 交接通知们(接手)).map((n) => n.title).join("|")).toContain("把离职交接改给了别人");
  });
});

describe("不作废、挂起天数、恢复启用、三态", () => {
  it("离职交接挂满 8 天也不作废（申请移交才作废）；看板上挂起天数照实算", async () => {
    const d = await 摆数据();
    const id = 发起了(await 交接客户(离职, d.c.id, 接手));
    await prisma.entHandover.update({ where: { id }, data: { createdAt: new Date(Date.now() - 8 * 86_400_000) } });
    expect(await 挂起移交作废(new Date())).toBe(0);
    expect(await 挂起移交作废(new Date(Date.now() + 2 * 86_400_000))).toBe(0);
    expect(await 状态(id)).toBe("待确认");
    const [p] = await 读离职交接({ id: 上级, role: "SALES" });
    expect(p.客户[0].交接中?.挂起天数).toBe(8);
  });

  it("恢复启用：他所有没确认的离职交接都撤回，名下原样", async () => {
    const d = await 摆数据();
    const 一 = 发起了(await 交接客户(离职, d.c.id, 接手));
    const 二 = 发起了(await 交接项目(离职, d.p单独.id, 接手));
    当(系统, "ADMIN");
    expect(await reactivateUser(离职)).toEqual({ ok: true });
    expect([await 状态(一), await 状态(二)]).toEqual(["已撤回", "已撤回"]);
    expect(await 归谁(d.c.id)).toBe(离职);
  });

  it("三态挂起：单条交客户只算那一位，单条交项目不算他名下的客户；全部交给算他名下的都在等", async () => {
    const d = await 摆数据();
    const c2 = await 建客户(离职);
    const 一 = 发起了(await 交接客户(离职, d.c.id, 接手));
    发起了(await 交接项目(离职, d.p单独.id, 接手));
    expect([...(await 离职交接中的(prisma, [d.c.id, c2.id]))]).toEqual([d.c.id]);
    for (const h of await prisma.entHandover.findMany({ where: { status: "待确认" } })) await 撤回交接(h.id);
    void 一;
    发起了(await 交接全部(离职, 接手));
    expect(new Set(await 离职交接中的(prisma, [d.c.id, c2.id]))).toEqual(new Set([d.c.id, c2.id]));
  });

  it("没开项目模式：交项目发起不了；交客户确认后不动项目", async () => {
    mocks.项目模式 = false;
    const d = await 摆数据();
    expect((await 交接项目(离职, d.p单独.id, 接手)).ok).toBe(false);
    const id = 发起了(await 交接客户(离职, d.c.id, 接手));
    当(接手);
    expect((await 确认交接(id)).ok).toBe(true);
    expect(await 归谁(d.c.id)).toBe(接手);
    expect(await 项目归谁(d.p跟客户.id)).toBe(离职);
  });

  it("设置里不加开关：规则表里没有交接确认的开关", async () => {
    const { readFile } = await import("node:fs/promises");
    const rules = await readFile("src/lib/enterprise/rules.ts", "utf8");
    expect(rules).not.toContain("handover_confirm");
  });
});
