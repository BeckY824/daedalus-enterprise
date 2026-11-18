/**
 * 11-18 审核第四波追加（口径核对 第四波口径核对-20261118.md）：服务端几条，修前红、修后绿。
 *   - 权限 P1-9（X-88）：企业版只用项目时，老线索表的 saveLead / convertLead / mergeLeadInto 开头就挡
 *   - 权限 P1-11（P-沟通-04）：项目组员记沟通不写项目下一步、不跑按必填推进，超时回收开着也不要求组员填下一步
 *   - 权限 P2-1：只读管理员不兼其他业务角色（设置页存角色时拦，同销售教练那条）
 *   - 权限 P2-3：渠道投入 / 管渠道只给系统管理员、市场管理，条线总管理只看
 *   - 权限 P2-10（P-沟通-04、P-看-09）：同号再次录入，没设业务角色、设了只看某人的不走协同（不记沟通、不发邀请）
 *   - 新建入口 P2-6（P-删-08）：联系人表单查重也算回收站里的号，撞了拦下、给捞回入口
 *   - 权限 P1-12 · 统计 P2-6 · 通知 P2-7（M-公海-50 / 49）：停用的人留在停用前上级的链里（看得到、数得到），下拉照旧不列；
 *     通知找不到在职的停用前上级时推系统管理员
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const 当前 = vi.hoisted(() => ({ me: { id: "", name: "", email: "x", role: "SALES", title: "" } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => 当前.me, getCurrentUser: async () => 当前.me }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { dayjs } from "@/lib/utils";
import { saveLead, convertLead, mergeLeadInto } from "@/app/(app)/leads/actions";
import { 记项目沟通 } from "@/lib/project/db";
import { 存组织规则 } from "@/lib/project/org-rules-store";
import { 默认组织规则 } from "@/lib/project/org-rules";
import { 角色组合问题 } from "@/lib/sync/dept-policy";
import { 能录投入, 能管渠道 } from "@/lib/enterprise/channel-stats";
import { 读组织 } from "@/lib/enterprise/org";
import { 只看某人键 } from "@/lib/enterprise/org-core";
import { 同号再次录入 } from "@/lib/enterprise/same-number-collab";
import { 验号码 } from "@/lib/enterprise/contact-format";
import { saveContact } from "@/app/(app)/customers/[id]/actions";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 负责人和上级, 在职负责人或上级 } from "@/lib/enterprise/org-core";
import { 复盘负责人of, 看板的人 } from "@/lib/project/board-member";
import { 补潜客培育, 零项目客户补潜客培育 } from "@/lib/project/nurture";

let 系管 = "", 外线总 = "", 销售 = "", 组员 = "", 市场管 = "", 经理 = "";
let 序 = 0;
const 人 = async (name: string, bizRole: string | null, 补: { line?: string | null; managerId?: string | null } = {}) => {
  const u = await prisma.user.create({ data: { email: `${name}${++序}@x`, name, title: "", role: "SALES", password: "x" } });
  if (bizRole !== null) await prisma.entMember.create({ data: { userId: u.id, bizRole, line: 补.line ?? null, managerId: 补.managerId ?? null } });
  return u.id;
};
const 当 = (id: string) => { 当前.me = { ...当前.me, id, name: id }; };
const 客户 = async (salesOwnerId: string, 补: Record<string, unknown> = {}) =>
  (await prisma.customer.create({ data: { name: `示例客户${++序}`, phone: "", salesOwnerId, ...补 } })).id;

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  系管 = await 人("系管", "director");
  外线总 = await 人("外线总", "director", { line: "外贸" });
  经理 = await 人("经理", "sales_mgr");
  销售 = await 人("销售", "sales", { managerId: 经理 });
  组员 = await 人("组员", "sales");
  市场管 = await 人("市场管", "marketing_mgr");
});
afterEach(() => void vi.unstubAllEnvs());
afterAll(() => prisma.$disconnect());

describe("权限 P1-9 老线索表（X-88）", () => {
  it("企业版只用项目：saveLead / convertLead / mergeLeadInto 开头就挡，一条不写", async () => {
    await setSetting("business", { projectMode: true } as never);
    invalidateSettingsCache();
    const a = (await prisma.lead.create({ data: { name: "老线索甲", ownerId: 销售, status: "待跟进" } })).id;
    const b = (await prisma.lead.create({ data: { name: "老线索乙", ownerId: 销售, status: "待跟进" } })).id;
    当(系管);
    const 新 = await saveLead({ name: "新录的", phone: "13900009999", email: "", contact: "", industry: "", source: "官网表单", status: "待跟进", remark: "", ownerId: "" } as never);
    expect(新).toMatchObject({ ok: false, error: expect.stringContaining("新线索") });
    expect(await convertLead(a)).toMatchObject({ ok: false, error: expect.stringContaining("新线索") });
    expect(await mergeLeadInto(a, b)).toMatchObject({ ok: false, error: expect.stringContaining("新线索") });
    expect(await prisma.lead.count()).toBe(2);
    expect(await prisma.customer.count()).toBe(0);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: a } })).status).toBe("待跟进");
  });
});

describe("权限 P1-11 组员记沟通不碰项目下一步（P-沟通-04）", () => {
  const 建 = async () => {
    const c = await 客户(销售);
    const p = await prisma.project.create({ data: { name: "在推项目", customerId: c, ownerId: 销售, creatorId: 销售, phase: "商机", node: "明确需求", nextStepText: "负责人定的", nextStepAt: dayjs().add(5, "day").startOf("day").toDate() } });
    await prisma.projectMember.create({ data: { projectId: p.id, userId: 组员, inviteStatus: "JOINED" } });
    return p;
  };
  const 沟通 = (补: Record<string, unknown> = {}) => ({ type: "PHONE", content: "组员打了电话", occurredAt: dayjs().subtract(1, "hour").toISOString(), 阶段: "商机", ...补 });

  it("组员带着下一步记：沟通记上，项目下一步还是负责人定的", async () => {
    const p = await 建();
    const r = await 记项目沟通({ id: 组员, role: "SALES" } as never, p.id, 沟通({ 下一步: "组员想改", 下一步时间: dayjs().add(1, "day").format("YYYY-MM-DD") }) as never);
    expect(r).toMatchObject({ ok: true });
    const 后 = await prisma.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(后.nextStepText).toBe("负责人定的");
    expect(dayjs(后.nextStepAt).format("YYYY-MM-DD")).toBe(dayjs().add(5, "day").format("YYYY-MM-DD"));
    expect(await prisma.followUp.count({ where: { ownerId: 组员 } })).toBe(1);
  });

  it("超时回收开着、项目详情那条（要下一步文字）：组员不填下一步也记得上；负责人照旧要填", async () => {
    await 存组织规则({ ...默认组织规则, 超时回收: { ...默认组织规则.超时回收, 开: true, 起算日: null, 节点天数: { 明确需求: 30 } } });
    invalidateSettingsCache();
    const p = await 建();
    expect(await 记项目沟通({ id: 组员, role: "SALES" } as never, p.id, 沟通() as never, new Date(), { 要下一步文字: true })).toMatchObject({ ok: true });
    expect(await 记项目沟通({ id: 销售, role: "SALES" } as never, p.id, 沟通() as never, new Date(), { 要下一步文字: true })).toMatchObject({ ok: false });
  });
});

describe("权限 P2-1 只读管理员不兼其他业务角色", () => {
  it("admin + 别的角色：拦；单独 admin、别的组合照旧", () => {
    expect(角色组合问题(["admin", "sales"])).toBe("只读管理员不兼其他业务角色");
    expect(角色组合问题(["sales_mgr", "admin"])).toBe("只读管理员不兼其他业务角色");
    expect(角色组合问题(["admin"])).toBeNull();
    expect(角色组合问题(["sales", "sales_mgr"])).toBeNull();
  });
});

describe("权限 P2-3 渠道只给系统管理员、市场管理", () => {
  it("条线总管理只看；系统管理员、市场管理能管能录", async () => {
    const org = await 读组织();
    const 谁 = (id: string) => ({ id, role: "SALES" });
    expect([能录投入(org, 谁(外线总)), 能管渠道(org, 谁(外线总))]).toEqual([false, false]);
    expect([能录投入(org, 谁(系管)), 能管渠道(org, 谁(系管))]).toEqual([true, true]);
    expect([能录投入(org, 谁(市场管)), 能管渠道(org, 谁(市场管))]).toEqual([true, true]);
    expect(能录投入(org, 谁(经理))).toBe(false);
  });
});

describe("权限 P2-10 同号再次录入：没设角色、只看某人的不走协同", () => {
  const 号码 = "13800138000";
  const 好号 = () => {
    const r = 验号码("手机号", 号码);
    if (!r.ok) throw new Error("号码样例没过格式");
    return r;
  };
  const 现场 = async () => {
    const c = await 客户(销售, { phone: 号码 });
    await prisma.project.create({ data: { name: "撞号项目", customerId: c, ownerId: 销售, creatorId: 销售, phase: "线索", node: "潜客培育" } });
  };

  it("没设业务角色：不走，不记沟通、不发邀请", async () => {
    await 现场();
    const 无角色 = await 人("无角色", null);
    当(无角色);
    const r = await 同号再次录入({ id: 无角色, name: "无角色" } as never, 好号(), { 入口: "手工建档", 渠道id: null, 内容: "又来了" } as never);
    expect(r.走).toBe(false);
    expect(await prisma.followUp.count()).toBe(0);
    expect(await prisma.projectMember.count()).toBe(0);
  });

  it("设了只看某人：不走", async () => {
    await 现场();
    await setSetting(只看某人键, JSON.stringify({ [经理]: 组员 }));
    invalidateSettingsCache();
    当(经理);
    const r = await 同号再次录入({ id: 经理, name: "经理" } as never, 好号(), { 入口: "手工建档", 渠道id: null, 内容: "又来了" } as never);
    expect(r.走).toBe(false);
    expect(await prisma.followUp.count()).toBe(0);
    expect(await prisma.projectMember.count()).toBe(0);
  });

  it("对照：普通销售照走", async () => {
    await 现场();
    当(组员);
    const r = await 同号再次录入({ id: 组员, name: "组员" } as never, 好号(), { 入口: "手工建档", 渠道id: null, 内容: "又来了" } as never);
    expect(r.走).toBe(true);
  });
});

describe("新建入口 P2-6 联系人表单查重算回收站（P-删-08）", () => {
  it("号码只在回收站里的客户上：拦下、带捞回要的号；仍然保存也不放", async () => {
    await 客户(销售, { phone: "13900000301", deletedAt: new Date() });
    const 活 = await 客户(销售);
    当(系管);
    const 交 = { customerId: 活, name: "新联系人", phone: "13900000301", isPrimary: false } as never;
    const r = await saveContact(交);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("回收站"), 回收站: { 类型: "手机号", 值: "13900000301" } });
    expect(await saveContact({ ...(交 as object), 照存: true } as never)).toMatchObject({ ok: false, 回收站: { 类型: "手机号" } });
    expect(await prisma.contact.count({ where: { name: "新联系人" } })).toBe(0);
  });

  it("对照：回收站里没有的号照常存", async () => {
    const 活 = await 客户(销售);
    当(系管);
    expect(await saveContact({ customerId: 活, name: "新联系人", phone: "13900000302", isPrimary: false } as never)).toMatchObject({ ok: true });
  });
});

describe("权限 P1-12 · 统计 P2-6 · 通知 P2-7 停用账号名下（M-公海-50 / 49）", () => {
  const 停用 = (id: string) => prisma.user.update({ where: { id }, data: { active: false } });

  it("停用前直属上级看得到、数得到他名下的项目；看板下拉不列他", async () => {
    await setSetting(规则.按组织看客户.key, true);
    invalidateSettingsCache();
    const 离职 = await 人("离职", "sales", { managerId: 经理 });
    const c = await 客户(离职);
    const p = await prisma.project.create({ data: { name: "离职名下", customerId: c, ownerId: 离职, creatorId: 离职, phase: "商机", node: "明确需求" } });
    await 停用(离职);
    忘掉企业版范围();
    当(经理);
    const 看到 = await 以谁的身份(经理, () => prisma.project.findMany({ where: { id: p.id }, select: { id: true } }));
    expect(看到.map((x) => x.id)).toEqual([p.id]);
    const org = await 读组织();
    expect(复盘负责人of(org, 经理)).toContain(离职);
    const 板 = await 看板的人({ id: 经理, role: "SALES" });
    expect(板.谁).toContain(离职);
    expect((板.选项 ?? []).map((x) => x.value)).not.toContain(离职);
    // 别的销管看不到
    const 别管 = await 人("别管", "sales_mgr");
    忘掉企业版范围();
    expect(await 以谁的身份(别管, () => prisma.project.count({ where: { id: p.id } }))).toBe(0);
  });

  it("通知：停用前上级在职发他；上级也停用了推系统管理员", async () => {
    const 离职 = await 人("离职二", "sales", { managerId: 经理 });
    await 停用(离职);
    expect(负责人和上级(await 读组织(), 离职)).toEqual([经理]);
    await 停用(经理);
    const org = await 读组织();
    expect(负责人和上级(org, 离职)).toEqual([系管]);
    expect(在职负责人或上级(org, 离职)).toEqual([系管]);
    // 没有负责人（公海占位的空串）不往系统管理员推
    expect(负责人和上级(org, "")).toEqual([]);
  });
});

describe("节点 P2-1 补建项目的业务线（X-86 A1：项目 → 负责人线 → 内贸，永不为空）", () => {
  it("补潜客培育：负责人设了线按他的线，没设按内贸；零项目客户补也一样；不看客户标签", async () => {
    const 外 = await 人("外贸销售", "sales", { line: "外贸" });
    const a = await 客户(外, { bizLine: "内贸" });
    const b = await 客户(销售);
    const c = await 客户(外);
    const 建 = (customerId: string, ownerId: string) => prisma.$transaction((tx) => 补潜客培育(tx, { customerId, 客户名: "补的", ownerId, creatorId: ownerId }));
    const pa = await 建(a, 外), pb = await 建(b, 销售);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: pa! } })).bizLine).toBe("外贸");
    expect((await prisma.project.findUniqueOrThrow({ where: { id: pb! } })).bizLine).toBe("内贸");
    const 补 = await prisma.$transaction((tx) => 零项目客户补潜客培育(tx, [c], 系管));
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 补.get(c)! } })).bizLine).toBe("外贸");
  });
});
