/**
 * 首页 AI 读跟进按跟进可见条件过滤（P-看-12：客户负责人看不到同一客户下同事负责的项目，lib/agent/tools.ts）。
 * 钉的是：客户负责人甲经 get_customer / search_followups 读不到同事乙负责的项目上的沟通，条数、上次跟进不含它；
 * 实线上级（销售管理）、总管理、系统管理员读得到；不是企业版照旧全给。
 * 乙（只负责项目的人）这位客户不在他的客户限定范围里（「仅项目」块另走），首页 AI 本来就读不到这位客户的跟进，这里不钉。
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { dayjs } from "@/lib/utils";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { TOOLS } from "@/lib/agent/tools";
import { DEFAULT_BUSINESS } from "@/lib/business-config";

type 人 = { id: string; name: string };
let 老板: 人, 管理员: 人, 经理: 人, 甲: 人, 乙: 人;
let 客户: string, 甲的跟进: string, 乙的跟进: string, 不挂的: string;

async function 造人(email: string, name: string, role: string): Promise<人> {
  const u = await prisma.user.create({ data: { email, name, title: "", role, password: "x" } });
  return { id: u.id, name: u.name };
}
const 跑 = (name: string, args: Record<string, unknown>, me: 人, projectMode = true) =>
  TOOLS.find((t) => t.name === name)!.run(args, { userId: me.id, userName: me.name, b: { ...DEFAULT_BUSINESS, projectMode }, recordOffset: 0, proposals: [] } as never);
const 以 = <T,>(me: 人, fn: () => Promise<T>) => 以谁的身份(me.id, fn);
type 读 = { summary: string; data?: unknown; 上次跟进?: string };
const 编号们 = (r: 读) => JSON.stringify(r.data);
const 搜到 = (r: 读) => (r.data as { 记录: { 内容: string }[]; 总数: number });

async function 记(ownerId: string, content: string, 天前: number, projectId?: string) {
  const f = await prisma.followUp.create({ data: { customerId: 客户, ownerId, type: "PHONE", title: "", content, occurredAt: dayjs().subtract(天前, "day").toDate() } });
  if (projectId) await prisma.followUpProject.create({ data: { followUpId: f.id, projectId, node: "明确需求" } });
  return f.id;
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  老板 = await 造人("boss", "老板", "ADMIN");
  管理员 = await 造人("sys", "管理员", "ADMIN");
  经理 = await 造人("mgr", "经理", "MANAGER");
  甲 = await 造人("jia", "甲", "SALES");
  乙 = await 造人("yi", "乙", "SALES");
  await setSetting("business", { projectMode: true });
  await setSetting(规则.按组织看客户.key, true);
  await prisma.entMember.createMany({ data: [{ userId: 老板.id, bizRole: "director" }, { userId: 管理员.id, bizRole: "admin" }, { userId: 经理.id, bizRole: "sales_mgr" }, { userId: 甲.id, bizRole: "sales", managerId: 经理.id }, { userId: 乙.id, bizRole: "sales", managerId: 经理.id }] });
  invalidateSettingsCache();
  忘掉企业版范围();
  客户 = (await prisma.customer.create({ data: { name: "测试客户", phone: "13900001111", salesOwnerId: 甲.id } })).id;
  const 甲项目 = await prisma.project.create({ data: { name: "甲的项目", customerId: 客户, ownerId: 甲.id, creatorId: 甲.id, phase: "商机", node: "明确需求" } });
  const 乙项目 = await prisma.project.create({ data: { name: "乙的项目", customerId: 客户, ownerId: 乙.id, creatorId: 乙.id, phase: "商机", node: "明确需求" } });
  甲的跟进 = await 记(甲.id, "甲聊预算", 3, 甲项目.id);
  不挂的 = await 记(甲.id, "老跟进说过预算", 5);
  // 乙在自己项目上记的最新一条：甲看不到这个项目
  乙的跟进 = await 记(乙.id, "乙聊预算机密", 1, 乙项目.id);
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("首页 AI 读跟进按跟进可见条件", () => {
  it("客户负责人甲：get_customer 不带同事项目上的沟通，条数、上次跟进都不算它", async () => {
    const r = (await 以(甲, () => 跑("get_customer", { id: 客户 }, 甲))) as 读;
    expect(r.summary).toContain("2 条跟进");
    expect(编号们(r)).not.toContain("乙聊预算机密");
    expect(编号们(r)).toContain("甲聊预算");
    expect(r.上次跟进).toBe(dayjs().subtract(3, "day").format("YYYY-MM-DD"));
    expect((r as { records?: { id: string }[] }).records?.map((x) => x.id)).toEqual([甲的跟进, 不挂的]);
  });

  it("客户负责人甲：search_followups 搜不到、总数不含它", async () => {
    const r = 搜到((await 以(甲, () => 跑("search_followups", { keyword: "预算" }, 甲))) as 读);
    expect(r.总数).toBe(2);
    expect(r.记录.map((x) => x.内容)).toEqual(["甲聊预算", "老跟进说过预算"]);
  });

  it("实线上级（销售管理）、总管理、系统管理员读得到", async () => {
    for (const me of [经理, 老板, 管理员]) {
      const g = (await 以(me, () => 跑("get_customer", { id: 客户 }, me))) as 读;
      expect(g.summary).toContain("3 条跟进");
      expect(编号们(g)).toContain("乙聊预算机密");
      const s = 搜到((await 以(me, () => 跑("search_followups", { keyword: "预算" }, me))) as 读);
      expect(s.总数).toBe(3);
    }
  });

  it("不是企业版：照旧全给", async () => {
    vi.unstubAllEnvs();
    忘掉企业版范围();
    const g = (await 跑("get_customer", { id: 客户 }, 甲, false)) as 读;
    expect(g.summary).toContain("3 条跟进");
    const s = 搜到((await 跑("search_followups", { keyword: "预算" }, 甲, false)) as 读);
    expect(s.总数).toBe(3);
  });
});
