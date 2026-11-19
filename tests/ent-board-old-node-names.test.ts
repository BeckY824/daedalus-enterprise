/**
 * 看板：库里存着改名前旧节点名的项目（企业版 10-31 改名，如「共识方案」→「方案敲定」）按新名归列。
 * 正式库副本里 64 个进行中的项目存的是「共识方案」，原来落进「痛点挖掘」列、卡片小字却写「方案敲定」。
 * 这里走真的 读项目列表（每列各自取数）和 读看板一列：列头的数（库里 groupBy 的组）、首屏卡片、「再看」都落在「方案敲定」。
 * 只改读的时候的归类，库里的旧名不动。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "a@x", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`REDIRECT:${u}`); }, notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 读项目列表, 读看板一列, 每列条数 } from "@/lib/project/list";
import { 看板分列, 卡片小字 } from "@/lib/project/board";
import { 字典of } from "@/lib/project/stage-dict";

let 销售: { id: string; name: string; role: string };
const 作为 = <T,>(fn: () => Promise<T>) => {
  mocks.user = { ...mocks.user, id: 销售.id, name: 销售.name, role: 销售.role };
  忘掉企业版范围();
  return 以谁的身份(销售.id, fn);
};
const 旧名ids = new Set<string>();

beforeAll(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  const id = (await prisma.user.create({ data: { email: "s@t", name: "销售", title: "", role: "SALES", password: "x" } })).id;
  await prisma.entMember.create({ data: { userId: id, bizRole: "sales" } });
  销售 = { id, name: "销售", role: "SALES" };
  await setSetting("business", { projectMode: true });
  invalidateSettingsCache();
  const 客户 = (await prisma.customer.create({ data: { name: "客户一", phone: "13930000001", salesOwnerId: id } })).id;
  const 建 = async (node: string, 个: number) => {
    for (let i = 0; i < 个; i++) {
      const p = await prisma.project.create({ data: { name: `${node}-${i}`, customerId: 客户, ownerId: id, creatorId: id, phase: "商机", node, amount: 10 } });
      if (node !== "方案敲定" && node !== "痛点挖掘") 旧名ids.add(p.id);
    }
  };
  // 旧名 共识方案 超过一列首屏（20）：大列分支也要走到；方案确认（10-31 当天上线版本存的）一并认
  await 建("共识方案", 每列条数 + 5);
  await 建("方案确认", 2);
  await 建("方案敲定", 3);
  await 建("痛点挖掘", 1);
});
afterAll(async () => { vi.unstubAllEnvs(); invalidateSettingsCache(); await prisma.$disconnect(); });

describe("看板按新名归列（库里存旧节点名）", () => {
  it("列头：方案敲定 = 旧名 + 新名，痛点挖掘只算自己的；首屏卡片 20 张、小字都写方案敲定", async () => {
    const d = await 作为(() => 读项目列表(销售, {}, undefined, { 每列: true, 要列表页: false }));
    const 列们 = 看板分列(d.行, 字典of(true), undefined, d.看板合计, d.每列);
    const 列 = (k: string) => 列们.find((c) => c.列 === k)!;
    expect(列("方案敲定").数).toBe(每列条数 + 5 + 2 + 3);
    expect(列("方案敲定").合计).toEqual([{ 币种: "CNY", 合计: (每列条数 + 10) * 10 }]);
    expect(列("方案敲定").行).toHaveLength(每列条数);
    expect(列("痛点挖掘").数).toBe(1);
    expect(列("痛点挖掘").行).toHaveLength(1);
    for (const r of 列("方案敲定").行) expect(卡片小字(r, 字典of(true))).toBe("方案敲定");
  });

  it("「再看」方案敲定列：接着取剩下的，旧名的一个不漏、不重；痛点挖掘列里没有旧名的", async () => {
    const 首 = await 作为(() => 读看板一列(销售, {}, "方案敲定", 0, 100));
    expect(首?.总).toBe(每列条数 + 10);
    expect(new Set(首!.行.map((r) => r.id)).size).toBe(每列条数 + 10);
    for (const id of 旧名ids) expect(首!.行.map((r) => r.id)).toContain(id);
    const 二 = await 作为(() => 读看板一列(销售, {}, "方案敲定", 每列条数, 每列条数));
    expect(二!.行).toHaveLength(10);
    const 痛 = await 作为(() => 读看板一列(销售, {}, "痛点挖掘", 0, 100));
    expect(痛?.总).toBe(1);
    expect(痛!.行.some((r) => 旧名ids.has(r.id))).toBe(false);
  });

  it("库里的旧名不动（只改读的时候的归类）", async () => {
    expect(await prisma.project.count({ where: { node: "共识方案" } })).toBe(每列条数 + 5);
    expect(await prisma.project.count({ where: { node: "方案确认" } })).toBe(2);
  });
});
