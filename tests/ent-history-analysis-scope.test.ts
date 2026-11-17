/**
 * 历史分析回填的项目（system-created.ts）在数据页以外的统计里也不算：
 *   渠道看板 / 渠道列表（渠道项目条件）、首页卡（本月新增、暂未跟进）、销售持有数（公海里的不算；被领走还在推的照算）
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 读渠道统计 } from "@/lib/enterprise/channel-stats-db";
import { 首页卡条件 } from "@/lib/project/home-cards";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 字典of } from "@/lib/project/stage-dict";
import { 持有数 } from "@/lib/project/db";
import { 公海名单候选 } from "@/lib/project/list";
import { 历史分析来源, 补建创建人 } from "@/lib/project/system-created";

let 王: { id: string }, 渠道: string, 客户: { id: string };

async function 回填(o: { phase: string; node: string; result?: string; pooledAt?: Date | null; ownerId?: string; createdAt?: Date; creatorId?: string }) {
  return prisma.project.create({
    data: { name: "历史", customerId: 客户.id, ownerId: "", creatorId: 补建创建人, source: 历史分析来源, pooledAt: new Date(), ...o },
  });
}

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  王 = await prisma.user.create({ data: { email: "w@t", password: "x", name: "王", role: "SALES" } });
  渠道 = (await prisma.channel.create({ data: { name: "展会|线下", channelOwnerId: 王.id } })).id;
  客户 = await prisma.customer.create({ data: { name: "老客户", phone: "13900000001", salesOwnerId: 王.id, channelId: 渠道 } });
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await prisma.$disconnect();
});

describe("渠道", () => {
  it("挂在有来源的客户名下的历史分析项目不进渠道统计；公海页渠道名单也不列", async () => {
    await prisma.project.create({ data: { customerId: 客户.id, name: "真线索", phase: "线索", ownerId: 王.id, creatorId: 王.id } });
    const 改前 = (await 读渠道统计([{ id: 渠道, createdAt: new Date("2026-10-01T00:00:00"), endDate: null }], new Date("2026-10-29T12:00:00")))[渠道];
    await 回填({ phase: "线索", node: "潜客培育", result: "线索流失" });
    await 回填({ phase: "商机", node: "共识方案", result: "丢单" });
    await 回填({ phase: "商机", node: "明确需求", pooledAt: null, ownerId: 王.id });
    const 改后 = (await 读渠道统计([{ id: 渠道, createdAt: new Date("2026-10-01T00:00:00"), endDate: null }], new Date("2026-10-29T12:00:00")))[渠道];
    expect(改后).toEqual(改前);
    expect(改后.关联项目).toBe(1);
    const 名单 = 公海名单候选({ channelId: 渠道 })!;
    expect(await prisma.project.count({ where: { AND: [名单, { pooledAt: { not: null } }] } })).toBe(0);
  });
});

describe("首页卡", () => {
  it("本月新增不算；被领走还在推、客户身上有过沟通的不算暂未跟进；正常项目照算", async () => {
    const 规则 = await 生效组织规则();
    const 字典 = 字典of(true);
    const 数 = (键: "month-new" | "no-follow") => prisma.project.count({ where: 首页卡条件(键, 规则, 字典) });
    await prisma.project.create({ data: { customerId: 客户.id, name: "真线索", phase: "线索", ownerId: 王.id, creatorId: 王.id } });
    expect(await 数("month-new")).toBe(1);
    expect(await 数("no-follow")).toBe(1);
    // 回填的 createdAt 是这个月（脚本按当年时间写，万一落在本月也不算），creatorId 不是 system 也按来源排
    await 回填({ phase: "线索", node: "潜客培育", pooledAt: null, ownerId: 王.id, createdAt: new Date(), creatorId: 王.id });
    await prisma.followUp.create({ data: { customerId: 客户.id, ownerId: 王.id, type: "CALL", title: "旧", content: "旧沟通" } });
    expect(await 数("month-new")).toBe(1);
    // 客户身上有沟通了：回填的那个不算没跟进；正常那个照旧只看挂在项目上的沟通
    expect(await 数("no-follow")).toBe(1);
  });
});

describe("持有数", () => {
  it("公海里的历史分析项目不算谁的持有；被领走还在推的算领的人的", async () => {
    await 回填({ phase: "线索", node: "潜客培育" });
    expect(await 持有数(prisma, 王.id)).toBe(0);
    await 回填({ phase: "线索", node: "潜客培育", pooledAt: null, ownerId: 王.id });
    await 回填({ phase: "线索", node: "潜客培育", pooledAt: null, ownerId: 王.id, result: "线索流失" });
    expect(await 持有数(prisma, 王.id)).toBe(1);
  });
});
