/**
 * 线索最终判无效补名额（11-09，M-线索-02 + 决定二）：没占过额度的判无效不补。
 * 占过额度 = 现负责人在这条线索上有算数的分配记录。批量分配时随客户走的那几条不写分配记录、不占额度，判无效也不补。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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
import { 批量自动分配 } from "@/app/(app)/leads/assign-actions";
import { 自动分配不参与key, 不设配额key, 本月加额, 配额of, 月份 } from "@/lib/enterprise/lead-assign";
import { 销售初判, 市场复核, 销售终验, 总管理终判 } from "@/lib/project/lead-verify";
import { 改节点 } from "@/lib/project/db";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
let 总管: 人;
let 市场: 人;
let 甲: 人;
let 乙: 人;

const 造人 = async (key: string, role: string, bizRole: string): Promise<人> => {
  const u = await prisma.user.create({ data: { email: `${key}@x`, name: key, title: "", role, password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, ...(bizRole === "sales" ? { line: "内贸" } : {}) } });
  return { id: u.id, name: key, email: `${key}@x`, role, title: "", avatar: null };
};
const 以 = <T,>(u: 人, fn: () => Promise<T>): Promise<T> => { mocks.user = { ...u }; return 以谁的身份(u.id, fn); };
let 序 = 0;
const 客户 = async (ownerId: string) => {
  序 += 1;
  return (await prisma.customer.create({ data: { name: `客户${序}`, phone: `139${String(序).padStart(8, "0")}`, salesOwnerId: ownerId } })).id;
};
const 线索 = async (customerId: string, ownerId: string, creatorId = ownerId) => {
  序 += 1;
  return (await prisma.project.create({ data: { name: `线索${序}`, customerId, ownerId, creatorId, node: "线索验证" } })).id;
};
const 分配行 = (projectId: string, toUserId: string, 补: { counted?: boolean; month?: string } = {}) =>
  prisma.entLeadAssign.create({ data: { projectId, toUserId, byUserId: 市场.id, month: 月份(), ...补 } });
const 设配额 = (u: 人, quota = 5) => prisma.entLeadQuota.create({ data: { userId: u.id, quota, setById: 总管.id } });
const 身份 = (u: 人) => ({ id: u.id, role: u.role });
const 项目of = (id: string) => prisma.project.findUniqueOrThrow({ where: { id } });

/** 销售判无效 → 市场复核判无效：线索流失 */
const 判死 = async (id: string, 谁 = 甲) => {
  expect((await 销售初判(身份(谁), id, "无效", { invalidReason: "联系方式无效", verifyNote: "打了三次" })).ok).toBe(true);
  expect((await 市场复核(身份(市场), id, false)).ok).toBe(true);
  expect((await 项目of(id)).result).toBe("线索流失");
};
/** 走到底：市场判有效 → 销售有异议 → 总管理判无效 */
const 终判死 = async (id: string, 谁 = 甲) => {
  expect((await 销售初判(身份(谁), id, "无效", { invalidReason: "联系方式无效", verifyNote: "打了三次" })).ok).toBe(true);
  expect((await 市场复核(身份(市场), id, true)).ok).toBe(true);
  expect((await 销售终验(身份(谁), id, false, "坚持")).ok).toBe(true);
  expect((await 总管理终判(身份(总管), id, false)).ok).toBe(true);
  expect((await 项目of(id)).result).toBe("线索流失");
};

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  总管 = await 造人("dir", "ADMIN", "director");
  市场 = await 造人("mkt", "SALES", "marketing_mgr");
  甲 = await 造人("jia", "SALES", "sales");
  乙 = await 造人("yi", "SALES", "sales");
  await setSetting(规则.按组织看客户.key, true);
  await setSetting(规则.线索分配.key, true);
  await setSetting(不设配额key, true);
  await setSetting(自动分配不参与key, [总管.id, 市场.id, 乙.id]); // 只留甲参与
  invalidateSettingsCache();
  忘掉企业版范围();
  await 设配额(甲);
});
afterEach(() => { vi.unstubAllEnvs(); invalidateSettingsCache(); });

