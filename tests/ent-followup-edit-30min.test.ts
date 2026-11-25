/**
 * 企业版沟通记录本人 30 分钟内能改（M-权限-09 的例外，客户 11-19 第 32 题 A 定稿，口径见 lib/enterprise/follow-perm.ts）。
 *
 * 钉的是：
 *   - 记录人本人（FollowUp.ownerId）写入 29 分钟改得了、31 分钟拒（本人改沟通过时话），原样还在；不是记录人的拒
 *   - 项目组员（客户对他连带只读）自己记的那条同样 30 分钟内能改；别人记的照旧改不了
 *   - 挂哪个客户 / 项目、哪个节点改不了；沟通不能改成待办
 *   - 留痕：一条「改了沟通」带改了哪几格；一格没变不留；改过的沟通们 认它（列表「已修改」）
 *   - 下一步跟着改：负责人最近记的那条才认，同步项目上的下一步和这条的下一步时间；别的带了下一步就拒、一格不写
 *   - 本人限时改不重跑必填齐自动推进（客户存了推项目 不调）；管理本人 30 分钟内改自己记的也不推、日志同样标，改别人记的照旧（⑤）
 *   - ③ 直接调 saveFollowUp：本人限时改改标题 / 状态 / 时长 / 提醒时间 / 联系人 / 商机 / 参与人一律拒（本人改只改内容话），原样带回不误拒
 *   - ⑤ 只能改不能删：记录人本人 30 分钟内删也拒（客户页 deleteFollowUp、项目页 删项目沟通）
 *   - 「已修改」只认新格式留痕，老格式「修改…跟进」不算；待办 / 提醒改成沟通被拒
 *   - 项目详情给界面的：本人可改到（30 分钟内、我记的）、下一步（最近一条）、已修改
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "QA", email: "qa-30", role: "SALES", title: "", avatar: null } as { id: string; name: string; email: string; role: string; title: string; avatar: null },
  推了: 0,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: (u: string) => { throw new Error(`REDIRECT:${u}`); } }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), getCurrentUser: async () => mocks.user, requireUser: async () => mocks.user }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});
vi.mock("@/lib/project/auto-advance", async (原) => {
  const m = await 原<typeof import("@/lib/project/auto-advance")>();
  return { ...m, 客户存了推项目: async (...a: Parameters<typeof m.客户存了推项目>) => { mocks.推了++; return m.客户存了推项目(...a); } };
});
vi.mock("@/app/(app)/projects/[id]/ProjectDetail", () => ({ default: () => null }));

import { prisma, defaultClient as raw, defaultClient } from "@/lib/prisma";
import { 只读客户 } from "@/lib/team-scope";
import { 规则 } from "@/lib/enterprise/rules";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { dayjs } from "@/lib/utils";
import { 记项目沟通Action, 改项目沟通, 删项目沟通 } from "@/app/(app)/projects/actions";
import { saveFollowUp, deleteFollowUp } from "@/app/(app)/customers/[id]/actions";
import { scheduleValue } from "@/lib/schedule-date";
import { 待办改沟通话 } from "@/lib/project/follow-needs-project-text";
import { 读项目详情 } from "@/app/(app)/projects/[id]/load";
import { 本人改沟通过时话, 不能改沟通话, 不能删沟通话, 本人改不能变待办话, 本人改只改内容话, 本人改公海话, 下一步没同步话, 本人限时可改of, 本人可改到, 下一步跟着改of } from "@/lib/enterprise/follow-perm";
import { 同号标题 } from "@/lib/enterprise/same-number-collab";
import { 改过的沟通们 } from "@/lib/enterprise/follow-edited";

afterAll(async () => { await prisma.$disconnect(); });

let 销售: string, 同事: string, 销管: string, 客户: string, 别的客户: string, 项目: string, 别的项目: string;
const 当 = (id: string, role = "SALES") => { mocks.user = { ...mocks.user, id, role, name: id }; };
/** 以当前这位的身份跑（企业版限定层按人滤，组员看客户是只读） */
const 以 = <T,>(fn: () => Promise<T>) => 以谁的身份(mocks.user.id, fn);
const 记一条 = async (x: Record<string, unknown> = {}, 项目id = 项目) => {
  const r = await 以(() => 记项目沟通Action(项目id, { type: "PHONE", content: "电话聊了报价", occurredAt: "2026-10-20 10:00", 阶段: "线索", 明确回复: true, 下一步: "周五前发报价单", ...x } as never));
  if (!r.ok) throw new Error(r.error);
  return r.followUpId!;
};
/** 把写入时刻挪到 n 分钟前（服务器时间；不真等） */
const 记于 = (id: string, 分钟前: number) => raw.followUp.update({ where: { id }, data: { createdAt: new Date(Date.now() - 分钟前 * 60_000) } });
const 改 = (id: string, x: Record<string, unknown> = {}, 项目id = 项目) =>
  以(() => 改项目沟通(项目id, id, { type: "WECHAT", content: "改过的内容", occurredAt: "2026-10-19 09:30", ...x } as never));
