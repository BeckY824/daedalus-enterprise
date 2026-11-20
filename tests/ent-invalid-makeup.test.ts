/**
 * 判无效补位（11-20，M-线索-02 补「优先」，lib/enterprise/invalid-makeup.ts）。
 * 钉的是：最终判无效、占过名额的，记一个待补（每次判无效 1 个），不看配额模式；判无效那条的名额不退、不加配额；
 * 自动分配在合格候选里先给有待补的人（多人按判无效先后），挑中就用掉最早一个；补发不算本月已分、不影响轮转（用户 11-20：
 * 本轮已分过的只额外补 1 条；本轮还没轮到的，补完以后正常轮到照常给）；
 * 不合格（暂停）跳过、待补留着；方向对不上不优先；指定分配、公海分配不用；撤销自动分配退回、判无效的线索恢复作废；
 * 各自动分配入口（单条、批量、定时到点、超时转、查重领取）都走同一套挑人（读挑人底子 + 挑接手人）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 自动分配线索, 批量自动分配, 分配线索, 撤销自动分配, 本月分配情况, 定时分出去, 超时转出 } from "@/app/(app)/leads/assign-actions";
import { 自动分配不参与key, 不设配额key, 月份, 挑接手人, 前面几条, 挑的理由, 挂补位, type 候选人 } from "@/lib/enterprise/lead-assign";
import { 销售初判, 市场复核 } from "@/lib/project/lead-verify";
import { 改节点 } from "@/lib/project/db";
import { 待补数们, 作废补位 } from "@/lib/enterprise/invalid-makeup";
import { 验证待办通知 } from "@/lib/enterprise/notice-sources";
import { 估算轮到 } from "@/lib/enterprise/assign-eta";
import { 读组织 } from "@/lib/enterprise/org";
import { 超时转令牌, 定时分配令牌 } from "@/lib/enterprise/scheduled-assign-token";
import { 系统操作人 } from "@/lib/enterprise/scheduled-assign";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
let 总管: 人, 市场: 人, 甲: 人, 乙: 人, 丙: 人;

const 造人 = async (key: string, role: string, bizRole: string, line: string | null = null): Promise<人> => {
  const u = await prisma.user.create({ data: { email: `${key}@x`, name: key, title: "", role, password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, line } });
  return { id: u.id, name: key, email: `${key}@x`, role, title: "", avatar: null };
};
const 以 = <T,>(u: 人, fn: () => Promise<T>): Promise<T> => { mocks.user = { ...u }; return 以谁的身份(u.id, fn); };
const 身份 = (u: 人) => ({ id: u.id, role: u.role });
let 序 = 0;
const 客户 = async (ownerId: string) => {
  序 += 1;
  return (await prisma.customer.create({ data: { name: `客户${序}`, phone: `139${String(序).padStart(8, "0")}`, salesOwnerId: ownerId } })).id;
};
const 线索 = async (customerId: string, ownerId: string, creatorId = ownerId, node = "线索验证") => {
  序 += 1;
  return (await prisma.project.create({ data: { name: `线索${序}`, customerId, ownerId, creatorId, node, bizLine: "内贸" } })).id;
};
const 分配行 = (projectId: string, toUserId: string, 补: { counted?: boolean; month?: string; line?: string } = {}) =>
  prisma.entLeadAssign.create({ data: { projectId, toUserId, byUserId: 市场.id, month: 月份(), line: "内贸", ...补 } });
const 负责人 = async (id: string) => (await prisma.project.findUniqueOrThrow({ where: { id } })).ownerId;

/** 分给 谁 的一条线索（占过名额），走到最终判无效：销售初判无效 → 市场复核判无效 */
const 分来又判死 = async (谁: 人, 补: { line?: string } = {}) => {
  const L = await 线索(await 客户(市场.id), 谁.id, 市场.id);
  await 分配行(L, 谁.id, 补);
  expect((await 销售初判(身份(谁), L, "无效", { invalidReason: "联系方式无效", verifyNote: "打了三次" })).ok).toBe(true);
  expect((await 市场复核(身份(市场), L, false)).ok).toBe(true);
  return L;
};
/** 市场手上一条等分的新线索（潜客培育，市场建、市场名下） */
const 新线索 = async () => 线索(await 客户(市场.id), 市场.id, 市场.id, "潜客培育");
const 待补 = async (u: 人) => (await 待补数们([u.id])).get(u.id) ?? 0;

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  总管 = await 造人("dir", "ADMIN", "director");
  市场 = await 造人("mkt", "SALES", "marketing_mgr");
  甲 = await 造人("jia", "SALES", "sales", "内贸");
  乙 = await 造人("yi", "SALES", "sales", "内贸");
  丙 = await 造人("bing", "SALES", "sales", "内贸");
  await setSetting("business", { projectMode: true });
  await setSetting(规则.按组织看客户.key, true);
  await setSetting(规则.线索分配.key, true);
  await setSetting(不设配额key, true); // 正式服现状：不设配额（只比本月已分）
  await setSetting(自动分配不参与key, { [总管.id]: "禁止", [市场.id]: "禁止" });
  invalidateSettingsCache();
  忘掉企业版范围();
});
afterEach(() => { vi.unstubAllEnvs(); invalidateSettingsCache(); });

