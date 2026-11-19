/**
 * 项目类写工具判断「人这一轮点没点名是哪个项目」看的是 ToolContext.问题（project-tools.ts 本轮点名）。
 * route 给 runAgent 的 question 已经拼了附件全文（ask-files.ts 拼文件），附件里出现的项目名不能当人点了名：
 * 问题 只取调用方另给的 原话，没给就当没点名。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let 剧本: ({ name: string; args: string } | null)[] = [];
vi.mock("@/lib/llm", () => ({
  buildSystemPrompt: () => "系统提示",
  chatMessagesJSON: async () => ({ final: true }),
  chatTextStream: async (_m: unknown, _o: unknown, onToken: (t: string) => void) => { onToken("好的"); return "好的"; },
  chatTools: async () => {
    const 这轮 = 剧本.shift() ?? null;
    if (!这轮) return { text: "", toolCalls: [] };
    return { text: "", toolCalls: [{ id: "c1", function: { name: 这轮.name, arguments: 这轮.args } }] };
  },
}));

const b = { customer: "学员", brief: "招生", statusLabels: {}, 术语: {} } as never;
const user = { id: "u1", name: "张三" };

describe("ToolContext.问题 来自原话，不含附件", () => {
  beforeEach(() => { process.env.AGENT_INTENTS = "0"; });
  afterEach(() => { vi.restoreAllMocks(); });

  it("给了原话：工具拿到的是原话；没给：undefined（当没点名）", async () => {
    const { TOOLS } = await import("@/lib/agent/tools");
    const { runAgent } = await import("@/lib/agent/run");
    const 工具 = TOOLS.find((t) => t.name === "search_customers")!;
    const 收到: unknown[] = [];
    vi.spyOn(工具, "run").mockImplementation(async (_a, ctx) => { 收到.push(ctx.问题); return { summary: "没找到", data: [] }; });
    const 拼了附件 = "给青禾加个卡点\n\n【附件 报价.txt】\n青禾工程（2） 报价单……";
    剧本 = [{ name: "search_customers", args: '{"keyword":"青禾"}' }, null];
    await runAgent({ question: 拼了附件, 原话: "给青禾加个卡点", user, b });
    剧本 = [{ name: "search_customers", args: '{"keyword":"青禾"}' }, null];
    await runAgent({ question: 拼了附件, user, b });
    expect(收到).toEqual(["给青禾加个卡点", undefined]);
  });
});