describe("批量分配：同客户三条，第一条占额度，后两条随客户", () => {
  const 三条 = async () => {
    const C = await 客户(市场.id);
    const [L1, L2, L3] = [await 线索(C, 市场.id), await 线索(C, 市场.id), await 线索(C, 市场.id)];
    const r = await 以(市场, () => 批量自动分配([L1, L2, L3], { 项目: true }));
    expect(r.ok).toBe(true);
    // 前提：只有 L1 写了分配记录
    expect((await prisma.entLeadAssign.findMany({ select: { projectId: true } })).map((x) => x.projectId)).toEqual([L1]);
    for (const id of [L1, L2, L3]) expect((await 项目of(id)).ownerId).toBe(甲.id);
    return [L1, L2, L3];
  };

  it("三条都判无效：只补 1", async () => {
    const [L1, L2, L3] = await 三条();
    await 判死(L1); await 判死(L2); await 判死(L3);
    expect(await 本月加额(甲.id)).toBe(1);
    expect(await 配额of(甲.id)).toBe(6);
  });

  it("只判随客户那条：不补", async () => {
    const [, L2] = await 三条();
    await 判死(L2);
    expect(await 本月加额(甲.id)).toBe(0);
    expect(await 配额of(甲.id)).toBe(5);
  });

  it("只判占额度那条：补 1", async () => {
    const [L1] = await 三条();
    await 判死(L1);
    expect(await 本月加额(甲.id)).toBe(1);
  });

  it("走到总管理终判也一样：随客户那条不补，占额度那条补 1", async () => {
    const [L1, L2] = await 三条();
    await 终判死(L2);
    expect(await 本月加额(甲.id)).toBe(0);
    await 终判死(L1);
    expect(await 本月加额(甲.id)).toBe(1);
  });
});

describe("别的情况", () => {
  it("普通分配（一个客户一条）：照旧补 1", async () => {
    const L = await 线索(await 客户(市场.id), 市场.id);
    await 以(市场, () => 批量自动分配([L], { 项目: true }));
    expect(await prisma.entLeadAssign.count({ where: { projectId: L, toUserId: 甲.id, counted: true } })).toBe(1);
    await 判死(L);
    expect(await 本月加额(甲.id)).toBe(1);
  });

  it("分配记录不算数（企划线索 counted=false）：没占额度，不补", async () => {
    const L = await 线索(await 客户(市场.id), 甲.id, 市场.id);
    await 分配行(L, 甲.id, { counted: false });
    await 判死(L);
    expect(await 本月加额(甲.id)).toBe(0);
  });

  it("没有分配记录（老数据、手工建、导入）：不补", async () => {
    const L = await 线索(await 客户(市场.id), 甲.id, 市场.id);
    await 判死(L);
    expect((await 项目of(L)).result).toBe("线索流失");
    expect(await 本月加额(甲.id)).toBe(0);
  });

  it("转让过：占额度的是前任，现负责人没占过，谁都不补", async () => {
    await 设配额(乙);
    const L = await 线索(await 客户(市场.id), 乙.id, 市场.id);
    await 分配行(L, 甲.id);
    await 判死(L, 乙);
    expect(await 本月加额(乙.id)).toBe(0);
    expect(await 本月加额(甲.id)).toBe(0);
  });

  it("分给甲、转走又分回甲（两行记录）：判一次只补 1", async () => {
    const L = await 线索(await 客户(市场.id), 甲.id, 市场.id);
    await 分配行(L, 甲.id); await 分配行(L, 甲.id);
    await 判死(L);
    expect(await 本月加额(甲.id)).toBe(1);
  });

  it("上个月占的、这个月判：补在这个月这一格", async () => {
    const L = await 线索(await 客户(市场.id), 甲.id, 市场.id);
    await 分配行(L, 甲.id, { month: "2020-01" });
    await 判死(L);
    expect(await 本月加额(甲.id)).toBe(1);
    expect(await 本月加额(甲.id, "2020-01")).toBe(0);
  });

  it("占过额度但没设配额：照旧不加", async () => {
    const L = await 线索(await 客户(市场.id), 乙.id, 市场.id);
    await 分配行(L, 乙.id);
    await 判死(L, 乙);
    expect(await 本月加额(乙.id)).toBe(0);
    expect(await 配额of(乙.id)).toBeNull();
  });

  it("创建人是销售、初判即终判：占过额度也照旧不补", async () => {
    const L = await 线索(await 客户(甲.id), 甲.id, 乙.id);
    await 分配行(L, 甲.id);
    expect((await 销售初判(身份(甲), L, "无效", { invalidReason: "联系方式无效", verifyNote: "打了三次" })).ok).toBe(true);
    expect((await 项目of(L)).result).toBe("线索流失");
    expect(await 本月加额(甲.id)).toBe(0);
  });

  it("判无效没有撤销路径：改回进行中被拒、再判作废，名额不会补第二次", async () => {
    const L = await 线索(await 客户(市场.id), 甲.id, 市场.id);
    await 分配行(L, 甲.id);
    await 判死(L);
    expect(await 本月加额(甲.id)).toBe(1);
    for (const 谁 of [甲, 总管]) expect((await 改节点(身份(谁), L, { phase: "线索", node: "线索验证" })).ok).toBe(false);
    expect((await 项目of(L)).result).toBe("线索流失");
    expect((await 市场复核(身份(市场), L, false)).ok).toBe(false);
    expect((await 销售初判(身份(甲), L, "无效", { invalidReason: "联系方式无效", verifyNote: "再判" })).ok).toBe(false);
    expect(await 本月加额(甲.id)).toBe(1);
  });
});
