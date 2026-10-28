/**
 * 企业版只用项目时，MCP 也不开老表的列表工具（10-28，lib/mcp/tools.ts）：和应用里的 agent 同一张排除表（agent/run.ts）。
 * 钉的是：tools/list 不列 list_leads / list_opportunities / list_contracts / list_orders，list_projects 照列；
 * tools/call 点名调也拒；不是企业版照旧都在（企业版的 projectMode 读出来就锁成开着，见 business-config.ts 企业版锁定）。
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 处理 } from "@/lib/mcp/rpc";
import { 跑工具 } from "@/lib/mcp/tools";

const 老表 = ["list_leads", "list_opportunities", "list_contracts", "list_orders"];
let 老板: { id: string; name: string };

async function 列名() {
  const r = (await 处理({ jsonrpc: "2.0", id: 1, method: "tools/list" }, 老板, "test")) as { result: { tools: { name: string }[] } };
  return r.result.tools.map((t) => t.name);
}
async function 只用项目(on: boolean) {
  await setSetting("business", { projectMode: on });
  invalidateSettingsCache();
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  const u = await prisma.user.create({ data: { email: "boss", name: "老板", title: "", role: "ADMIN", password: "x" } });
  老板 = { id: u.id, name: u.name };
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); invalidateSettingsCache(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("MCP 只用项目", () => {
  it("只用项目：不列老表工具，list_projects 照列", async () => {
    await 只用项目(true);
    const 名 = await 列名();
    for (const n of 老表) expect(名).not.toContain(n);
    expect(名).toContain("list_projects");
    expect(名).toContain("get_customer");
  });

  it("只用项目：点名调老表工具也拒", async () => {
    await 只用项目(true);
    for (const n of 老表) await expect(跑工具(n, {}, 老板)).rejects.toThrow(`没有这个工具：${n}`);
  });

  it("不是企业版：projectMode 开着也不收", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    忘掉企业版范围();
    await 只用项目(true);
    const 名 = await 列名();
    for (const n of 老表) expect(名).toContain(n);
  });
});
