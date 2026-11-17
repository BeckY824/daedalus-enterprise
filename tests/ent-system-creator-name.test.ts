/**
 * 创建人是「补建创建人」（system，补零项目客户的脚本补建的潜客培育项目）时显示「系统补建」，
 * 不是「（已删除的账号）」「已不在的成员」，也不是笼统的「系统」（25E）。
 * 同一个 id 在别的人字段（超时回收 / 定时分配的操作人、节点记录的操作人）上照旧显示「系统」。
 * 共用 lib/project/system-created.ts 的 人名显示：项目详情的创建人、AI 查询结果的人名列都走它。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { TOOLS } from "@/lib/agent/tools";
import { DEFAULT_BUSINESS } from "@/lib/business-config";
import { 人名显示, 补建创建人, 补建创建人名 } from "@/lib/project/system-created";

describe("人名显示", () => {
  const 名 = new Map([["u1", "王"]]);
  it("创建人列：补建的写「系统补建」；别的列写「系统」；真人照名字；查不到的用调用方给的说法", () => {
    expect(补建创建人名).toBe("系统补建");
    expect(人名显示(补建创建人, 名, { 创建人: true, 不在: "已不在的成员" })).toBe("系统补建");
    expect(人名显示(补建创建人, 名, { 不在: "已不在的成员" })).toBe("系统");
    expect(人名显示("u1", 名, { 创建人: true, 不在: "已不在的成员" })).toBe("王");
    expect(人名显示("gone", 名, { 创建人: true, 不在: "（已删除的账号）" })).toBe("（已删除的账号）");
  });

  it("项目详情的创建人走 人名显示（创建人: true），不再自己拼", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../src/app/(app)/projects/[id]/load.ts"), "utf8");
    expect(src).toMatch(/creatorName: 人名显示\(p\.creatorId, [^)]*创建人: true/);
  });
});

describe("AI query_records：人名列", () => {
  let 王: { id: string; name: string };
  let 补建项目: string;
  beforeEach(async () => {
    await resetDb();
    王 = await prisma.user.create({ data: { email: "w@t", password: "x", name: "王", role: "ADMIN" } });
    const c = await prisma.customer.create({ data: { name: "甲公司", phone: "13900000001", salesOwnerId: 王.id } });
    补建项目 = (await prisma.project.create({ data: { customerId: c.id, name: "补建", phase: "线索", node: "潜客培育", ownerId: 王.id, creatorId: 补建创建人 } })).id;
    await prisma.project.create({ data: { customerId: c.id, name: "真线索", phase: "线索", ownerId: 王.id, creatorId: 王.id } });
    await prisma.projectNodeLog.create({ data: { projectId: 补建项目, userId: 补建创建人, kind: "pool-release", toPhase: "线索", toNode: "潜客培育" } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  const 跑 = (args: Record<string, unknown>) =>
    TOOLS.find((t) => t.name === "query_records")!.run(args, { userId: 王.id, userName: 王.name, b: { ...DEFAULT_BUSINESS, projectMode: true }, recordOffset: 0, proposals: [] } as never);

  it("项目明细：补建的创建人写「系统补建」，真人照名字", async () => {
    const r = await 跑({ 表: "项目", 条件: [], 取: 20 });
    const 行 = (r.data as { 结果: { 项目名称: string; 创建人: string }[] }).结果;
    expect(行.find((x) => x.项目名称 === "补建")!.创建人).toBe("系统补建");
    expect(行.find((x) => x.项目名称 === "真线索")!.创建人).toBe("王");
  });

  it("按创建人分组：补建的那组叫「系统补建」", async () => {
    const r = await 跑({ 表: "项目", 条件: [], 分组: "创建人" });
    expect((r.data as { 分组: { 创建人: string }[] }).分组.map((g) => g.创建人).sort()).toEqual(["王", "系统补建"].sort());
  });

  it("节点记录的操作人是 system（超时回收）：写「系统」，不是删掉的账号", async () => {
    const r = await 跑({ 表: "节点记录", 条件: [], 取: 20 });
    const 行 = (r.data as { 结果: { 操作人: string }[] }).结果;
    expect(行.map((x) => x.操作人)).toEqual(["系统"]);
  });
});