describe("纯函数：挑接手人 / 前面几条 / 挑的理由 / 挂补位", () => {
  const 时 = (n: number) => new Date(2026, 10, n);
  const 人们 = (): 候选人[] => [
    { userId: "a", 已分: 5, 配额: null, 进池: 时(1) },
    { userId: "b", 已分: 0, 配额: null, 进池: 时(2) },
    { userId: "c", 已分: 3, 配额: null, 进池: 时(3) },
  ];

  it("没人待补：照原来比（不限额比条数）", () => {
    expect(挑接手人(人们(), new Set(), true, true)).toBe("b");
  });
  it("有待补的先，哪怕本月已分最多；多人待补按退名额时间最早的先", () => {
    const 们 = 挂补位(人们(), [{ userId: "c", at: 时(10), line: null }, { userId: "a", at: 时(12), line: "内贸" }], "内贸");
    expect(挑接手人(们, new Set(), true, true)).toBe("c");
    expect(挑接手人(们, new Set(["c"]), true, true)).toBe("a");
    // 按配额分也一样：先筛（没填配额的不挑），合格的里待补优先
    const 配 = 们.map((x) => ({ ...x, 配额: 10 }));
    expect(挑接手人(配, new Set(), true, false)).toBe("c");
  });
  it("不合格的（不参与、按配额分时没填配额）跳过，待补不帮他插队", () => {
    const 们 = 挂补位(人们(), [{ userId: "a", at: 时(10), line: null }], null);
    expect(挑接手人(们, new Set(["a"]), true, true)).toBe("b");
    const 没填 = 们.map((x) => ({ ...x, 配额: x.userId === "a" ? null : 10 }));
    expect(挑接手人(没填, new Set(), true, false)).toBe("b");
  });
  it("方向对不上的待补不挂：外贸的待补不影响内贸分配；没记方向的、这次没定方向的都算", () => {
    const 行 = [{ userId: "a", at: 时(10), line: "外贸" }];
    expect(挂补位(人们(), 行, "内贸").find((x) => x.userId === "a")?.待补).toBeUndefined();
    expect(挂补位(人们(), 行, null).find((x) => x.userId === "a")?.待补).toHaveLength(1);
    expect(挂补位(人们(), [{ userId: "a", at: 时(10), line: null }], "外贸").find((x) => x.userId === "a")?.待补).toHaveLength(1);
  });
  it("按配额分时，有待补的分满了也照挑（补发不占配额）", () => {
    const 们 = 挂补位(人们(), [{ userId: "a", at: 时(10), line: null }], null).map((x) => ({ ...x, 配额: x.userId === "a" ? 5 : 10 }));
    expect(挑接手人(们, new Set(), true, false)).toBe("a");
  });
  it("前面几条：待补的人是下一条；补发不加本月已分", () => {
    const 们 = 挂补位(人们(), [{ userId: "a", at: 时(10), line: null }, { userId: "a", at: 时(11), line: null }], null);
    expect(前面几条(们, new Set(), true, true, "a")).toBe(0);
    // 甲两条待补：前两条都是他，b 排第 3
    expect(前面几条(们, new Set(), true, true, "b")).toBe(2);
  });
  it("挑的理由说清是判无效补名额", () => {
    const 们 = 挂补位(人们(), [{ userId: "a", at: 时(10), line: null }], null);
    expect(挑的理由(们, new Set(), true, "a", true)).toContain("判无效补发");
  });
});

