/**
 * 企业版只用项目时 get_customer 带上这位客户名下的项目（10-28，lib/agent/tools.ts）。
 * 钉的是：最近动过的排前面、最多 10 个、多出来的给一句说明；每个项目只带 id / 名称 / 阶段 / 节点 / 结局 / 下一步（文字）/ 下一步时间 / 负责人；
 * 在公海的负责人写「在公海」；不是企业版 → 没有「项目」这个键；看不到这位客户的人拿不到客户，项目也带不出来。
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
let 老板: 人, 经理: 人, 乙: 人, 丙: 人;
let 序 = 0;

async function 造人(email: string, name: string, role: string): Promise<人> {
  const u = await prisma.user.create({ data: { email, name, title: "", role, password: "x" } });
  return { id: u.id, name: u.name };
}
async function 客户(ownerId: string, name = `客户${++序}`) {
  return (await prisma.customer.create({ data: { name, phone: `1390000${String(++序).padStart(4, "0")}`, salesOwnerId: ownerId } })).id;
}
async function 项目(ownerId: string, customerId: string, 补: Record<string, unknown> = {}) {
  return prisma.project.create({ data: { name: `项目${++序}`, customerId, ownerId, creatorId: ownerId, phase: "商机", node: "明确需求", ...补 } });
}
const 读客户 = (id: string, me: 人, projectMode = true) =>
  TOOLS.find((t) => t.name === "get_customer")!.run({ id }, { userId: me.id, userName: me.name, b: { ...DEFAULT_BUSINESS, projectMode }, recordOffset: 0, proposals: [] } as never);
type 行 = { id: string; 名称: string; 阶段: string; 节点: string; 结局: string; 下一步: string | null; 下一步时间: string | null; 负责人: string };
const 项目们 = (r: { data?: unknown }) => (r.data as { 项目?: 行[] }).项目;

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  老板 = await 造人("boss", "老板", "ADMIN");
  经理 = await 造人("mkt", "经理", "MANAGER");
  乙 = await 造人("yi", "乙", "SALES");
  丙 = await 造人("bing", "丙", "SALES");
  await setSetting("business", { projectMode: true });
  invalidateSettingsCache();
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("get_customer 带项目", () => {
  it("字段齐、结局 / 下一步时间 / 在公海的负责人照 list_projects 的写法", async () => {
    const c = await 客户(乙.id);
    const 下一步 = dayjs().add(3, "day").startOf("day").toDate();
    const 推 = await 项目(乙.id, c, { nextStepAt: 下一步, nextStepText: "发报价单", updatedAt: dayjs().subtract(3, "minute").toDate() });
    const 丢 = await 项目(乙.id, c, { phase: "线索", node: "潜客培育", result: "线索流失", updatedAt: dayjs().subtract(2, "minute").toDate() });
    const 海 = await 项目(乙.id, c, { pooledAt: new Date(), updatedAt: dayjs().subtract(1, "minute").toDate() });

    const r = await 读客户(c, 老板);
    expect(r.summary).toContain("3 个项目");
    const 列 = 项目们(r)!;
    expect(列.map((p) => p.id)).toEqual([海.id, 丢.id, 推.id]);
    expect(列[2]).toEqual({ id: 推.id, 名称: 推.name, 阶段: "商机", 节点: "明确需求", 结局: "进行中", 下一步: "发报价单", 下一步时间: dayjs(下一步).format("YYYY-MM-DD"), 负责人: "乙" });
    expect(列[1]).toMatchObject({ 阶段: "线索", 节点: "潜客培育", 结局: "线索流失", 下一步时间: null, 负责人: "乙" });
    expect(列[0].负责人).toBe("在公海");
    expect((r.data as Record<string, unknown>).项目说明).toBeUndefined();
  });

  it("最多 10 个，最近动过的排前面；多出来的给一句说明", async () => {
    const c = await 客户(乙.id);
    const 建的: string[] = [];
    for (let i = 0; i < 12; i++) 建的.push((await 项目(乙.id, c, { updatedAt: dayjs().subtract(60 - i, "minute").toDate() })).id);

    const r = await 读客户(c, 老板);
    const 列 = 项目们(r)!;
    expect(列).toHaveLength(10);
    expect(列.map((p) => p.id)).toEqual(建的.slice(2).reverse());
    expect((r.data as Record<string, unknown>).项目说明).toContain("list_projects");
    expect(r.summary).toContain("10+ 个项目");
  });

  it("没有项目：项目是空数组，摘要里不提", async () => {
    const c = await 客户(乙.id);
    const r = await 读客户(c, 老板);
    expect(项目们(r)).toEqual([]);
    expect(r.summary).not.toContain("项目");
  });

  it("不是企业版：没有「项目」这个键", async () => {
    const c = await 客户(乙.id);
    await 项目(乙.id, c);
    vi.unstubAllEnvs();
    const r = await 读客户(c, 老板, false);
    expect(r.data as Record<string, unknown>).not.toHaveProperty("项目");
    expect(r.summary).not.toContain("项目");
  });

  it("看得到哪些走限定层：业务员看不到同事的客户，就拿不到它的项目", async () => {
    await setSetting(规则.按组织看客户.key, true);
    await prisma.entMember.createMany({ data: [{ userId: 经理.id, bizRole: "sales_mgr" }, { userId: 乙.id, managerId: 经理.id }, { userId: 丙.id, managerId: 经理.id }] });
    invalidateSettingsCache();
    忘掉企业版范围();
    const c = await 客户(丙.id);
    const p = await 项目(丙.id, c);

    const 乙看 = await 以谁的身份(乙.id, () => 读客户(c, 乙));
    expect(JSON.stringify(乙看)).not.toContain(p.id);
    expect(乙看.data).not.toHaveProperty("项目");

    const 丙看 = await 以谁的身份(丙.id, () => 读客户(c, 丙));
    expect(项目们(丙看)!.map((x) => x.id)).toEqual([p.id]);
  });
});