const 内容 = async (id: string) => (await raw.followUp.findUniqueOrThrow({ where: { id } })).content;
/** 打开「按组织看客户」：限定层真按人滤（组员看客户连带只读，同 ent-comm-member-scope.test.ts） */
const 开按组织看 = async () => {
  await raw.setting.upsert({ where: { key: 规则.按组织看客户.key }, update: { value: "true" }, create: { key: 规则.按组织看客户.key, value: "true" } });
  invalidateSettingsCache();
  忘掉企业版范围();
};
/** 照库里那条原样拼一份 saveFollowUp 入参（同 改项目沟通 带回别的格子的写法），测试只改要改的那格 */
const 原样 = async (id: string): Promise<Parameters<typeof saveFollowUp>[0]> => {
  const f = await raw.followUp.findUniqueOrThrow({ where: { id } });
  return {
    id, customerId: f.customerId, type: f.type, method: f.method, initiator: f.initiator, content: f.content, occurredAt: dayjs(f.occurredAt).format("YYYY-MM-DD HH:mm"),
    title: f.title, status: f.status, durationMinutes: f.duration != null ? f.duration / 60 : null,
    dueAt: scheduleValue(f.dueAt, f.dueOn), dueHasTime: f.dueHasTime ?? undefined,
    contactId: f.contactId, opportunityId: f.opportunityId, participants: f.participants, 版本: f.updatedAt.toISOString(),
  };
};
const 改沟通痕 = (id: string) => raw.auditLog.findMany({ where: { entity: "FollowUp", action: "update", entityId: id }, orderBy: { at: "asc" } });

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  mocks.推了 = 0;
  const 人 = async (email: string, bizRole: string) => {
    const id = (await prisma.user.create({ data: { email, name: email, title: "", role: "SALES", password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: id, bizRole } });
    return id;
  };
  销售 = await 人("e30-s1", "sales");
  同事 = await 人("e30-s2", "sales");
  销管 = await 人("e30-smgr", "sales_mgr");
  客户 = (await prisma.customer.create({ data: { name: "QA-30分钟客户", phone: "13800003001", salesOwnerId: 销售 } })).id;
  别的客户 = (await prisma.customer.create({ data: { name: "QA-30分钟别的客户", phone: "13800003002", salesOwnerId: 销售 } })).id;
  项目 = (await prisma.project.create({ data: { customerId: 客户, ownerId: 销售, creatorId: 销售, name: "QA-30分钟项目", phase: "线索", node: "潜客培育" } })).id;
  别的项目 = (await prisma.project.create({ data: { customerId: 客户, ownerId: 销售, creatorId: 销售, name: "QA-30分钟另一个项目", phase: "线索", node: "潜客培育" } })).id;
  忘掉企业版范围();
  当(销售);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("纯函数", () => {
  it("本人限时可改of：我记的、写入 30 分钟以内（含正好 30 分钟）；别人记的、没记录人的不行", () => {
    const 记 = new Date("2026-11-19T02:00:00.000Z");
    const f = { ownerId: "我", createdAt: 记 };
    expect(本人可改到(记).toISOString()).toBe("2026-11-19T02:30:00.000Z");
    expect(本人限时可改of({ id: "我" }, f, new Date("2026-11-19T02:29:00.000Z"))).toBe(true);
    expect(本人限时可改of({ id: "我" }, f, new Date("2026-11-19T02:30:00.000Z"))).toBe(true);
    expect(本人限时可改of({ id: "我" }, f, new Date("2026-11-19T02:31:00.000Z"))).toBe(false);
    expect(本人限时可改of({ id: "别人" }, f, new Date("2026-11-19T02:01:00.000Z"))).toBe(false);
    expect(本人限时可改of({ id: "我" }, { ownerId: null, createdAt: 记 }, 记)).toBe(false);
  });
  it("下一步跟着改of：最近一条、负责人自己记的、能管、30 分钟内才认", () => {
    const 记 = new Date("2026-11-19T02:00:00.000Z"), 今 = new Date("2026-11-19T02:10:00.000Z");
    const f = { id: "f1", ownerId: "我", createdAt: 记 };
    expect(下一步跟着改of({ id: "我" }, f, { ownerId: "我", 最近一条id: "f1", 能管: true, 写过下一步: true }, 今)).toBe(true);
    expect(下一步跟着改of({ id: "我" }, f, { ownerId: "我", 最近一条id: "f2", 能管: true, 写过下一步: true }, 今)).toBe(false);
    expect(下一步跟着改of({ id: "我" }, f, { ownerId: "负责人", 最近一条id: "f1", 能管: true, 写过下一步: true }, 今)).toBe(false);
    expect(下一步跟着改of({ id: "我" }, f, { ownerId: "我", 最近一条id: "f1", 能管: false, 写过下一步: true }, 今)).toBe(false);
    // 记的时候没写下一步（AI 卡 / 完成计划小框记的，审核中-1）
    expect(下一步跟着改of({ id: "我" }, f, { ownerId: "我", 最近一条id: "f1", 能管: true, 写过下一步: false }, 今)).toBe(false);
    expect(下一步跟着改of({ id: "我" }, f, { ownerId: "我", 最近一条id: "f1", 能管: true, 写过下一步: true }, new Date("2026-11-19T02:31:00.000Z"))).toBe(false);
  });
});

describe("服务端：谁能改、几时能改", () => {
  it("记录人本人 29 分钟改得了；31 分钟拒（提交超过 30 分钟），原样还在；挂的项目、节点不变", async () => {
    const id = await 记一条();
    const 挂前 = await raw.followUpProject.findUniqueOrThrow({ where: { followUpId: id } });
    await 记于(id, 29);
    expect(await 改(id)).toEqual({ ok: true });
    expect(await 内容(id)).toBe("改过的内容");
    expect(await raw.followUpProject.findUniqueOrThrow({ where: { followUpId: id } })).toMatchObject({ projectId: 挂前.projectId, node: 挂前.node });
    await 记于(id, 31);
    expect(await 改(id, { content: "过了时限想改" })).toEqual({ ok: false, error: 本人改沟通过时话 });
    expect(本人改沟通过时话).toBe("提交超过 30 分钟，不能再改");
    expect(await 内容(id)).toBe("改过的内容");
  });

  it("不是记录人的拒：同事、销售管理（不是负责人）都改不了", async () => {
    const id = await 记一条();
    当(同事);
    expect(await 改(id, { content: "同事想改" })).toMatchObject({ ok: false });
    当(销管);
    expect(await 改(id, { content: "销管想改" })).toMatchObject({ ok: false });
    expect(await 以(() => saveFollowUp({ id, customerId: 客户, type: "PHONE", content: "直接调", status: "已完成", occurredAt: "2026-10-19 09:30" }))).toEqual({ ok: false, error: 不能改沟通话 });
    expect(await 内容(id)).toBe("电话聊了报价");
  });

  it("项目组员：自己 30 分钟内记的能改（客户对他只读）；负责人记的改不了", async () => {
    await 开按组织看();
    await raw.projectMember.create({ data: { projectId: 项目, userId: 同事, inviteStatus: "JOINED" } });
    忘掉企业版范围();
    const 负责人记的 = await 记一条();
    当(同事);
    // 前提：组员看这位客户是连带只读（不放行的话改自己记的也会被说只读）
    const c = await raw.customer.findUniqueOrThrow({ where: { id: 客户 }, select: { id: true, salesOwnerId: true, channelOwnerId: true, pool: { select: { customerId: true } } } });
    expect(await 以(() => 只读客户(defaultClient, c))).toBe("全");
    const 组员记的 = await 记一条({ 下一步: null });
    expect(await 改(组员记的, { content: "组员改自己的" })).toEqual({ ok: true });
    expect(await 内容(组员记的)).toBe("组员改自己的");
    expect(await 改(负责人记的, { content: "组员改负责人的" })).toMatchObject({ ok: false });
    expect(await 内容(负责人记的)).toBe("电话聊了报价");
    // 出了项目组：不能再往这个项目记沟通，也就不能再改
    await raw.projectMember.deleteMany({ where: { projectId: 项目, userId: 同事 } });
    忘掉企业版范围();
    expect(await 改(组员记的, { content: "出组后想改" })).toMatchObject({ ok: false });
    expect(await 内容(组员记的)).toBe("组员改自己的");
  });

  it("改不了挂哪个客户 / 项目；沟通不能改成待办", async () => {
    const id = await 记一条();
    expect(await 以(() => saveFollowUp({ id, customerId: 别的客户, type: "PHONE", content: "挪到别的客户", status: "已完成", occurredAt: "2026-10-19 09:30" }))).toMatchObject({ ok: false });
    expect(await 改(id, { content: "挪到别的项目" }, 别的项目)).toMatchObject({ ok: false, error: expect.stringContaining("不在这个项目上") });
    expect(await 以(() => saveFollowUp({ id, customerId: 客户, type: "TASK", title: "", content: "改成待办", status: "待处理", occurredAt: "2026-10-19 09:30" }))).toEqual({ ok: false, error: 本人改不能变待办话 });
    const 后 = await raw.followUp.findUniqueOrThrow({ where: { id } });
    expect(后).toMatchObject({ customerId: 客户, type: "PHONE", content: "电话聊了报价" });
    expect((await raw.followUpProject.findUniqueOrThrow({ where: { followUpId: id } })).projectId).toBe(项目);
  });

  it("留痕：「改了沟通」带改了哪几格；一格没变不留痕；改过的沟通们 认它", async () => {
    const id = await 记一条();
    const 原 = await raw.followUp.findUniqueOrThrow({ where: { id } });
    // 原样交回去：不留痕、不算改过
    expect(await 改(id, { type: 原.type, method: 原.method, initiator: 原.initiator, content: 原.content, occurredAt: dayjs(原.occurredAt).format("YYYY-MM-DD HH:mm") })).toEqual({ ok: true });
    expect(await 改沟通痕(id)).toEqual([]);
    expect((await 改过的沟通们([id])).has(id)).toBe(false);
    expect(await 改(id, { type: 原.type, method: 原.method, initiator: 原.initiator, content: "只改内容", occurredAt: dayjs(原.occurredAt).format("YYYY-MM-DD HH:mm") })).toEqual({ ok: true });
    const 痕 = await 改沟通痕(id);
    expect(痕).toHaveLength(1);
    expect(痕[0].summary).toMatch(/^改了沟通：.*改了沟通内容（记录人本人提交后 30 分钟内修改）$/);
    expect(JSON.parse(痕[0].detail!)).toMatchObject({ 改了: ["沟通内容"], 本人限时改: true });
    expect((await 改过的沟通们([id])).has(id)).toBe(true);
  });

  it("本人限时改不重跑必填齐自动推进", async () => {
    const id = await 记一条();
    mocks.推了 = 0;
    expect(await 改(id)).toEqual({ ok: true });
    expect(mocks.推了).toBe(0);
  });
});

describe("下一步跟着改", () => {
  const 后天 = () => dayjs().add(2, "day").format("YYYY-MM-DD");
  it("负责人最近记的那条：项目上的下一步、这条的下一步时间一起换，留痕；不是最近一条带下一步只丢下一步、内容照存", async () => {
    const 早 = await 记一条({ content: "早的那条" });
    await 记于(早, 5);
    const 晚 = await 记一条({ content: "晚的那条", 下一步: "周五前发报价单" });
    expect(await 改(晚, { content: "晚的那条改过", 下一步: "改成周四打电话", 下一步时间: 后天() })).toEqual({ ok: true });
    const p = await raw.project.findUniqueOrThrow({ where: { id: 项目 } });
    expect(p.nextStepText).toBe("改成周四打电话");
    expect(dayjs(p.nextStepAt).format("YYYY-MM-DD")).toBe(后天());
    expect(dayjs((await raw.entFollowUpMeta.findUniqueOrThrow({ where: { followUpId: 晚 } })).nextAt).format("YYYY-MM-DD")).toBe(后天());
    const 痕们 = (await 改沟通痕(晚)).map((x) => JSON.parse(x.detail!).改了 as string[]);
    expect(痕们).toHaveLength(2);
    expect(痕们[0]).toContain("沟通内容");
    expect(痕们[1]).toEqual(["下一步", "下一步时间"]);
    // 早的那条不是最近一条：带了下一步只丢掉下一步、内容照存，回一句提示（低-6）
    expect(await 改(早, { content: "早的想改", 下一步: "乱改" })).toEqual({ ok: true, 提示: 下一步没同步话 });
    expect(await 内容(早)).toBe("早的想改");
    expect((await raw.project.findUniqueOrThrow({ where: { id: 项目 } })).nextStepText).toBe("改成周四打电话");
    // 不带下一步照样能改内容
    expect(await 改(早, { content: "早的改内容" })).toEqual({ ok: true });
    expect((await raw.project.findUniqueOrThrow({ where: { id: 项目 } })).nextStepText).toBe("改成周四打电话");
  });
  it("下一步计划必填（同记的时候）", async () => {
    const id = await 记一条();
    expect(await 改(id, { 下一步: "  " })).toMatchObject({ ok: false });
    expect(await 内容(id)).toBe("电话聊了报价");
  });
});

describe("项目详情交给界面的", () => {
  const 行 = async (id: string) => {
    const 载 = await 以(() => 读项目详情(mocks.user as never, 项目));
    if (载.种 !== "有") throw new Error("没给详情");
    return 载.props.p.followUps.find((f) => f.id === id);
  };
  it("我记的 30 分钟内给 本人可改到 和（最近一条）下一步；过了不给；别人看不给；改过标已修改", async () => {
    const id = await 记一条({ 下一步时间: dayjs().add(3, "day").format("YYYY-MM-DD") });
    await 记于(id, 10);
    const 记时 = (await raw.followUp.findUniqueOrThrow({ where: { id } })).createdAt;
    const r = await 行(id);
    expect(r?.本人可改到).toBe(本人可改到(记时).toISOString());
    expect(r?.下一步).toEqual({ 文字: "周五前发报价单", 时间: dayjs().add(3, "day").format("YYYY-MM-DD") });
    expect(r?.已修改).toBeUndefined();
    expect(await 改(id)).toEqual({ ok: true });
    expect((await 行(id))?.已修改).toBe(true);
    await 记于(id, 31);
    const 过 = await 行(id);
    expect(过?.本人可改到).toBeUndefined();
    expect(过?.下一步).toBeUndefined();
    await 记于(id, 1);
    await raw.projectMember.create({ data: { projectId: 项目, userId: 同事, inviteStatus: "JOINED" } });
    忘掉企业版范围();
    当(同事);
    expect((await 行(id))?.本人可改到).toBeUndefined();
  });
});

describe("③ 本人限时改只改沟通内容、方式、时间（直接调 saveFollowUp）", () => {
  it("改标题 / 状态 / 时长 / 提醒时间 / 联系人 / 商机 / 参与人一律拒，一格不写；只改内容、方式、发起主体、时间放行", async () => {
    const id = await 记一条();
    const 联系人 = (await raw.contact.create({ data: { name: "QA-30分钟联系人", customerId: 客户 } })).id;
    const 商机 = (await raw.opportunity.create({ data: { name: "QA-30分钟商机", customerId: 客户, ownerId: 销售 } })).id;
    const 前 = await raw.followUp.findUniqueOrThrow({ where: { id } });
    const 别的状态 = 前.status === "待处理" ? "已完成" : "待处理";
    const 越界们: Record<string, Partial<Parameters<typeof saveFollowUp>[0]>> = {
      标题: { title: "改个标题" }, 状态: { status: 别的状态 }, 时长: { durationMinutes: 5 },
      提醒时间: { dueAt: dayjs().add(2, "day").format("YYYY-MM-DD"), dueHasTime: false }, 联系人: { contactId: 联系人 }, 商机: { opportunityId: 商机 }, 参与人: { participants: "张三,李四" },
    };
    for (const [格, 改法] of Object.entries(越界们)) {
      expect(await 以(async () => saveFollowUp({ ...(await 原样(id)), content: `顺手改${格}`, ...改法 })), 格).toEqual({ ok: false, error: 本人改只改内容话 });
    }
    expect(本人改只改内容话).toBe("30 分钟内只能改沟通内容、方式和时间");
    expect(await raw.followUp.findUniqueOrThrow({ where: { id } })).toMatchObject({ content: 前.content, title: 前.title, status: 前.status, duration: 前.duration, dueAt: 前.dueAt, contactId: 前.contactId, opportunityId: 前.opportunityId, participants: 前.participants });
    expect(await 改沟通痕(id)).toEqual([]);
    // 原样带回别的格子、只改内容 / 方式 / 时间：放行
    expect(await 以(async () => saveFollowUp({ ...(await 原样(id)), type: "WECHAT", method: undefined, content: "只改内容方式时间", occurredAt: "2026-10-19 09:30" }))).toMatchObject({ ok: true });
    expect(await raw.followUp.findUniqueOrThrow({ where: { id } })).toMatchObject({ type: "WECHAT", content: "只改内容方式时间", title: 前.title, status: 前.status });
  });

  it("待办 / 提醒不走本人限时改（低-4）：记录人本人 30 分钟内改内容、改成沟通都拒；管理改成沟通照旧拒（待办改沟通话）", async () => {
    for (const type of ["TASK", "REMIND"]) {
      const t = (await raw.followUp.create({ data: { customerId: 客户, ownerId: 销售, type, title: "回电", content: "记得回电", status: "待处理", occurredAt: new Date(Date.now() - 3_600_000) } })).id;
      expect(await 以(async () => saveFollowUp({ ...(await 原样(t)), content: "本人改待办内容" })), type).toEqual({ ok: false, error: 不能改沟通话 });
      expect(await 以(async () => saveFollowUp({ ...(await 原样(t)), type: "PHONE" })), type).toEqual({ ok: false, error: 不能改沟通话 });
      expect(await raw.followUp.findUniqueOrThrow({ where: { id: t } })).toMatchObject({ type, content: "记得回电" });
    }
    // 管理（客户负责人）改同一位客户名下的待办成沟通：照旧 待办改沟通话
    const 管客户 = (await prisma.customer.create({ data: { name: "QA-30分钟待办客户", phone: "13800003004", salesOwnerId: 销管 } })).id;
    const t = (await raw.followUp.create({ data: { customerId: 管客户, ownerId: 销管, type: "TASK", title: "回电", content: "记得回电", status: "待处理", occurredAt: new Date(Date.now() - 3_600_000) } })).id;
    当(销管);
    expect(await 以(async () => saveFollowUp({ ...(await 原样(t)), type: "PHONE" }))).toEqual({ ok: false, error: 待办改沟通话 });
  });
});

describe("⑤ 只能改不能删、改完不自动推进", () => {
  it("记录人本人 30 分钟内删也拒：客户页 deleteFollowUp、项目页 删项目沟通 两个入口", async () => {
    const id = await 记一条();
    await 记于(id, 1);
    expect(await 以(() => deleteFollowUp(id, 客户))).toEqual({ ok: false, error: 不能删沟通话 });
    expect(await 以(() => 删项目沟通(项目, id))).toEqual({ ok: false, error: 不能删沟通话 });
    expect((await raw.followUp.findUniqueOrThrow({ where: { id } })).deletedAt).toBeNull();
  });

  it("管理本人 30 分钟内改自己记的：不自动推进、日志标本人限时改；改别人记的、自己记的过了 30 分钟照旧推进、不标", async () => {
    const 管客户 = (await prisma.customer.create({ data: { name: "QA-30分钟管理的客户", phone: "13800003003", salesOwnerId: 销管 } })).id;
    const 管项目 = (await prisma.project.create({ data: { customerId: 管客户, ownerId: 销管, creatorId: 销管, name: "QA-30分钟管理的项目", phase: "线索", node: "潜客培育" } })).id;
    await raw.projectMember.create({ data: { projectId: 管项目, userId: 同事, inviteStatus: "JOINED" } });
    忘掉企业版范围();
    当(同事);
    const 别人记的 = await 记一条({ 下一步: null }, 管项目);
    当(销管);
    const 自己记的 = await 记一条({}, 管项目);
    const 最后一条痕 = async (id: string) => JSON.parse((await 改沟通痕(id)).at(-1)!.detail!) as { 改了: string[]; 本人限时改?: boolean };

    mocks.推了 = 0;
    expect(await 改(自己记的, { content: "管理改自己的" }, 管项目)).toEqual({ ok: true });
    expect(mocks.推了).toBe(0);
    expect(await 最后一条痕(自己记的)).toMatchObject({ 本人限时改: true });
    // 管理原本就能改：不收窄格子（照原权限）
    expect(await 以(async () => saveFollowUp({ ...(await 原样(自己记的)), participants: "张三" }))).toMatchObject({ ok: true });

    mocks.推了 = 0;
    expect(await 改(别人记的, { content: "管理改组员的" }, 管项目)).toEqual({ ok: true });
    expect(mocks.推了).toBe(1);
    expect((await 最后一条痕(别人记的)).本人限时改).toBeUndefined();

    await 记于(自己记的, 31);
    mocks.推了 = 0;
    expect(await 改(自己记的, { content: "过了 30 分钟管理照原权限改" }, 管项目)).toEqual({ ok: true });
    expect(mocks.推了).toBe(1);
    expect((await 最后一条痕(自己记的)).本人限时改).toBeUndefined();
  });
});

describe("「已修改」只认新格式留痕", () => {
  it("老格式「修改…跟进」的修改日志不算；summary「改了沟通」开头或 detail 带改了才算", async () => {
    const id = await 记一条();
    const 痕 = (summary: string, detail: unknown) => raw.auditLog.create({ data: { userId: 销售, userName: "QA", action: "update", entity: "FollowUp", entityId: id, summary, detail: JSON.stringify(detail) } });
    await 痕("修改QA-30分钟客户的一条电话跟进（2026-10-20）", { 客户: "QA-30分钟客户", 类型: "电话", 状态: "已完成", 内容: "电话聊了报价" });
    expect((await 改过的沟通们([id])).has(id)).toBe(false);
    await 痕("别的说法", { 改了: ["沟通内容"] });
    expect((await 改过的沟通们([id])).has(id)).toBe(true);
    const id2 = await 记一条({ content: "第二条沟通" });
    await raw.auditLog.create({ data: { userId: 销售, userName: "QA", action: "update", entity: "FollowUp", entityId: id2, summary: "改了沟通：QA 的一条电话，改了沟通内容" } });
    expect((await 改过的沟通们([id2])).has(id2)).toBe(true);
  });
});

describe("审核第二轮", () => {
  it("中-1：负责人从客户页 / AI 卡记的（挂上项目、成了最近一条、没写下一步）——界面不给下一步两格；带了下一步只丢下一步，不覆盖项目下一步", async () => {
    const 先 = await 记一条({ 下一步: "周五前发报价单", 下一步时间: dayjs().add(3, "day").format("YYYY-MM-DD") });
    await 记于(先, 5);
    const 项目前 = await raw.project.findUniqueOrThrow({ where: { id: 项目 } });
    const r = await 以(() => saveFollowUp({ customerId: 客户, type: "PHONE", content: "AI 卡上记的", status: "已完成", occurredAt: dayjs().format("YYYY-MM-DD HH:mm"), projectId: 项目 }));
    if (!r.ok) throw new Error(r.error);
    const 后 = r.id;
    expect((await raw.entFollowUpMeta.findUniqueOrThrow({ where: { followUpId: 后 } })).nextAt).toBeNull();
    const 载 = await 以(() => 读项目详情(mocks.user as never, 项目));
    if (载.种 !== "有") throw new Error("没给详情");
    const 行 = 载.props.p.followUps.find((f) => f.id === 后)!;
    expect(行.本人可改到).toBeDefined();
    expect(行.下一步).toBeUndefined();
    // 记项目沟通 写了下一步的那条才有（它已不是最近一条，也不给）
    expect(载.props.p.followUps.find((f) => f.id === 先)!.下一步).toBeUndefined();
    // 人没动下一步：不带就不校验、不覆盖
    expect(await 改(后, { content: "AI 卡记的改一下" })).toEqual({ ok: true });
    // 硬带下一步（老页面 / 伪造）：内容照存，下一步丢掉
    expect(await 改(后, { content: "再改一次内容", 下一步: "乱写", 下一步时间: dayjs().add(9, "day").format("YYYY-MM-DD") })).toEqual({ ok: true, 提示: 下一步没同步话 });
    const 项目后 = await raw.project.findUniqueOrThrow({ where: { id: 项目 } });
    expect({ 文字: 项目后.nextStepText, 时间: 项目后.nextStepAt?.getTime() }).toEqual({ 文字: 项目前.nextStepText, 时间: 项目前.nextStepAt?.getTime() });
    expect(await 内容(后)).toBe("再改一次内容");
  });

  it("低-3：导入建的（EntImportRow）、同号协作的系统留痕不走本人限时改，界面也不给「修改」", async () => {
    const 导入的 = await 记一条({ content: "像导入的" });
    const 批 = await raw.entImportBatch.create({ data: { source: "QA" } });
    await raw.entImportRow.create({ data: { batchId: 批.id, entity: "followup", externalId: "x1", targetId: 导入的, kind: "create", written: "{}" } });
    const 留痕 = (await raw.followUp.create({ data: { customerId: 客户, ownerId: 销售, type: "OTHER", title: 同号标题, content: "同号再次录入：13800003001", status: "已完成", occurredAt: new Date() } })).id;
    await raw.followUpProject.create({ data: { followUpId: 留痕, projectId: 项目, node: "同号再次录入" } });
    expect(await 改(导入的, { content: "想改导入的" })).toEqual({ ok: false, error: 不能改沟通话 });
    expect(await 改(留痕, { content: "想改留痕" })).toEqual({ ok: false, error: 不能改沟通话 });
    expect(await 内容(导入的)).toBe("像导入的");
    const 载 = await 以(() => 读项目详情(mocks.user as never, 项目));
    if (载.种 !== "有") throw new Error("没给详情");
    expect(载.props.p.followUps.find((f) => f.id === 导入的)?.本人可改到).toBeUndefined();
    expect(载.props.p.followUps.find((f) => f.id === 留痕)?.本人可改到).toBeUndefined();
    // 管理本人：导入建的挂在他名下，30 分钟内改也不算「本人限时改」，照旧推进、不标
    const 管客户 = (await prisma.customer.create({ data: { name: "QA-30分钟导入客户", phone: "13800003005", salesOwnerId: 销管 } })).id;
    const 管项目 = (await prisma.project.create({ data: { customerId: 管客户, ownerId: 销管, creatorId: 销管, name: "QA-30分钟导入项目", phase: "线索", node: "潜客培育" } })).id;
    当(销管);
    const 管导入 = await 记一条({}, 管项目);
    await raw.entImportRow.create({ data: { batchId: 批.id, entity: "followup", externalId: "x2", targetId: 管导入, kind: "create", written: "{}" } });
    mocks.推了 = 0;
    expect(await 改(管导入, { content: "管理改导入的" }, 管项目)).toEqual({ ok: true });
    expect(mocks.推了).toBe(1);
    expect(JSON.parse((await 改沟通痕(管导入)).at(-1)!.detail!).本人限时改).toBeUndefined();
  });

  it("低-2：沟通时间按分钟比——带秒的记录原样（到分钟）交回不算改、秒不被截", async () => {
    const id = await 记一条();
    const 带秒 = new Date("2026-10-20T02:00:42.000Z");
    await raw.followUp.update({ where: { id }, data: { occurredAt: 带秒 } });
    expect(await 以(async () => saveFollowUp({ ...(await 原样(id)), content: "只改内容" }))).toMatchObject({ ok: true });
    expect((await raw.followUp.findUniqueOrThrow({ where: { id } })).occurredAt.getTime()).toBe(带秒.getTime());
    expect(JSON.parse((await 改沟通痕(id)).at(-1)!.detail!).改了).toEqual(["沟通内容"]);
    // 真改了分钟照改
    expect(await 以(async () => saveFollowUp({ ...(await 原样(id)), occurredAt: "2026-10-19 09:30" }))).toMatchObject({ ok: true });
    expect(dayjs((await raw.followUp.findUniqueOrThrow({ where: { id } })).occurredAt).format("YYYY-MM-DD HH:mm")).toBe("2026-10-19 09:30");
  });

  it("低-5：没挂项目的沟通，客户进了公海也不能改", async () => {
    const id = (await raw.followUp.create({ data: { customerId: 客户, ownerId: 销售, type: "PHONE", title: "", content: "老的客户沟通", status: "已完成", occurredAt: new Date(Date.now() - 3_600_000) } })).id;
    expect(await 以(async () => saveFollowUp({ ...(await 原样(id)), content: "没进公海时改" }))).toMatchObject({ ok: true });
    await raw.customerPool.create({ data: { customerId: 客户 } });
    忘掉企业版范围();
    expect(await 以(async () => saveFollowUp({ ...(await 原样(id)), content: "进了公海想改" }))).toEqual({ ok: false, error: 本人改公海话 });
    expect(await 内容(id)).toBe("没进公海时改");
  });

  it("低-6：页面开着时组员新记了一条，负责人那条失去下一步资格——只丢下一步、内容照存给提示；沟通没存上下一步也不写", async () => {
    await raw.projectMember.create({ data: { projectId: 项目, userId: 同事, inviteStatus: "JOINED" } });
    忘掉企业版范围();
    const 我的 = await 记一条({ content: "负责人的", 下一步: "周五前发报价单" });
    await 记于(我的, 2);
    // 版本对不上（沟通没存上）：下一步也不写（同一个事务）
    expect(await 改(我的, { content: "旧版本", 下一步: "不该写进去", 版本: "2000-01-01T00:00:00.000Z" })).toMatchObject({ ok: false });
    expect((await raw.project.findUniqueOrThrow({ where: { id: 项目 } })).nextStepText).toBe("周五前发报价单");
    当(同事);
    await 记一条({ content: "组员新记的", 下一步: null });
    当(销售);
    expect(await 改(我的, { content: "负责人改内容", 下一步: "改成周四打电话" })).toEqual({ ok: true, 提示: 下一步没同步话 });
    expect(await 内容(我的)).toBe("负责人改内容");
    expect((await raw.project.findUniqueOrThrow({ where: { id: 项目 } })).nextStepText).toBe("周五前发报价单");
  });

  it("低-1：项目详情下发服务器当前时刻（有本人可改的才给）", async () => {
    await 记一条();
    const 载 = await 以(() => 读项目详情(mocks.user as never, 项目));
    if (载.种 !== "有") throw new Error("没给详情");
    expect(Math.abs(Date.parse(载.props.p.服务器现在!) - Date.now())).toBeLessThan(60_000);
  });
});