describe("判无效记待补", () => {
  it("不设配额（没设任何配额）：照样记 1 条待补，方向取那条分配记录；判无效那条照算、不退、不加配额", async () => {
    await prisma.entLeadQuota.create({ data: { userId: 甲.id, quota: 5, setById: 总管.id } });
    const L = await 分来又判死(甲);
    const 行 = await prisma.entLeadMakeup.findMany();
    expect(行).toMatchObject([{ userId: 甲.id, projectId: L, line: "内贸", usedAt: null, voidAt: null }]);
    expect(await prisma.entLeadAssign.count({ where: { projectId: L, counted: true } })).toBe(1);
    expect(await prisma.entLeadQuotaBonus.count()).toBe(0);
  });
  it("没占过名额（没有分配记录 / 不算数）不记；同条线索不重复记", async () => {
    const L = await 线索(await 客户(市场.id), 甲.id, 市场.id);
    await 分配行(L, 甲.id, { counted: false });
    expect((await 销售初判(身份(甲), L, "无效", { invalidReason: "联系方式无效" })).ok).toBe(true);
    expect((await 市场复核(身份(市场), L, false)).ok).toBe(true);
    expect(await 待补(甲)).toBe(0);
  });
  it("判无效结果通知负责人，带「已补名额，下一条自动分配优先给你」", async () => {
    const L = await 分来又判死(甲);
    await 验证待办通知({ id: 市场.id, name: 市场.name }, L);
    const n = await prisma.entNotice.findFirstOrThrow({ where: { userId: 甲.id, kind: "线索验证" } });
    expect(n.title).toContain("最终判了无效");
    expect(n.body).toContain("已补名额，下一条自动分配优先给你");
  });
});

describe("自动分配优先补", () => {
  /** 甲本月已经分到 2 条（算数），乙、丙 0 条：按现行该给乙 */
  const 甲多分 = async () => {
    for (let i = 0; i < 2; i++) await 分配行(await 线索(await 客户(市场.id), 甲.id, 市场.id, "线索推进"), 甲.id);
  };

  it("没待补：照现行给本月已分最少的（乙）", async () => {
    await 甲多分();
    const N = await 新线索();
    expect(await 以(市场, () => 自动分配线索(N, { 项目: true }))).toMatchObject({ ok: true, toUserId: 乙.id });
  });

  it("甲判无效有待补：下一条补发给甲（哪怕他本月已分最多），用掉待补、补发不算本月已分；再下一条回到乙", async () => {
    await 甲多分();
    await 分来又判死(甲);
    expect(await 待补(甲)).toBe(1);
    const N = await 新线索();
    const r = await 以(市场, () => 自动分配线索(N, { 项目: true }));
    expect(r).toMatchObject({ ok: true, toUserId: 甲.id });
    if (r.ok) expect(r.为什么).toContain("判无效补发");
    const 记 = await prisma.entLeadAssign.findFirstOrThrow({ where: { projectId: N } });
    expect(记.counted).toBe(false);
    expect(await prisma.entLeadMakeup.findFirstOrThrow()).toMatchObject({ usedAssignId: 记.id, usedProjectId: N });
    expect(await 待补(甲)).toBe(0);
    const N2 = await 新线索();
    expect(await 以(市场, () => 自动分配线索(N2, { 项目: true }))).toMatchObject({ ok: true, toUserId: 乙.id });
  });

  it("两人待补：按退名额时间先后（先判的先补）", async () => {
    await 分来又判死(丙);
    await new Promise((r) => setTimeout(r, 5));
    await 分来又判死(甲);
    const [N1, N2] = [await 新线索(), await 新线索()];
    const r = await 以(市场, () => 批量自动分配([N1, N2], { 项目: true }));
    expect(r.ok).toBe(true);
    expect([await 负责人(N1), await 负责人(N2)]).toEqual([丙.id, 甲.id]);
    expect(await 待补数们([甲.id, 丙.id])).toEqual(new Map());
  });

  it("有待补但这次暂停：跳过他、待补留着；恢复参与后下一条给他", async () => {
    await 甲多分();
    await 分来又判死(甲);
    await setSetting(自动分配不参与key, { [总管.id]: "禁止", [市场.id]: "禁止", [甲.id]: "暂停" });
    invalidateSettingsCache();
    const N = await 新线索();
    expect(await 以(市场, () => 自动分配线索(N, { 项目: true }))).toMatchObject({ ok: true, toUserId: 乙.id });
    expect(await 待补(甲)).toBe(1);
    await setSetting(自动分配不参与key, { [总管.id]: "禁止", [市场.id]: "禁止" });
    invalidateSettingsCache();
    const N2 = await 新线索();
    expect(await 以(市场, () => 自动分配线索(N2, { 项目: true }))).toMatchObject({ ok: true, toUserId: 甲.id });
  });

  it("方向对不上（外贸的待补）不优先给内贸线索", async () => {
    await 甲多分();
    await 分来又判死(甲, { line: "外贸" });
    const N = await 新线索();
    expect(await 以(市场, () => 自动分配线索(N, { 项目: true }))).toMatchObject({ ok: true, toUserId: 乙.id });
    expect(await 待补(甲)).toBe(1);
  });

  it("市场直接指定给甲：不用待补", async () => {
    await 分来又判死(甲);
    const N = await 新线索();
    expect(await 以(市场, () => 分配线索({ projectId: N, toUserId: 甲.id }))).toMatchObject({ ok: true });
    expect(await 负责人(N)).toBe(甲.id);
    expect(await 待补(甲)).toBe(1);
  });

  it("撤销那次自动分配：用掉的待补退回", async () => {
    await 分来又判死(甲);
    const N = await 新线索();
    const r = await 以(市场, () => 自动分配线索(N, { 项目: true }));
    expect(r).toMatchObject({ ok: true, toUserId: 甲.id });
    expect(await 待补(甲)).toBe(0);
    if (!r.ok) return;
    expect(await 以(市场, () => 撤销自动分配(N, r.还原))).toMatchObject({ ok: true });
    expect(await 待补(甲)).toBe(1);
  });

  it("定时分配到点也走同一套挑人：有待补的先", async () => {
    await 甲多分();
    await 分来又判死(甲);
    const N = await 新线索();
    expect(await 定时分出去(定时分配令牌, 系统操作人, N, null, "到点分配")).toMatchObject({ ok: true });
    expect(await 负责人(N)).toBe(甲.id);
    expect(await 待补(甲)).toBe(0);
  });

  it("超时自动转不用待补（P-转-29 ②）：不优先、不消耗，接手人照算本月已分", async () => {
    // 乙本月已分 0、丙 1 条且有待补：超时转照现行给本月已分最少的乙
    const N = await 线索(await 客户(市场.id), 甲.id, 市场.id, "线索推进");
    await 分配行(N, 甲.id);
    await 分配行(await 线索(await 客户(市场.id), 丙.id, 市场.id, "线索推进"), 丙.id);
    await 分来又判死(丙);
    expect(await 待补(丙)).toBe(1);
    expect(await 超时转出(超时转令牌, 系统操作人, N, 甲.id, [甲.id], "超时未跟进自动转")).toMatchObject({ ok: true, 接手人Id: 乙.id });
    expect(await 待补(丙)).toBe(1);
    expect(await prisma.entLeadAssign.findFirstOrThrow({ where: { projectId: N, toUserId: 乙.id } })).toMatchObject({ counted: true });
    // 只剩丙可接（乙也超时过）：照样给丙，但不消耗他的待补、照算
    expect(await 超时转出(超时转令牌, 系统操作人, N, 乙.id, [甲.id, 乙.id], "超时未跟进自动转")).toMatchObject({ ok: true, 接手人Id: 丙.id });
    expect(await 待补(丙)).toBe(1);
    expect(await prisma.entLeadAssign.findFirstOrThrow({ where: { projectId: N, toUserId: 丙.id } })).toMatchObject({ counted: true });
  });
});

