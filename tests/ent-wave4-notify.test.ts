/**
 * 审核 11-18「通知与定时任务」剩下的几条（第四波）：
 *   P2-1 「找总管理开通」一人一项一天一次，天按北京算（原来取 UTC 日）
 *   P2-2 待分配提醒 / 能分配的人们：销售管理只发本线的（P-公海-07）；线索没标线、销管没设线的照旧
 *   P2-3 飞书推送卡在「待推 / 推送中」的（进程重启、批次出错）记成失败，不重推（M-公海-33）
 *   P2-4 停用的人推送原因写「账号已停用」，不再混成「没绑飞书」
 *   P2-5 超时回收「回收前一天」提醒：几遍扫同时跑（多进程 / 页面触发）只建一条待办
 *   P2-7 负责人停用：通知改发他停用前的直属上级（同三态 T12）；验证待办销售那一步同理
 *   P2-10 线索验证同一步：收件人还有没读的那条就不再推
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "a@x", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { resetDb } from "./reset";
import { 找总管理开通 } from "@/app/(app)/settings/actions";
import { 系统管理员标记键, 建组织, 负责人和上级, 在职负责人或上级 } from "@/lib/enterprise/org";
import { 满额提醒收件人 } from "@/lib/enterprise/lead-full-notice";
import { 能分配的人们 } from "@/lib/enterprise/await-assign";
import { 飞书推送开关键, 清飞书推送令牌, 推通知们, 收拾卡住的推送, 推送卡住话 } from "@/lib/enterprise/feishu-push";
import { 验证待办通知 } from "@/lib/enterprise/notice-sources";
import { 夜里扫超时 } from "@/lib/project/nightly";
import { 默认组织规则 } from "@/lib/project/org-rules";

let 序 = 0;
async function 人(name: string, bizRole: string, 补: { managerId?: string | null; line?: string | null; active?: boolean; feishuOpenId?: string } = {}) {
  const id = (await prisma.user.create({ data: { email: `w4n${++序}@x`, name, title: "", role: "SALES", password: "x", active: 补.active ?? true, feishuOpenId: 补.feishuOpenId ?? null } })).id;
  await prisma.entMember.create({ data: { userId: id, bizRole, managerId: 补.managerId ?? null, line: 补.line ?? null } });
  return id;
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("P2-1 「找总管理开通」一天按北京算", () => {
  it("北京 11-18 07:30 和 09:00 各点一次：同一天，只发一条", async () => {
    const 销售 = await 人("销售", "sales");
    const 老板 = await 人("老板", "director");
    await setSetting(系统管理员标记键, [老板]);
    mocks.user = { ...mocks.user, id: 销售, name: "销售" };
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T23:30:00Z")); // 北京 11-18 07:30
    expect((await 找总管理开通("recycle")).ok).toBe(true);
    vi.setSystemTime(new Date("2026-11-18T01:00:00Z")); // 北京 11-18 09:00
    expect((await 找总管理开通("recycle")).ok).toBe(true);
    vi.useRealTimers();
    expect(await prisma.entNotice.count({ where: { userId: 老板, kind: "设置" } })).toBe(1);
  });
});

describe("P2-2 待分配提醒：销售管理只发本线的", () => {
  const org = 建组织(
    ["市管", "老板", "内销管", "外销管", "无线销管", "销售"].map((id) => ({ id, role: "SALES", active: true })),
    [
      { userId: "市管", bizRole: "marketing_mgr", line: "内贸" },
      { userId: "老板", bizRole: "director", line: null },
      { userId: "内销管", bizRole: "sales_mgr", line: "内贸" },
      { userId: "外销管", bizRole: "sales_mgr", line: "外贸" },
      { userId: "无线销管", bizRole: "sales_mgr", line: null },
      { userId: "销售", bizRole: "sales", line: "内贸" },
    ].map((m) => ({ ...m, deptId: null, managerId: null, dottedManagerId: null })),
    [],
  );
  const 排 = (xs: string[]) => [...xs].sort();
  it("内贸线索：外贸的销售管理不收；市场管理、总管理、没设线的销管照收", () => {
    expect(排(满额提醒收件人(org, "待分配", false, "内贸"))).toEqual(排(["市管", "老板", "内销管", "无线销管"]));
    expect(排(能分配的人们(org, "外贸"))).toEqual(排(["市管", "老板", "外销管", "无线销管"]));
  });
  it("线索没标线（暂不分配 / 空）、不给线：照旧全发", () => {
    const 全 = 排(["市管", "老板", "内销管", "外销管", "无线销管"]);
    expect(排(满额提醒收件人(org, "待分配", false, "暂不分配"))).toEqual(全);
    expect(排(满额提醒收件人(org, "待分配", false, null))).toEqual(全);
    expect(排(能分配的人们(org))).toEqual(全);
  });
  it("满额提醒不发销管（不变）", () => {
    expect(排(满额提醒收件人(org, "满额", false, "内贸"))).toEqual(排(["市管", "老板"]));
  });
});

describe("P2-3 / P2-4 飞书推送状态", () => {
  const 令牌地址 = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";
  const 回 = (j: unknown) => new Response(JSON.stringify(j), { status: 200, headers: { "Content-Type": "application/json" } });
  beforeEach(async () => {
    清飞书推送令牌();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url === 令牌地址 ? 回({ code: 0, tenant_access_token: "tok", expire: 7200 }) : 回({ code: 0 }))));
    vi.stubEnv("ENT_FEISHU_APP_ID", "cli_test");
    vi.stubEnv("ENT_FEISHU_APP_SECRET", "s3cr3t");
    await setSetting(飞书推送开关键, true);
  });

  it("停用的人：记「账号已停用」，不是「没绑飞书」", async () => {
    const 停了 = await 人("停了", "sales", { active: false, feishuOpenId: "ou_x" });
    const 没绑 = await 人("没绑", "sales");
    const a = await prisma.entNotice.create({ data: { userId: 停了, kind: "转项目", title: "t", dedupeKey: "k1" } });
    const b = await prisma.entNotice.create({ data: { userId: 没绑, kind: "转项目", title: "t", dedupeKey: "k2" } });
    await 推通知们([a.id, b.id]);
    expect(await prisma.entNotice.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ feishuStatus: "没推", feishuError: "账号已停用" });
    expect(await prisma.entNotice.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ feishuStatus: "没推", feishuError: "没绑飞书" });
  });

  it("卡在「推送中 / 待推」超过 10 分钟的记成失败；刚写的、已推的不动", async () => {
    const 甲 = await 人("甲", "sales", { feishuOpenId: "ou_jia" });
    const 现在 = new Date();
    const 早 = new Date(现在.getTime() - 20 * 60_000);
    const 卡推送中 = await prisma.entNotice.create({ data: { userId: 甲, kind: "分配", title: "t", dedupeKey: "a", feishuStatus: "推送中", createdAt: 早 } });
    const 卡待推 = await prisma.entNotice.create({ data: { userId: 甲, kind: "分配", title: "t", dedupeKey: "b", feishuStatus: "待推", createdAt: 早 } });
    const 刚写 = await prisma.entNotice.create({ data: { userId: 甲, kind: "分配", title: "t", dedupeKey: "c", feishuStatus: "推送中", createdAt: 现在 } });
    const 已推 = await prisma.entNotice.create({ data: { userId: 甲, kind: "分配", title: "t", dedupeKey: "d", feishuStatus: "已推", createdAt: 早 } });
    expect(await 收拾卡住的推送(现在, true)).toBe(2);
    for (const r of [卡推送中, 卡待推]) expect(await prisma.entNotice.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ feishuStatus: "失败", feishuError: 推送卡住话 });
    expect((await prisma.entNotice.findUniqueOrThrow({ where: { id: 刚写.id } })).feishuStatus).toBe("推送中");
    expect((await prisma.entNotice.findUniqueOrThrow({ where: { id: 已推.id } })).feishuStatus).toBe("已推");
  });
});

describe("P2-7 负责人停用：改发停用前的直属上级", () => {
  const org = 建组织(
    [{ id: "上级", role: "SALES", active: true }, { id: "停了", role: "SALES", active: false }, { id: "在职", role: "SALES", active: true }, { id: "孤", role: "SALES", active: false }],
    [
      { userId: "上级", bizRole: "sales_mgr", deptId: null, line: null, managerId: null, dottedManagerId: null },
      { userId: "停了", bizRole: "sales", deptId: null, line: null, managerId: "上级", dottedManagerId: null },
      { userId: "在职", bizRole: "sales", deptId: null, line: null, managerId: "上级", dottedManagerId: null },
      { userId: "孤", bizRole: "sales", deptId: null, line: null, managerId: null, dottedManagerId: null },
    ],
    [],
  );
  it("负责人和上级：在职 = 本人 + 上级；停用 = 停用前的上级；都没有 = 空", () => {
    expect(负责人和上级(org, "在职")).toEqual(["在职", "上级"]);
    expect(负责人和上级(org, "停了")).toEqual(["上级"]);
    expect(负责人和上级(org, "孤")).toEqual([]);
  });
  it("在职负责人或上级：只该发本人的，停用了发上级", () => {
    expect(在职负责人或上级(org, "在职")).toEqual(["在职"]);
    expect(在职负责人或上级(org, "停了")).toEqual(["上级"]);
    expect(在职负责人或上级(org, "孤")).toEqual([]);
  });
});

describe("P2-7 / P2-10 线索验证通知", () => {
  let 市管: string, 销管: string, 停了的销售: string, P: string;
  beforeEach(async () => {
    市管 = await 人("市管", "marketing_mgr");
    销管 = await 人("销管", "sales_mgr");
    停了的销售 = await 人("停了的销售", "sales", { managerId: 销管, active: false });
    const c = await prisma.customer.create({ data: { name: "客户", phone: "13900000001", salesOwnerId: 停了的销售 } });
    P = (await prisma.project.create({ data: { name: "项目", customerId: c.id, ownerId: 停了的销售, creatorId: 市管, phase: "线索", node: "线索验证" } })).id;
  });
  const 当 = (id: string, name: string) => ({ id, name });

  it("销售终验这一步、负责人已停用：发给他停用前的直属上级", async () => {
    await prisma.entLeadVerify.create({ data: { projectId: P, verdict: "初验无效", pending: "销售终验", reviewNote: "维持无效" } });
    await 验证待办通知(当(市管, "市管"), P);
    const 们 = await prisma.entNotice.findMany({ where: { kind: "线索验证" } });
    expect(们.map((n) => n.userId)).toEqual([销管]);
  });

  it("同一步验证行又写了一次（补理由）：还没读的不再推一条；读过了再写才推", async () => {
    await prisma.entLeadVerify.create({ data: { projectId: P, verdict: "初验无效", pending: "销售终验", reviewNote: "第一次" } });
    await 验证待办通知(当(市管, "市管"), P);
    await prisma.entLeadVerify.update({ where: { projectId: P }, data: { reviewNote: "补一句", updatedAt: new Date(Date.now() + 19_000) } });
    await 验证待办通知(当(市管, "市管"), P);
    expect(await prisma.entNotice.count({ where: { userId: 销管, kind: "线索验证" } })).toBe(1);
    await prisma.entNotice.updateMany({ where: { userId: 销管 }, data: { readAt: new Date() } });
    await prisma.entLeadVerify.update({ where: { projectId: P }, data: { reviewNote: "再补", updatedAt: new Date(Date.now() + 40_000) } });
    await 验证待办通知(当(市管, "市管"), P);
    expect(await prisma.entNotice.count({ where: { userId: 销管, kind: "线索验证" } })).toBe(2);
  });
});

describe("P2-5 超时回收「回收前一天」提醒：同时扫两遍只建一条", () => {
  it("两遍扫同时跑（多进程 / 页面触发）：明天要收的只有一条待办", async () => {
    await setSetting("business", { projectMode: true });
    await setSetting("orgRules", { ...默认组织规则, 超时回收: { 开: true, 起算日: null, 节点天数: { 潜客培育: 3 } } });
    const 乙 = await 人("乙", "sales");
    const c = await prisma.customer.create({ data: { name: "客户甲", phone: "13800000001", salesOwnerId: 乙 } });
    await prisma.project.create({ data: { name: "一号项目", customerId: c.id, ownerId: 乙, creatorId: 乙, createdAt: new Date("2026-10-23T10:00:00") } }); // → 10-26 收
    const 今 = new Date("2026-10-25T00:05:00");
    await Promise.all([夜里扫超时(今), 夜里扫超时(今), 夜里扫超时(今)]);
    expect(await prisma.task.count({ where: { ownerId: 乙, title: { contains: "一号项目" } } })).toBe(1);
  });
});
