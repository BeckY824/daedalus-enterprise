/**
 * 组员客户从项目成员出发（8.5 万客户提速第二轮，11-14）：lib/enterprise/visibility.ts 组员客户编号 挑出来的客户
 * = 原来那句 Customer WHERE 组员的客户（team-scope，EXISTS 项目 EXISTS 成员）挑出来的客户，逐人逐种情形对拍：
 * 点了同意 / 邀请着 / 拒了、项目进了回收站、客户进了回收站（底层客户端照算）、一位客户挂几个项目、几个人一起算、谁都不是组员。
 * 另钉查询计划：新写法从 ProjectMember 的 userId 索引出发，不扫客户表。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma, defaultClient } from "@/lib/prisma";
import { PrismaClient } from "@/generated/prisma";
import { resetDb } from "./reset";
import { 组员的客户 } from "@/lib/team-scope";
import { 组员客户编号 } from "@/lib/enterprise/visibility";

const 人们 = ["pm-a", "pm-b", "pm-c", "pm-none"];

beforeAll(async () => {
  delete process.env.CRM_ENTERPRISE;
  await resetDb();
  for (const id of [...人们, "pm-owner"]) await prisma.user.create({ data: { id, email: `${id}@x.com`, name: id, password: "x", role: "SALES" } });
  const 客户 = [] as string[];
  for (let i = 0; i < 8; i++) 客户.push((await prisma.customer.create({ data: { name: `客户${i}`, phone: `1380000${String(i).padStart(4, "0")}`, salesOwnerId: "pm-owner", deletedAt: i === 6 ? new Date() : null } })).id);
  const 项目 = async (k: number, 客: string, 删 = false) =>
    (await prisma.project.create({ data: { name: `项目${k}`, customerId: 客, ownerId: "pm-owner", creatorId: "pm-owner", deletedAt: 删 ? new Date() : null } })).id;
  // 客户0：a 同意；客户1：a 邀请着、b 拒了；客户2：两个项目，a 都同意（去重）；客户3：项目进了回收站，a 同意
  // 客户4：b 同意、c 同意；客户5：没人；客户6（回收站里）：c 同意；客户7：一个删了的项目 a 同意 + 一个没删的 b 同意
  const 成员 = async (p: string, userId: string, inviteStatus: string) => prisma.projectMember.create({ data: { projectId: p, userId, inviteStatus } });
  await 成员(await 项目(0, 客户[0]), "pm-a", "JOINED");
  const p1 = await 项目(1, 客户[1]);
  await 成员(p1, "pm-a", "INVITED");
  await 成员(p1, "pm-b", "DECLINED");
  await 成员(await 项目(2, 客户[2]), "pm-a", "JOINED");
  await 成员(await 项目(3, 客户[2]), "pm-a", "JOINED");
  await 成员(await 项目(4, 客户[3], true), "pm-a", "JOINED");
  const p5 = await 项目(5, 客户[4]);
  await 成员(p5, "pm-b", "JOINED");
  await 成员(p5, "pm-c", "JOINED");
  await 项目(6, 客户[5]);
  await 成员(await 项目(7, 客户[6]), "pm-c", "JOINED");
  await 成员(await 项目(8, 客户[7], true), "pm-a", "JOINED");
  await 成员(await 项目(9, 客户[7]), "pm-b", "JOINED");
});

afterAll(async () => {
  await resetDb();
});

describe("组员客户编号 = 原来的 组员的客户 条件", () => {
  const 组合 = [["pm-a"], ["pm-b"], ["pm-c"], ["pm-none"], ["pm-a", "pm-b"], ["pm-a", "pm-b", "pm-c"], ["pm-b", "pm-none"], []];

  it("逐人逐组合：集合一模一样（底层客户端，回收站里的客户照算，同原来）", async () => {
    for (const 组 of 组合) {
      const 旧 = 组.length ? (await defaultClient.customer.findMany({ where: 组员的客户({ in: 组 }), select: { id: true } })).map((c) => c.id).sort() : [];
      const 新 = (await 组员客户编号(defaultClient, 组)).sort();
      expect({ 组, 新 }).toEqual({ 组, 新: 旧 });
      // 去重：一位客户挂两个项目只出一次
      expect(new Set(新).size).toBe(新.length);
    }
    // 情形都覆盖到了：a 有客户0、客户2；c 有回收站里的客户6
    expect((await 组员客户编号(defaultClient, ["pm-a"])).length).toBe(2);
    expect((await 组员客户编号(defaultClient, ["pm-c"])).length).toBe(2);
    expect(await 组员客户编号(defaultClient, ["pm-none"])).toEqual([]);
  });

  it("查询计划：从 ProjectMember 的 userId 索引出发、按主键找项目，不扫客户表", async () => {
    type 句 = { query: string; params: string };
    const 截 = new PrismaClient({ datasourceUrl: `${process.env.DATABASE_URL}?connection_limit=1`, log: [{ emit: "event", level: "query" }] });
    const 句们: 句[] = [];
    (截 as unknown as { $on: (e: "query", f: (q: 句) => void) => void }).$on("query", (q) => 句们.push(q));
    try {
      await 组员客户编号(截, ["pm-a", "pm-b"]);
      const 主 = 句们.filter((q) => q.query.startsWith("SELECT"));
      expect(主.some((q) => q.query.includes("FROM `main`.`Customer`"))).toBe(false);
      for (const q of 主) {
        const 计划 = (await prisma.$queryRawUnsafe<{ detail: string }[]>(`EXPLAIN QUERY PLAN ${q.query}`, ...JSON.parse(q.params))).map((r) => r.detail).join("\n");
        expect(计划).not.toMatch(/SCAN `?(Customer|ProjectMember)/);
      }
    } finally {
      await 截.$disconnect();
    }
  });
});