describe("用户 11-20 两种情形：补发不影响轮转", () => {
  /** 一轮 = 甲乙丙各一条；按顺序自动分 n 条新线索，回接手人 */
  const 分几条 = async (n: number) => {
    const 们: string[] = [];
    for (let i = 0; i < n; i++) {
      const N = await 新线索();
      const r = await 以(市场, () => 自动分配线索(N, { 项目: true }));
      expect(r.ok).toBe(true);
      们.push(await 负责人(N));
    }
    return 们;
  };
  const 名 = (id: string) => ({ [甲.id]: "甲", [乙.id]: "乙", [丙.id]: "丙" })[id] ?? id;

  it("A. 本轮已分过（判无效那条就在本轮）：只额外优先补 1 条，本轮不再多给", async () => {
    // 本轮：甲拿到第一条（判无效那条）
    const 第一 = await 分几条(1);
    expect(第一.map(名)).toEqual(["甲"]);
    const L = (await prisma.entLeadAssign.findFirstOrThrow({ where: { toUserId: 甲.id } })).projectId!;
    expect((await 销售初判(身份(甲), L, "无效", { invalidReason: "联系方式无效" })).ok).toBe(true);
    expect((await 市场复核(身份(市场), L, false)).ok).toBe(true);
    // 接下来 4 条：补发给甲 1 条，然后乙、丙补齐本轮，再下一轮从甲开始
    expect((await 分几条(4)).map(名)).toEqual(["甲", "乙", "丙", "甲"]);
    const 行 = await 以(总管, () => 本月分配情况());
    expect(行?.find((x) => x.userId === 甲.id)).toMatchObject({ 已分: 2, 另补: 1, 待补: 0 });
  });

  it("B. 判无效那条是更早轮次、本轮还没轮到他：先补 1 条，本轮正常轮到他照常给", async () => {
    // 第一轮甲乙丙各 1 条；第二轮甲、乙已拿到，丙还没轮到（本月已分 甲 2、乙 2、丙 1）
    expect((await 分几条(5)).map(名)).toEqual(["甲", "乙", "丙", "甲", "乙"]);
    // 丙判无效他第一轮那条
    const 丙那条 = (await prisma.entLeadAssign.findFirstOrThrow({ where: { toUserId: 丙.id } })).projectId!;
    expect((await 销售初判(身份(丙), 丙那条, "无效", { invalidReason: "联系方式无效" })).ok).toBe(true);
    expect((await 市场复核(身份(市场), 丙那条, false)).ok).toBe(true);
    // 下一条补发给丙；再下一条本轮正常轮到丙（他还是最少的 1 条），照常给；然后新一轮甲、乙
    expect((await 分几条(4)).map(名)).toEqual(["丙", "丙", "甲", "乙"]);
    const 行 = await 以(总管, () => 本月分配情况());
    expect(行?.find((x) => x.userId === 丙.id)).toMatchObject({ 已分: 2, 另补: 1, 待补: 0 });
  });

  it("每次判无效只补 1 条；补发来的又判无效，再补 1 条", async () => {
    await 分来又判死(甲);
    expect(await 待补(甲)).toBe(1);
    const N = await 新线索();
    expect(await 以(市场, () => 自动分配线索(N, { 项目: true }))).toMatchObject({ ok: true, toUserId: 甲.id });
    expect(await 待补(甲)).toBe(0);
    // 补发来的那条进线索验证（市场分给销售），判无效 → 再记 1 个
    await prisma.project.update({ where: { id: N }, data: { node: "线索验证" } });
    expect((await 销售初判(身份(甲), N, "无效", { invalidReason: "联系方式无效" })).ok).toBe(true);
    expect((await 市场复核(身份(市场), N, false)).ok).toBe(true);
    expect(await 待补(甲)).toBe(1);
  });
});

