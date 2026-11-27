/**
 * 潜客培育计划撤销的四个补漏口子（E-396，F-056）：判 MQL 不合格自动建的计划（同项目 + autoBy = mql-nurture + 未完成）
 *   - 导入改已有项目：节点不动、只把结局改成线索流失（在潜客培育上结束）也撤；导入把负责人清空使项目进公海也撤，操作日志记导入的人
 *   - 删客户：名下项目跟着进回收站，一起撤
 *   - 客户整体退回公海（连带名下在推项目进公海）：撤
 *   - 离职放进公海：撤
 * 每条都断言：人手加的计划、已完成的自动计划、别的项目的自动计划不动。日期都用「现在」，不写死。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 改, 读现值 } from "@/lib/enterprise-import/apply";
import { 软删客户 } from "@/lib/enterprise/soft-delete";
import { 客户名下在推项目进公海 } from "@/lib/enterprise/pool-link";
import { 离职放进公海 } from "@/lib/offboard-move";
import { 看已删 } from "@/lib/enterprise/soft-delete-core";
import type { 停用分拣结果 } from "@/lib/offboard-db";

let 序号 = 0;
const 人 = async (key: string, name: string, role = "SALES") => {
  const u = await prisma.user.create({ data: { email: `${key}@x`, name, title: "", role, password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole: role === "ADMIN" ? "director" : "sales", ...(role === "ADMIN" ? {} : { line: "内贸" }) } });
  return u;
};
const 客户 = async (ownerId: string) => {
  序号 += 1;
  return (await prisma.customer.create({ data: { name: `客户${序号}`, phone: `139${String(序号).padStart(8, "0")}`, salesOwnerId: ownerId } })).id;
};
const 项目 = async (customerId: string, ownerId: string) => {
  序号 += 1;
  return (await prisma.project.create({ data: { name: `项目${序号}`, customerId, ownerId, creatorId: ownerId, phase: "线索", node: "潜客培育" } })).id;
};
const 计划 = (customerId: string, ownerId: string, projectId: string | null, subject: string, autoBy: string | null, done = false) =>
  prisma.followPlan.create({ data: { subject, plannedAt: new Date(), customerId, ownerId, projectId, autoBy, done } });
/** 一个项目上备齐四条：要撤的自动计划、人手加的、已完成的自动计划，外加别的项目的自动计划 */
async function 备计划(customerId: string, ownerId: string, projectId: string, 别项目: string) {
  await 计划(customerId, ownerId, projectId, "潜客培育：自动", "mql-nurture");
  await 计划(customerId, ownerId, projectId, "人手加的", null);
  await 计划(customerId, ownerId, projectId, "已完成的自动", "mql-nurture", true);
  await 计划(customerId, ownerId, 别项目, "别的项目的自动", "mql-nurture");
}
async function 剩下() {
  // 看已删：删客户后连带进回收站的客户名下的行，默认读不到
  return (await 看已删(() => prisma.followPlan.findMany({ select: { subject: true } }))).map((x) => x.subject).sort();
}
const 该留的 = ["人手加的", "已完成的自动", "别的项目的自动"].sort();
const 撤的日志 = () => prisma.auditLog.findMany({ where: { entity: "FollowPlan", action: "delete" } });

let 甲: { id: string; name: string };
let 导入的人: { id: string; name: string };

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  甲 = await 人("jia", "销售甲某");
  导入的人 = await 人("boss", "导入人某", "ADMIN");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("导入改已有项目", () => {
  const 导入改 = async (id: string, 改动: Record<string, string | number | null>) => {
    const 批 = { 批次Id: "b1", 补培育: false, 操作人: 导入的人.id };
    await prisma.$transaction(async (tx) => 改(tx, "opportunity", id, 改动, (await 读现值(tx, "opportunity", id))!, new Date().toISOString(), 批));
  };

  it("节点没变、只把结局改成线索流失（在潜客培育上结束）：自动计划撤，操作日志记导入的人，别的不动", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    const 别 = await 项目(c, 甲.id);
    await 备计划(c, 甲.id, p, 别);
    await 导入改(p, { status: "线索流失" });
    const 后 = await prisma.project.findUniqueOrThrow({ where: { id: p } });
    expect(后).toMatchObject({ node: "潜客培育", result: "线索流失" });
    expect(await 剩下()).toEqual(该留的);
    const 日志 = await 撤的日志();
    expect(日志).toHaveLength(1);
    expect(日志[0]).toMatchObject({ userId: 导入的人.id, userName: 导入的人.name });
  });

  it("导入把负责人清空使项目进公海：自动计划撤，操作日志记导入的人，别的不动", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    const 别 = await 项目(c, 甲.id);
    await 备计划(c, 甲.id, p, 别);
    await 导入改(p, { ownerId: null });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p } })).pooledAt).not.toBeNull();
    expect(await 剩下()).toEqual(该留的);
    const 日志 = await 撤的日志();
    expect(日志).toHaveLength(1);
    expect(日志[0]).toMatchObject({ userId: 导入的人.id });
  });
});

describe("删客户 / 退回公海 / 离职放进公海", () => {
  it("删客户：名下项目跟着进回收站，自动计划撤，别的不动", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    const 别客户 = await 客户(甲.id);
    const 别 = await 项目(别客户, 甲.id);
    await 备计划(c, 甲.id, p, 别);
    await prisma.$transaction((tx) => 软删客户(tx, [c], new Date(), 导入的人));
    expect((await 看已删(() => prisma.project.findFirstOrThrow({ where: { id: p }, select: { deletedAt: true } }))).deletedAt).not.toBeNull();
    expect(await 剩下()).toEqual(该留的);
    expect(await 撤的日志()).toHaveLength(1);
  });

  it("客户整体退回公海连带名下在推项目进公海：自动计划撤，别的不动", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    const 别客户 = await 客户(甲.id);
    const 别 = await 项目(别客户, 甲.id);
    await 备计划(c, 甲.id, p, 别);
    await prisma.$transaction((tx) => 客户名下在推项目进公海(tx, [{ id: c, salesOwnerId: 甲.id }], 导入的人.id, null, new Date()));
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p } })).pooledAt).not.toBeNull();
    expect(await 剩下()).toEqual(该留的);
    expect(await 撤的日志()).toHaveLength(1);
  });

  it("离职放进公海：他负责的项目进公海，自动计划撤，别的不动", async () => {
    const c = await 客户(甲.id);
    const p = await 项目(c, 甲.id);
    const 别客户 = await 客户(甲.id);
    const 别 = await 项目(别客户, 甲.id);
    await 备计划(c, 甲.id, p, 别);
    const 分 = { 进公海客户: [], 进公海项目: [p] } as unknown as 停用分拣结果;
    await prisma.$transaction((tx) => 离职放进公海(tx, 分, 导入的人.id));
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p } })).pooledAt).not.toBeNull();
    expect(await 剩下()).toEqual(该留的);
    expect(await 撤的日志()).toHaveLength(1);
  });
});
