/**
 * 批次 20c：只读的人问 AI 照样拿到建议卡、点确认才报错（P-全局-04「只读管理员能问 AI，不能让 AI 写」）。
 *
 * 权限只认业务角色：只读管理员（admin）、销售教练（coach）、设了「只看某人」的、没设业务角色的——
 * 决策轮交给模型的工具表里一个 propose_* 都没有，系统提示词里也不教出卡、不给取值表，只说这个账号只能看；
 * 正常的销售照旧有出卡工具。不是企业版不受影响。
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";

const 记 = vi.hoisted(() => ({ 工具: [] as string[][], 系统: [] as string[], 出招: null as null | ((第: number) => unknown), 答: "好的" }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/llm", () => ({
  buildSystemPrompt: () => "系统提示",
  chatMessagesJSON: async () => ({ final: true }),
  chatTextStream: async (_m: unknown, _o: unknown, onToken: (t: string) => void) => {
    onToken(记.答);
    return 记.答;
  },
  chatTools: async (ms: { role: string; content: unknown }[], tools: { function: { name: string } }[]) => {
    记.工具.push(tools.map((t) => t.function.name));
    记.系统.push(String(ms[0]?.content ?? ""));
    return 记.出招?.(记.工具.length) ?? { text: "", toolCalls: [] };
  },
}));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { DEFAULT_BUSINESS } from "@/lib/business-config";

const b = { ...DEFAULT_BUSINESS, projectMode: true };

async function 造人(name: string, bizRole: string | null) {
  const u = await prisma.user.create({ data: { email: name, name, title: "", role: "SALES", password: "x" } });
  if (bizRole) await prisma.entMember.create({ data: { userId: u.id, bizRole } });
  return { id: u.id, name: u.name };
}

async function 问(user: { id: string; name: string }) {
  process.env.AGENT_INTENTS = "0";
  const { runAgent } = await import("@/lib/agent/run");
  return runAgent({ question: "帮我给王总记一笔跟进，今天聊了报价", user, b });
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("business", { projectMode: true });
  invalidateSettingsCache();
  记.工具 = [];
  记.系统 = [];
  记.出招 = null;
  记.答 = "好的";
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("只读的人不给出卡工具（20c）", () => {
  it.each([
    ["只读管理员", "admin", "管理员只能看"],
    ["销售教练", "coach", "销售教练只能看"],
    ["没设业务角色", null, "还没设业务角色"],
  ])("%s：工具表里没有 propose_*，提示词说只能看", async (_名, 角色, 话) => {
    const me = await 造人("甲", 角色);
    const r = await 问(me);
    expect(记.工具[0].length).toBeGreaterThan(0);
    expect(记.工具[0].filter((n) => n.startsWith("propose_"))).toEqual([]);
    expect(记.工具[0]).toContain("find_person");
    // HC-2b：要记 / 改 / 删时调 say_read_only，服务端带固定标记，界面统一说一句
    expect(记.工具[0]).toContain("say_read_only");
    expect(记.系统[0]).toContain("先调 say_read_only");
    expect(记.系统[0]).toContain("这个账号只能看、不能改任何数据");
    expect(记.系统[0]).toContain(话);
    expect(记.系统[0]).not.toContain("取值表（propose_*");
    expect(记.系统[0]).not.toContain("信息不全也要提");
    expect(r.proposals).toEqual([]);
    expect(r.写不了).toContain(话);
  });

  it("设了「只看某人」的也只能看", async () => {
    const 目标 = await 造人("乙", "sales");
    const me = await 造人("丙", "marketing_mgr");
    const { 只看某人键 } = await import("@/lib/enterprise/org-core");
    await setSetting(只看某人键, { [me.id]: 目标.id });
    invalidateSettingsCache();
    await 问(me);
    expect(记.工具[0].filter((n) => n.startsWith("propose_"))).toEqual([]);
    expect(记.系统[0]).toContain("只能看");
  });

  it("销售照旧有出卡工具和取值表", async () => {
    const me = await 造人("丁", "sales");
    const r = await 问(me);
    expect(记.工具[0]).toContain("propose_followup");
    expect(记.工具[0]).toContain("propose_project_followup");
    expect(记.系统[0]).toContain("取值表（propose_*");
    expect(记.系统[0]).not.toContain("这个账号只能看");
    expect(记.工具[0]).not.toContain("say_read_only");
    expect(r.写不了).toBeUndefined();
    expect(r.拒了写).toBeUndefined();
  });

  it("不是企业版不看业务角色", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "0");
    const me = await 造人("戊", null);
    await 问(me);
    expect(记.工具[0]).toContain("propose_followup");
  });
});

describe("只读被拒的固定标记（设计语言 HC-2b）", () => {
  it("模型调了 say_read_only：结果带 拒了写，没调就不带", async () => {
    const me = await 造人("己", "admin");
    记.出招 = (第) => (第 === 1 ? { text: "", toolCalls: [{ id: "x1", type: "function", function: { name: "say_read_only", arguments: "{}" } }] } : { text: "", toolCalls: [] });
    try {
      const r = await 问(me);
      expect(r.写不了).toContain("管理员只能看");
      expect(r.拒了写).toBe(true);
      expect(r.proposals).toEqual([]);
    } finally {
      记.出招 = null;
    }
    const r2 = await 问(me);
    expect(r2.拒了写).toBeUndefined();
  });

  it("兜底：模型没调 say_read_only，却想调写类工具（只读的人没有，被拒）——照样带 拒了写", async () => {
    const me = await 造人("庚", "coach");
    记.出招 = (第) => (第 === 1 ? { text: "", toolCalls: [{ id: "x2", type: "function", function: { name: "propose_followup", arguments: '{"customer":"王总","content":"聊了报价","reason":"记一笔"}' } }] } : { text: "", toolCalls: [] });
    const r = await 问(me);
    expect(r.拒了写).toBe(true);
    expect(r.proposals).toEqual([]);
  });

  it("兜底：模型没调 say_read_only，回答里却说「已经帮你记下了」——照样带 拒了写；说「要找同事改」不算", async () => {
    const me = await 造人("辛", "admin");
    记.答 = "好的，已经帮你记下了这条跟进。";
    expect((await 问(me)).拒了写).toBe(true);
    记.答 = "这个账号只能看，要记跟进请找负责的同事。";
    expect((await 问(me)).拒了写).toBeUndefined();
  });

  it("能写的人回答里说「已记下」不带 拒了写", async () => {
    const me = await 造人("壬", "sales");
    记.答 = "已经帮你记下了。";
    expect((await 问(me)).拒了写).toBeUndefined();
  });
});