describe("看得到", () => {
  it("本月分配情况带待补；前面约几条 = 下一条、带待补", async () => {
    await 分来又判死(甲);
    const 行 = await 以(总管, () => 本月分配情况());
    expect(行?.find((x) => x.userId === 甲.id)).toMatchObject({ 待补: 1 });
    expect(行?.find((x) => x.userId === 乙.id)).toMatchObject({ 待补: 0 });
    const 估 = await 估算轮到(await 读组织());
    expect(估.get(甲.id)).toEqual({ 数: 0, 待补: 1 });
  });
});

describe("恢复判无效的线索：没用掉的待补作废", () => {
  it("作废补位只动这条线索上没用的；改节点把线索流失清掉时调（现在业务上改不回，见 ent-lead-verify-quota）", async () => {
    const L = await 分来又判死(甲);
    expect(await 作废补位(prisma, L)).toBe(1);
    expect(await 待补(甲)).toBe(0);
    // 改不回：改节点被拒，待补不受影响
    const L2 = await 分来又判死(甲);
    expect((await 改节点(身份(总管), L2, { phase: "线索", node: "线索验证" })).ok).toBe(false);
    expect(await 待补(甲)).toBe(1);
  });
});

describe("各自动分配入口都走同一套挑人（读挑人底子 + 挑接手人），事务里复核带上重读的待补", () => {
  it("调 挑接手人 的地方都在复核里重读待用补位、写分配记录后用掉补位", () => {
    const 读 = (f: string) => fs.readFileSync(path.resolve(__dirname, "..", f), "utf8");
    for (const f of ["src/app/(app)/leads/assign-actions.ts", "src/app/(app)/customers/pool-actions.ts"]) {
      const s = 读(f);
      expect(s, f).toMatch(/本月分配行\([^)]*tx\), 底\.用补位 \? await 待用补位行\(/);
      expect(s, f).toContain("await 用掉补位(tx,");
    }
    // 别的文件不另写挑人：挑接手人 只在这两处和估算里调
    const 调的 = (读("src/lib/enterprise/assign-eta.ts").includes("前面几条(") && !读("src/lib/enterprise/assign-eta.ts").includes("挑接手人("));
    expect(调的).toBe(true);
  });
});
