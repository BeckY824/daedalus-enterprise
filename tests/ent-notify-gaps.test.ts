/**
 * 企业版通知断点（2026-11-02）：卡点发布、公海分配、回收 / 将回收发上级、待分配文案。
 * 钉的是：收件人对、自己不发给自己、防重、没上级不报错、通知出错不连累业务动作。
 * 今天到期 / 昨天逾期在 ent-due-notify.test.ts，只读账号标已读在 ent-notice-readonly.test.ts。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "a@x", role: "SALES", title: "", avatar: null },
  读组织出错: false,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

vi.mock("@/lib/enterprise/org", async (原) => {
  const m = await 原<typeof import("@/lib/enterprise/org")>();
  return { ...m, 读组织: () => (mocks.读组织出错 ? Promise.reject(new Error("库忙")) : m.读组织()) };
});

import dayjs from "dayjs";
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 等通知推完 } from "@/lib/enterprise/notify";
import { 读组织, 负责人和上级 } from "@/lib/enterprise/org";
import { 卡点发布通知, 公海分配通知 } from "@/lib/enterprise/notice-sources";
import { 发满额提醒, 发待分配提醒 } from "@/lib/enterprise/lead-full-notice";
import { 记项目沟通, 公海超时收回 } from "@/lib/project/db";
import { 默认组织规则 } from "@/lib/project/org-rules";
import { 系统 } from "@/lib/project/timeout";
import { 发布卡点Action } from "@/app/(app)/projects/blocker-actions";
import { 记项目沟通Action } from "@/app/(app)/projects/actions";
import { 分配公海 } from "@/app/(app)/customers/pool-actions";
import { 分配公海项目 } from "@/app/(app)/pool/actions";
import { 北京日期 } from "./helpers/beijing-date";

const 名字 = new Map<string, string>();
let 总管: string, 组长: string, 甲: string, 乙: string, 独行: string, 客户: string, 项目: string;
const 当 = (id: string) => { mocks.user = { ...mocks.user, id, name: 名字.get(id) ?? "" }; };
const 人 = (id: string) => ({ id, name: 名字.get(id) ?? "" });
const 通知们 = (where: { kind?: string } = {}) => prisma.entNotice.findMany({ where, orderBy: [{ userId: "asc" }, { dedupeKey: "asc" }] });
const 收件人 = async (kind: string) => (await 通知们({ kind })).map((n) => n.userId).sort();
const 排 = (...ids: string[]) => [...ids].sort();

async function 建人(email: string, name: string) {
  const id = (await prisma.user.create({ data: { email, name, title: "", role: "SALES", password: "x" } })).id;
  名字.set(id, name);
  return id;
}

beforeEach(async () => {
  mocks.读组织出错 = false;
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  总管 = await 建人("dir", "总管");
  组长 = await 建人("mgr", "组长");
  甲 = await 建人("jia", "销售甲");
  乙 = await 建人("yi", "销售乙");
  独行 = await 建人("solo", "没上级");
  await prisma.entMember.createMany({
    data: [
      { userId: 总管, bizRole: "director" },
      { userId: 组长, bizRole: "sales_mgr", managerId: 总管 },
      { userId: 甲, bizRole: "sales", managerId: 组长 },
      { userId: 乙, bizRole: "sales", managerId: 组长 },
      { userId: 独行, bizRole: "sales" },
    ],
  });
  客户 = (await prisma.customer.create({ data: { name: "客户一", phone: "13800000001", salesOwnerId: 甲 } })).id;
  项目 = (await prisma.project.create({ data: { name: "一期", customerId: 客户, ownerId: 甲, creatorId: 甲 } })).id;
});
afterEach(async () => {
  await 等通知推完();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("负责人和上级", () => {
  it("负责人 + 直属上级；去掉操作者；停用的、不在组织的不算；上级就是自己不重复", async () => {
    const org = await 读组织();
    expect(负责人和上级(org, 甲)).toEqual([甲, 组长]);
    expect(负责人和上级(org, 甲, 甲)).toEqual([组长]);
    expect(负责人和上级(org, 甲, 组长)).toEqual([甲]);
    expect(负责人和上级(org, 独行)).toEqual([独行]);
    expect(负责人和上级(org, "不存在的人")).toEqual([]);

    await prisma.entMember.update({ where: { userId: 独行 }, data: { managerId: 独行 } });
    expect(负责人和上级(await 读组织(), 独行)).toEqual([独行]);
    await prisma.user.update({ where: { id: 组长 }, data: { active: false } });
    expect(负责人和上级(await 读组织(), 甲)).toEqual([甲]);
    await prisma.user.update({ where: { id: 甲 }, data: { active: false } });
    expect(负责人和上级(await 读组织(), 甲)).toEqual([]);
  });
});

describe("发布卡点", () => {
  const 卡 = { title: "预算没批", reasons: ["价格预算分歧"], description: "报价比别家高一成" };
  const 记一条 = async (owner = 甲, pid = 项目) => {
    const r = await 记项目沟通({ id: owner, role: "SALES" }, pid, { type: "PHONE", content: "聊了", occurredAt: 北京日期(), 阶段: "线索", 明确回复: true });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    return r.followUpId!;
  };

  it("负责人自己发：只有直属上级收（发布者不发给自己），文案和链接对", async () => {
    当(甲);
    const r = await 发布卡点Action(await 记一条(), 卡);
    expect(r).toMatchObject({ ok: true, code: expect.any(String) });
    const 们 = await 通知们({ kind: "卡点" });
    expect(们.map((n) => n.userId)).toEqual([组长]);
    expect(们[0]).toMatchObject({ link: `/projects/${项目}`, dedupeKey: `blocker-new:${(r as { code: string }).code}` });
    expect(们[0].title).toContain("销售甲 发布了卡点");
    expect(们[0].body).toContain("一期");
    expect(们[0].body).toContain("预算没批");
  });

  it("记沟通时顺带发卡点：同样通知上级", async () => {
    当(甲);
    const r = await 记项目沟通Action(项目, { type: "PHONE", content: "聊了", occurredAt: 北京日期(), 阶段: "线索", 明确回复: true, 下一步: "再聊", 下一步时间: dayjs().format("YYYY-MM-DD") }, { type: "中度卡点", description: "报价比别家高一成" });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, 卡点: expect.any(String) });
    expect(await 收件人("卡点")).toEqual([组长]);
  });

  it("「暂无卡点」不生成，也不通知", async () => {
    当(甲);
    expect(await 发布卡点Action(await 记一条(), { ...卡, type: "暂无卡点" })).toMatchObject({ ok: true });
    expect(await 通知们({ kind: "卡点" })).toEqual([]);
  });

  it("负责人没有上级：不报错，也没人收", async () => {
    const c = (await prisma.customer.create({ data: { name: "客户二", phone: "13800000002", salesOwnerId: 独行 } })).id;
    const p = (await prisma.project.create({ data: { name: "二期", customerId: c, ownerId: 独行, creatorId: 独行 } })).id;
    当(独行);
    expect(await 发布卡点Action(await 记一条(独行, p), 卡)).toMatchObject({ ok: true, code: expect.any(String) });
    expect(await 通知们({ kind: "卡点" })).toEqual([]);
  });

  it("上级停用不发", async () => {
    await prisma.user.update({ where: { id: 组长 }, data: { active: false } });
    当(甲);
    expect(await 发布卡点Action(await 记一条(), 卡)).toMatchObject({ ok: true });
    expect(await 通知们({ kind: "卡点" })).toEqual([]);
  });

  it("发布者不是负责人（来源函数口径）：负责人和上级都收；上级自己发的只有负责人收；同一个卡点只发一次", async () => {
    当(甲);
    const r = (await 发布卡点Action(await 记一条(), 卡)) as { code: string };
    await prisma.entNotice.deleteMany();
    await 卡点发布通知(人(总管), r.code);
    expect(await 收件人("卡点")).toEqual(排(甲, 组长));
    await 卡点发布通知(人(总管), r.code);
    expect(await prisma.entNotice.count()).toBe(2);
    await prisma.entNotice.deleteMany();
    await 卡点发布通知(人(组长), r.code);
    expect(await 收件人("卡点")).toEqual([甲]);
  });

  it("通知出错不连累发布：记通知、读组织出错都照样发成", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    当(甲);
    const 写 = vi.spyOn(prisma.entNotice, "create").mockRejectedValue(new Error("库忙"));
    const r = await 发布卡点Action(await 记一条(), 卡);
    写.mockRestore();
    expect(r).toMatchObject({ ok: true, code: expect.any(String) });
    expect(await prisma.entBlocker.count()).toBe(1);
    expect(await prisma.entNotice.count()).toBe(0);

    mocks.读组织出错 = true;
    await expect(卡点发布通知(人(甲), (r as { code: string }).code)).resolves.toBeUndefined();
    mocks.读组织出错 = false;
    await expect(卡点发布通知(人(甲), "没有这个编号")).resolves.toBeUndefined();
    await expect(卡点发布通知(人(甲), undefined)).resolves.toBeUndefined();
    expect(await prisma.entNotice.count()).toBe(0);
  });
});

describe("公海分配", () => {
  const 进公海客户 = async (name: string) => {
    const id = (await prisma.customer.create({ data: { name, phone: "", salesOwnerId: 组长 } })).id;
    await prisma.customerPool.create({ data: { customerId: id, reason: "测试" } });
    return id;
  };
  const 公海项目 = async (name: string, customerId = 客户) =>
    (await prisma.project.create({ data: { name, customerId, ownerId: "", creatorId: 总管, pooledAt: new Date() } })).id;

  it("客户：一条分给接手人，title、link 对；操作人不收", async () => {
    const c = await 进公海客户("公海甲");
    当(组长);
    expect(await 分配公海([c], 乙)).toMatchObject({ ok: true, updated: 1 });
    const 们 = await 通知们({ kind: "分配" });
    expect(们.map((n) => n.userId)).toEqual([乙]);
    expect(们[0]).toMatchObject({ title: "组长 把公海里的客户分给你：公海甲", link: `/customers/${c}` });
  });

  it("客户：批量合并成一条，点去列表，名单在正文", async () => {
    const a = await 进公海客户("公海甲");
    const b = await 进公海客户("公海乙");
    当(组长);
    expect(await 分配公海([a, b], 乙)).toMatchObject({ ok: true, updated: 2 });
    const 们 = await 通知们({ kind: "分配" });
    expect(们).toHaveLength(1);
    expect(们[0]).toMatchObject({ userId: 乙, title: "组长 把公海里 2 个客户分给你", link: "/customers" });
    expect(们[0].body).toContain("公海甲");
    expect(们[0].body).toContain("公海乙");
  });

  it("客户：自己分给自己不发", async () => {
    const c = await 进公海客户("公海甲");
    当(组长);
    expect(await 分配公海([c], 组长)).toMatchObject({ ok: true, updated: 1 });
    expect(await 通知们({ kind: "分配" })).toEqual([]);
  });

  it("客户：一个都没分到不发", async () => {
    当(组长);
    expect(await 分配公海([客户], 乙)).toMatchObject({ ok: true, updated: 0 });
    expect(await 通知们({ kind: "分配" })).toEqual([]);
  });

  it("客户名下的公海项目跟来：正文说一句", async () => {
    await 公海分配通知(人(组长), 乙, "客户", [客户], 2);
    const [n] = await 通知们({ kind: "分配" });
    expect(n.body).toContain("2 个公海里的项目");
  });

  it("项目：一条分给接手人，指向项目；批量合并；自己给自己不发", async () => {
    const a = await 公海项目("公海一期");
    const b = await 公海项目("公海二期");
    const c = await 公海项目("公海三期");
    当(组长);
    expect(await 分配公海项目([a], 乙)).toMatchObject({ ok: true, 分到: [a] });
    const [单] = await 通知们({ kind: "分配" });
    expect(单).toMatchObject({ userId: 乙, title: "组长 把公海里的项目分给你：公海一期", link: `/projects/${a}` });
    await prisma.entNotice.deleteMany();

    expect(await 分配公海项目([b, c], 乙)).toMatchObject({ ok: true });
    const 们 = await 通知们({ kind: "分配" });
    expect(们).toHaveLength(1);
    expect(们[0]).toMatchObject({ userId: 乙, title: "组长 把公海里 2 个项目分给你", link: "/projects" });
    await prisma.entNotice.deleteMany();

    const d = await 公海项目("公海四期");
    expect(await 分配公海项目([d], 组长)).toMatchObject({ ok: true, 分到: [d] });
    expect(await 通知们({ kind: "分配" })).toEqual([]);
  });

  it("防重：同一分钟同一批重复调用只一条", async () => {
    const a = await 公海项目("公海一期");
    await 公海分配通知(人(组长), 乙, "项目", [a]);
    await 公海分配通知(人(组长), 乙, "项目", [a]);
    expect(await prisma.entNotice.count()).toBe(1);
  });

  it("通知出错不连累分配", async () => {
    const a = await 公海项目("公海一期");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(prisma.entNotice, "create").mockRejectedValue(new Error("库忙"));
    当(组长);
    expect(await 分配公海项目([a], 乙)).toMatchObject({ ok: true, 分到: [a] });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: a } })).ownerId).toBe(乙);
    expect(await prisma.entNotice.count()).toBe(0);
  });
});

describe("回收、将回收", () => {
  const 时 = (s: string) => new Date(`${s.replace(" ", "T")}:00`);
  const 开着 = { ...默认组织规则, 超时回收: { 开: true, 起算日: null, 节点天数: { 潜客培育: 3 } } };
  const 建项目 = async (ownerId: string, createdAt: string) => {
    const c = (await prisma.customer.create({ data: { name: `客户${createdAt}`, phone: "", salesOwnerId: ownerId } })).id;
    return (await prisma.project.create({ data: { name: "回收项目", customerId: c, ownerId, creatorId: ownerId, createdAt: 时(createdAt) } })).id;
  };
  const 在公海 = async (id: string) => (await prisma.project.findUniqueOrThrow({ where: { id } })).pooledAt !== null;

  beforeEach(async () => {
    await prisma.project.deleteMany();
    await setSetting("business", { projectMode: true });
    await setSetting("orgRules", 开着);
    invalidateSettingsCache();
  });

  it("回收：负责人和上级各一条，上级看得出是谁的；待办只给负责人", async () => {
    const p = await 建项目(甲, "2026-10-01 10:00");
    expect(await 公海超时收回(系统, 时("2026-10-25 00:05"))).toBe(1);
    expect(await 在公海(p)).toBe(true);
    expect(await 收件人("回收")).toEqual(排(甲, 组长));
    for (const n of await 通知们({ kind: "回收" })) {
      expect(n.dedupeKey).toBe(`recall:${p}:2026-10-25`);
      expect(n.body).toBe("负责人：销售甲");
    }
    expect(await prisma.task.count({ where: { ownerId: 组长 } })).toBe(0);
    expect(await prisma.task.count({ where: { ownerId: 甲 } })).toBeGreaterThan(0);
  });

  it("将回收：负责人和上级各一条，同一天再扫不重发；待办只给负责人", async () => {
    const p = await 建项目(甲, "2026-10-23 10:00"); // 3 天 → 10-26
    expect(await 公海超时收回(系统, 时("2026-10-25 00:05"))).toBe(0);
    expect(await 收件人("将回收")).toEqual(排(甲, 组长));
    for (const n of await 通知们({ kind: "将回收" })) expect(n).toMatchObject({ dedupeKey: `due-soon:${p}:2026-10-25`, link: `/projects/${p}`, body: "负责人：销售甲" });
    expect(await prisma.task.count({ where: { ownerId: 组长 } })).toBe(0);

    await prisma.setting.deleteMany({ where: { key: { contains: "timeout" } } });
    invalidateSettingsCache();
    await 公海超时收回(系统, 时("2026-10-25 12:00"));
    expect(await prisma.entNotice.count({ where: { kind: "将回收" } })).toBe(2);
  });

  it("没上级：不报错，只发负责人", async () => {
    await 建项目(独行, "2026-10-01 10:00");
    expect(await 公海超时收回(系统, 时("2026-10-25 00:05"))).toBe(1);
    expect(await 收件人("回收")).toEqual([独行]);
  });

  it("上级就是负责人自己：不重复；上级停用不发", async () => {
    await prisma.entMember.update({ where: { userId: 乙 }, data: { managerId: 乙 } });
    await 建项目(乙, "2026-10-01 10:00");
    await prisma.user.update({ where: { id: 组长 }, data: { active: false } });
    await 建项目(甲, "2026-10-01 11:00");
    expect(await 公海超时收回(系统, 时("2026-10-25 00:05"))).toBe(2);
    expect(await 收件人("回收")).toEqual(排(甲, 乙));
  });

  it("读组织出错：只发负责人，回收照做", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = await 建项目(甲, "2026-10-01 10:00");
    mocks.读组织出错 = true;
    const 收 = await 公海超时收回(系统, 时("2026-10-25 00:05"));
    mocks.读组织出错 = false;
    expect(收).toBe(1);
    expect(await 在公海(p)).toBe(true);
    expect(await 收件人("回收")).toEqual([甲]);
  });
});

describe("待分配文案", () => {
  it("待分配：kind、标题不说满额，告诉为什么、去手动分", async () => {
    await 发待分配提醒(await 读组织(), ["线索一"], "市场小李", "这条业务线没人可分");
    const [n] = await prisma.entNotice.findMany();
    expect(n.kind).toBe("待分配");
    expect(n.title).toBe("待分配：1 条新线索没自动分出去");
    expect(n.title).not.toContain("满额");
    expect(n.body).not.toContain("满额");
    expect(n.body).toContain("这条业务线没人可分");
    expect(n.body).toContain("手动分");
  });

  it("满额：文案不变", async () => {
    await 发满额提醒(await 读组织(), ["线索一"], "市场小李");
    // 上面的组织没有市场管理，收件人是总管理
    const [n] = await prisma.entNotice.findMany();
    expect(n).toMatchObject({ userId: 总管, kind: "满额", title: "自动分配没分出去：1 条线索都已满额" });
  });
});
