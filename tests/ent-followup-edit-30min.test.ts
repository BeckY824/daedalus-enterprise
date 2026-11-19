/**
 * 企业版沟通记录本人 30 分钟内能改（客户 11-19：「沟通记录填写提交后，可在30分钟进行修改」，M-权限-09 的例外）。
 *
 * 钉的是：
 *   - 记录人本人（FollowUp.ownerId）写入 29 分钟改得了、31 分钟拒（本人改沟通过时话），原样还在；不是记录人的拒
 *   - 项目组员（客户对他连带只读）自己记的那条同样 30 分钟内能改；别人记的照旧改不了
 *   - 挂哪个客户 / 项目、哪个节点改不了；沟通不能改成待办
 *   - 留痕：一条「改了沟通」带改了哪几格；一格没变不留；改过的沟通们 认它（列表「已修改」）
 *   - 下一步跟着改：负责人最近记的那条才认，同步项目上的下一步和这条的下一步时间；别的带了下一步就拒、一格不写
 *   - 本人限时改不重跑必填齐自动推进（客户存了推项目 不调）
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
import { 记项目沟通Action, 改项目沟通 } from "@/app/(app)/projects/actions";
import { saveFollowUp } from "@/app/(app)/customers/[id]/actions";
import { 读项目详情 } from "@/app/(app)/projects/[id]/load";
import { 本人改沟通过时话, 不能改沟通话, 本人改不能变待办话, 本人限时可改of, 本人可改到, 下一步跟着改of } from "@/lib/enterprise/follow-perm";
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
    expect(下一步跟着改of({ id: "我" }, f, { ownerId: "我", 最近一条id: "f1", 能管: true }, 今)).toBe(true);
    expect(下一步跟着改of({ id: "我" }, f, { ownerId: "我", 最近一条id: "f2", 能管: true }, 今)).toBe(false);
    expect(下一步跟着改of({ id: "我" }, f, { ownerId: "负责人", 最近一条id: "f1", 能管: true }, 今)).toBe(false);
    expect(下一步跟着改of({ id: "我" }, f, { ownerId: "我", 最近一条id: "f1", 能管: false }, 今)).toBe(false);
    expect(下一步跟着改of({ id: "我" }, f, { ownerId: "我", 最近一条id: "f1", 能管: true }, new Date("2026-11-19T02:31:00.000Z"))).toBe(false);
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
  it("负责人最近记的那条：项目上的下一步、这条的下一步时间一起换，留痕；不是最近一条带下一步就拒、一格不写", async () => {
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
    // 早的那条不是最近一条：带了下一步就拒，内容也不写
    const r = await 改(早, { content: "早的想改", 下一步: "乱改" });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("下一步不能在这里改") });
    expect(await 内容(早)).toBe("早的那条");
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
