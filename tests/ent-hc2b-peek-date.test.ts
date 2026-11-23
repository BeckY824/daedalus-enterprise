/**
 * #441 审查 3（服务端那半）：回答里客户名的小卡「上次跟进」原来取 records[0].date，是 MM-DD 不带年——
 * 去年 3 月跟进过一次的人看着像今年。现在 get_customer 带一份完整日期（YYYY-MM-DD），小卡按今年 / 不是今年再决定带不带年（RecordPeek 跟进日）。
 * 引用的那份 records（[n] 出处）照旧 MM-DD，不动。
 */
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import dayjs from "dayjs";
import { prisma } from "@/lib/prisma";
import { DEFAULT_BUSINESS } from "@/lib/business-config";
import { resetDb } from "./reset";
import { 跟进日 } from "@/components/RecordPeek";

const model = vi.hoisted(() => ({ calls: [] as { name: string; args: unknown }[], answer: "" }));
vi.mock("@/lib/llm", () => ({
  buildSystemPrompt: () => "只基于数据回答",
  chatMessagesJSON: async () => ({ final: true }),
  chatTools: async () => {
    const next = model.calls.shift();
    return { text: "", toolCalls: next ? [{ id: "qa-call", function: { name: next.name, arguments: JSON.stringify(next.args) } }] : [] };
  },
  chatTextStream: async (_m: unknown, _o: unknown, token: (t: string) => void) => {
    for (const ch of model.answer) token(ch);
    return model.answer;
  },
}));
beforeEach(async () => { await resetDb(); model.calls = []; model.answer = ""; });
afterAll(async () => { await prisma.$disconnect(); });

it("get_customer：提到的客户带负责人和完整的上次跟进日期（去年的也认得出是去年）；records 照旧 MM-DD", async () => {
  const user = await prisma.user.create({ data: { id: "qa-user", email: "qa@example.invalid", name: "QA销售", password: "unused", role: "ADMIN" } });
  const c = await prisma.customer.create({ data: { name: "QA去年客户", phone: "13900009992", salesOwnerId: user.id } });
  const 去年 = dayjs().subtract(1, "year").month(2).date(4).hour(10).toDate();
  await prisma.followUp.create({ data: { customerId: c.id, ownerId: user.id, type: "PHONE", title: "", content: "去年那次", status: "已完成", occurredAt: 去年 } });
  await prisma.followUp.create({ data: { customerId: c.id, ownerId: user.id, type: "PHONE", title: "", content: "更早那次", status: "已完成", occurredAt: dayjs(去年).subtract(10, "day").toDate() } });
  model.calls = [{ name: "get_customer", args: { id: c.id } }];
  model.answer = "QA去年客户上次跟进在去年。";
  const { runAgent } = await import("@/lib/agent/run");
  const r = await runAgent({ question: "QA去年客户最近怎么样", user: { id: user.id, name: "QA销售" }, b: DEFAULT_BUSINESS }, {});
  expect(r.customers).toHaveLength(1);
  expect(r.customers[0]).toMatchObject({ id: c.id, owner: "QA销售", lastFollowAt: dayjs(去年).format("YYYY-MM-DD") });
  expect(r.records[0].date).toBe(dayjs(去年).format("MM-DD"));
});

it("跟进日：今年的只写月-日，不是今年的带年份；老存档的月-日照原样；没有写「—」", () => {
  expect(跟进日("2026-11-19", 2026)).toBe("11-19");
  expect(跟进日("2025-03-04", 2026)).toBe("2025-03-04");
  expect(跟进日("2025-03-04T02:00:00.000Z", 2026)).toBe("2025-03-04");
  expect(跟进日("11-19", 2026)).toBe("11-19");
  expect(跟进日(undefined, 2026)).toBe("—");
});
