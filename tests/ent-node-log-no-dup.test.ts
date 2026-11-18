/**
 * 节点记录「潜客培育 > 潜客培育 > 线索验证」查因（审核 11-18 第 12 项）：市场成员只建客户、再转给销售。
 * 中间那行不是重复的节点变更，是换负责人的留痕（kind = transfer；schema.prisma ProjectNodeLog：后三种节点不变，from / to 节点照抄当时的）：
 *   客户层转让 = carry-over-db 带走一位 → 转让痕；线索列表指定 / 自动、客户转让框自动 = db.ts 记转让 → 转让痕。
 * 撤销自动分配、历史负责人、回避名单、我分出去的都读它，不能不写。这里钉住：改节点的行（kind = node）没有相邻重复，
 * 只有「建档 → 潜客培育」「潜客培育 → 线索验证」两行；换负责人另一行、节点照抄
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "a@x", role: "SALES", title: "", avatar: null } as { id: string; name: string; email: string; role: string; title: string; avatar: null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => mocks.user, requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 建档只建客户 } from "@/app/(app)/projects/actions";
import { assignSalesOwner } from "@/app/(app)/customers/actions";
import { 分配线索, 客户自动分配 } from "@/app/(app)/leads/assign-actions";
import { 以谁的身份 } from "@/lib/enterprise/visibility";
afterAll(() => prisma.$disconnect());
let 市场: string, 销售: string;
const 当 = (id: string) => { mocks.user = { ...mocks.user, id, name: id }; };
let 号 = 0;
const 入 = (owner: string) => { 号++; return {
  客户: { name: `客户${号}`, phone: `1390000${String(号).padStart(4, "0")}`, school: null, grade: null, major: null, followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null, salesOwnerId: owner, channelId: null, referrerCustomerId: null, touchpoint: "公司资源", 企业资料: { bizLine: "内贸" } },
  联系人: { name: "王经理", position: "采购", phone: "" },
  跟进: { type: "PHONE", content: "电话聊了需求", occurredAt: "2026-10-20 10:00", 节点: "潜客培育", 明确回复: false } }; };
beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb(); invalidateSettingsCache();
  const 人 = async (email: string, bizRole: string, line: string | null = null) => {
    const id = (await prisma.user.create({ data: { email, name: email, title: "", role: "SALES", password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: id, bizRole, line } }); return id; };
  市场 = await 人("mkt", "marketing_mgr"); 销售 = await 人("s1", "sales", "内贸");
  await setSetting(规则.线索分配.key, true); await setSetting(规则.按组织看客户.key, true);
  当(市场);
});
afterEach(() => { vi.unstubAllEnvs(); });
const 行们 = async (cid: string) => {
  const p = await prisma.project.findFirstOrThrow({ where: { customerId: cid } });
  return prisma.projectNodeLog.findMany({ where: { projectId: p.id }, orderBy: [{ at: "asc" }, { id: "asc" }] });
};
describe("市场只建客户、再交给销售：改节点的行不重复", () => {
  for (const 路 of ["客户层转让", "线索列表指定", "客户转让框自动", "建的时候就给销售"] as const) it(路, async () => {
    const r = await 建档只建客户(入(路 === "建的时候就给销售" ? 销售 : 市场) as never);
    if (!r.ok) throw new Error(JSON.stringify(r));
    const cid = r.customerId;
    const p = await prisma.project.findFirstOrThrow({ where: { customerId: cid } });
    if (路 === "客户层转让") expect(await 以谁的身份(市场, () => assignSalesOwner([cid], 销售))).toMatchObject({ ok: true, updated: 1 });
    if (路 === "线索列表指定") expect(await 以谁的身份(市场, () => 分配线索({ projectId: p.id, toUserId: 销售, line: "内贸" }))).toEqual({ ok: true });
    if (路 === "客户转让框自动") expect(await 以谁的身份(市场, () => 客户自动分配(cid, null))).toMatchObject({ ok: true, toUserId: 销售 });
    const 们 = await 行们(cid);
    const 改节点 = 们.filter((l) => l.kind === "node");
    expect(改节点.map((l) => [l.fromNode, l.toNode])).toEqual([[null, "潜客培育"], ["潜客培育", "线索验证"]]);
    // 相邻两行改节点的落到同一处 = 重复（节点记录去重.cjs 清的就是这种）：一条都不该有
    for (let i = 1; i < 们.length; i++) {
      const [前, 后] = [们[i - 1], 们[i]];
      if (前.kind === "node" && 后.kind === "node") expect([后.toPhase, 后.toNode, 后.toResult]).not.toEqual([前.toPhase, 前.toNode, 前.toResult]);
    }
    const 换人 = 们.filter((l) => l.kind !== "node");
    if (路 === "建的时候就给销售") expect(换人).toHaveLength(0);
    else expect(换人.map((l) => [l.kind, l.fromNode, l.toNode, l.fromOwnerId, l.toOwnerId])).toEqual([["transfer", "潜客培育", "潜客培育", 市场, 销售]]);
  });
});
