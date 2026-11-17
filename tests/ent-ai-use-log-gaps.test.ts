/**
 * 批次 20d：名片整理、MCP、导入清洗原来不记 ai_use——设置页本月用量、操作日志里都看不到这三处调了 AI。
 *
 * 钉的是：和别的 AI 功能同一种记法（action=ai_use、entity=Ai、entityId=功能键、记在本人名下），
 * 每处一条；日志里只记行数 / 工具名 / 格数，不记名片文字、工具参数、格子原值（操作日志全员可读）。
 * 导入清洗只在真调了模型时记（模拟清洗、调用方自带的清洗器不记）。
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
const 假 = vi.hoisted(() => ({ 人: null as null | { accountId: string; 名字?: string } }));
vi.mock("@/lib/card-scan/server/auth", async (原) => ({
  ...(await 原<typeof import("@/lib/card-scan/server/auth")>()),
  认扫名片的人: async () => 假.人,
}));
vi.mock("@/lib/card-scan/server/ai-call", () => ({
  用哪个模型整理: async () => ({ baseUrl: "http://x", apiKey: "k", model: "m" }),
  AI整理名片: async () => null,
}));
vi.mock("@/lib/llm", async (原) => ({
  ...(await 原<typeof import("@/lib/llm")>()),
  chatMessagesJSON: async () => ({ 格式: { 金额: { 约5万: "50000" } } }),
}));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { AI_FEATURES, aiUsageThisMonth } from "@/lib/ai-usage";
import { 处理 } from "@/lib/mcp/rpc";
import { AI补清洗, AI清洗, 模拟清洗 } from "@/lib/enterprise-import/ai-clean";
import { POST as 名片整理 } from "@/app/api/mobile/scan/ai/route";
import type { 映射, 原始记录 } from "@/lib/enterprise-import/types";

const 用量 = (功能: string) => prisma.auditLog.findMany({ where: { action: "ai_use", entity: "Ai", entityId: 功能 } });
let 我: { id: string; name: string };

beforeEach(async () => {
  await resetDb();
  const u = await prisma.user.create({ data: { email: "me", name: "甲", title: "", role: "SALES", password: "x" } });
  我 = { id: u.id, name: u.name };
});
afterAll(async () => { await prisma.$disconnect(); });

it("三个功能键都登记了，设置页本月用量会列出来", async () => {
  expect(AI_FEATURES).toMatchObject({ card: "名片整理", mcp: "MCP 查询", importClean: "导入清洗" });
  const 列 = (await aiUsageThisMonth()).map((x) => x.feature);
  expect(列).toEqual(expect.arrayContaining(["card", "mcp", "importClean"]));
});

describe("名片整理", () => {
  const 请求 = () =>
    new Request("http://x/api/mobile/scan/ai", { method: "POST", body: JSON.stringify({ 行们: [{ text: "杭州甲乙机械 王建国" }, { text: "13800138000" }], 行业们: [] }) });

  it("企业版：整理一次记一条 ai_use，在本人名下，不记名片文字", async () => {
    假.人 = { accountId: 我.id, 名字: 我.name };
    const r = await 名片整理(请求());
    expect(r.status).toBe(200);
    const 行 = await 用量("card");
    expect(行).toHaveLength(1);
    expect(行[0]).toMatchObject({ userId: 我.id, userName: "甲" });
    expect(行[0].summary).toContain("2 行");
    expect(行[0].summary).not.toContain("王建国");
    expect(行[0].summary).not.toContain("13800138000");
  });

  it("托管版的云端账号（不带名字）不往这个库记", async () => {
    假.人 = { accountId: "cloud-acc" };
    await 名片整理(请求());
    expect(await 用量("card")).toHaveLength(0);
  });
});

describe("MCP", () => {
  it("每次 tools/call 记一条，只记工具名；出错的也记", async () => {
    await 处理({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_customers", arguments: { query: "王建国" } } }, 我, "t");
    await 处理({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "没有这个工具", arguments: {} } }, 我, "t");
    const 行 = await 用量("mcp");
    expect(行.map((r) => r.summary).sort()).toEqual(["MCP 调用：search_customers", "MCP 调用：没有这个工具（出错）"]);
    expect(行.every((r) => r.userId === 我.id)).toBe(true);
    expect(JSON.stringify(行)).not.toContain("王建国");
  });

  it("tools/list、ping 不记", async () => {
    await 处理({ jsonrpc: "2.0", id: 1, method: "tools/list" }, 我, "t");
    await 处理({ jsonrpc: "2.0", id: 2, method: "ping" }, 我, "t");
    expect(await 用量("mcp")).toHaveLength(0);
  });
});

describe("导入清洗", () => {
  const 映射样 = (): 映射 => ({
    列: { opportunity: { 外部: "id", 客户ID: "customerRef", 名称: "name", 金额: "amount" } },
    负责人: {},
    值: { 阶段: {}, 线索状态: {}, 跟进类型: {}, 跟进状态: {} },
    默认负责人Id: "",
  }) as never;
  const 记录 = (): 原始记录[] => [{ 实体: "opportunity", 外部ID: "O1", 字段: { 外部: "O1", 客户ID: "C1", 名称: "单子", 金额: "约5万" }, 行号: 2, 出处: "t.xlsx" }];

  it("真调了模型：记一条，只记格数", async () => {
    const r = await AI补清洗(记录(), 映射样(), AI清洗, 我);
    expect(r.补了).toBe(1);
    const 行 = await 用量("importClean");
    expect(行).toHaveLength(1);
    expect(行[0].summary).toBe("导入清洗：问了 1 格，补认 1 格");
    expect(行[0].summary).not.toContain("约5万");
  });

  it("模拟清洗 / 没给人：不记", async () => {
    await AI补清洗(记录(), 映射样(), 模拟清洗, 我);
    await AI补清洗(记录(), 映射样(), AI清洗);
    expect(await 用量("importClean")).toHaveLength(0);
  });
});
