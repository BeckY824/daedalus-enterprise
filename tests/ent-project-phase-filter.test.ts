/**
 * 项目列表按阶段、进程筛（10-30，lib/project/list.ts 阶段进程条件）：
 *   - 阶段：没结局的按库里 phase，有结局的按结局认（线索流失归线索、丢单归商机、成功交付 / 异常状态归订单）
 *   - 进程：选节点 = 停在这个节点、没结局的；选结局 = 这个结局的
 *   - 乱传当没筛；filters 里回认出的值
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "boss@local", role: "ADMIN", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 读项目列表, 读名单项目 } from "@/lib/project/list";
import { 看板分列 } from "@/lib/project/board";
import { 字典of } from "@/lib/project/nodes";

let 老板: { id: string; name: string; role: string };

beforeEach(async () => {
  await resetDb();
  const u = await prisma.user.create({ data: { email: "boss", name: "老板", title: "", role: "ADMIN", password: "x" } });
  老板 = { id: u.id, name: u.name, role: "ADMIN" };
  mocks.user = { ...mocks.user, id: u.id };
  const c = await prisma.customer.create({ data: { name: "客户甲", phone: "13900000001", salesOwnerId: u.id } });
  const 项 = [
    ["培育", "线索", "潜客培育", null],
    ["验证", "线索", "线索验证", null],
    ["流失", "线索", "潜客培育", "线索流失"],
    ["需求", "商机", "明确需求", null],
    ["丢", "商机", "成交推进", "丢单"],
    ["备货", "订单", "生产备货", null],
    // 库里 phase 停在订单前一步、结局是成功交付：按结局算订单
    ["交付", "订单", "尾款结算", "成功交付"],
  ] as const;
  for (const [名, phase, node, result] of 项) {
    await prisma.project.create({ data: { name: `项目${名}`, customerId: c.id, ownerId: u.id, creatorId: u.id, phase, node, result } });
  }
  vi.stubEnv("CRM_ENTERPRISE", "1");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => prisma.$disconnect());

const 名们 = async (sp: { phase?: string; node?: string }, 只看阶段?: "线索") =>
  (await 读项目列表(老板, sp, 只看阶段)).行.map((r) => r.name.replace("项目", "")).sort();

describe("公海项目只在 /pool（11-02）", () => {
  const 进公海 = async () => {
    const c = await prisma.customer.findFirstOrThrow();
    await prisma.project.create({ data: { name: "项目公海", customerId: c.id, ownerId: "", creatorId: 老板.id, phase: "线索", node: "潜客培育", pooledAt: new Date() } });
  };

  it("企业版默认列表、看板、新线索页都不列公海项目，取到上限也只数列出来的；pool=1 只列公海", async () => {
    await 进公海();
    expect(await 名们({})).not.toContain("公海");
    expect(await 名们({}, "线索")).not.toContain("公海");
    expect(await 名们({ phase: "线索" })).not.toContain("公海");
    const d = await 读项目列表(老板, {});
    expect(d.行.length).toBe(7);
    expect(d.取到上限).toBe(false);
    expect(看板分列(d.行).flatMap((c) => c.行).map((r) => r.name)).not.toContain("项目公海");
    expect((await 读项目列表(老板, { pool: "1" })).行.map((r) => r.name)).toEqual(["项目公海"]);
  });

  it("项目详情中栏名单和项目页同一个范围：不列公海项目", async () => {
    await 进公海();
    const r = await 读名单项目(老板, 字典of(true));
    expect(r.rows.map((x) => x.name)).not.toContain("项目公海");
    expect(r.rows.length).toBe(7);
  });

  it("没开企业版时不动：默认列表照旧带上公海项目，pool=1 照旧只列公海", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    const c = await prisma.customer.findFirstOrThrow();
    await prisma.project.create({ data: { name: "项目公海", customerId: c.id, ownerId: 老板.id, creatorId: 老板.id, phase: "线索", node: "潜客培育", pooledAt: new Date() } });
    expect((await 读项目列表(老板, {})).行.map((r) => r.name)).toContain("项目公海");
    expect((await 读项目列表(老板, { pool: "1" })).行.map((r) => r.name)).toEqual(["项目公海"]);
  });
});

describe("按阶段、进程筛", () => {
  it("阶段：有结局的按结局认", async () => {
    expect(await 名们({ phase: "线索" })).toEqual(["培育", "流失", "验证"].sort());
    expect(await 名们({ phase: "商机" })).toEqual(["丢", "需求"].sort());
    expect(await 名们({ phase: "订单" })).toEqual(["交付", "备货"].sort());
  });
  it("进程：节点只算没结局的，结局单独筛", async () => {
    expect(await 名们({ node: "潜客培育" })).toEqual(["培育"]);
    expect(await 名们({ node: "线索流失" })).toEqual(["流失"]);
    expect(await 名们({ phase: "商机", node: "丢单" })).toEqual(["丢"]);
    expect(await 名们({ phase: "订单", node: "成功交付" })).toEqual(["交付"]);
    // 企业版 10-31 改名：新名筛得出库里存旧名的
    expect(await 名们({ phase: "订单", node: "交付结清" })).toEqual(["交付"]);
    expect(await 名们({ node: "痛点挖掘" })).toEqual(["需求"]);
    // 阶段、进程对不上：空
    expect(await 名们({ phase: "订单", node: "潜客培育" })).toEqual([]);
  });
  it("新线索页（只看线索阶段）也能按进程筛", async () => {
    expect(await 名们({ node: "线索验证" }, "线索")).toEqual(["验证"]);
  });
  it("乱传当没筛，filters 只回认出的值", async () => {
    const r = await 读项目列表(老板, { phase: "瞎写", node: "也瞎写" });
    expect(r.行.length).toBe(7);
    expect(r.filters).toMatchObject({ phase: "", node: "" });
    expect((await 读项目列表(老板, { phase: "商机", node: "痛点挖掘" })).filters).toMatchObject({ phase: "商机", node: "痛点挖掘" });
    // 旧名（老链接）认成新名回给界面
    expect((await 读项目列表(老板, { phase: "商机", node: "明确需求" })).filters).toMatchObject({ phase: "商机", node: "痛点挖掘" });
    expect((await 读项目列表(老板, { node: "成功交付" })).filters).toMatchObject({ node: "交付结清" });
  });
});
