/**
 * 企业版到期提醒（lib/enterprise/due-notice.ts）。「现在」都当参数传，不等真实时钟；时刻一律写成带 +08:00 / Z 的真实瞬间。
 * 钉的是：今天到期才提醒（明天、历史逾期都不提醒，开机不轰炸）；北京 09:00 起、晚起来当天补；重复扫、重启不重发；改到期日再提醒；
 * 已完成 / 已解决 / 已结束 / 公海 / 已删 / 停用的人不提醒；收件人；北京跨日；不是企业版、切换视图不发；挂在夜扫钟上且只挂这一处；飞书开着顺带推。
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-ent-due-"));
  fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db"), path.join(dir, "A.db"));
  if (fs.existsSync(path.resolve(__dirname, "../prisma/test.db-wal"))) fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db-wal"), path.join(dir, "A.db-wal"));
  return { dir, 视图中: false };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@/generated/prisma");
  const { 加上限定 } = await import("@/lib/team-scope");
  const raw = new PrismaClient({ datasourceUrl: `file:${path.join(临时.dir, "A.db")}?connection_limit=1` });
  return { prisma: 加上限定(raw), defaultClient: raw };
});
vi.mock("@/lib/enterprise/view-as", async (原) => ({
  ...(await 原<typeof import("@/lib/enterprise/view-as")>()),
  视图中跳过: async () => 临时.视图中,
}));

import { prisma } from "@/lib/prisma";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { resetDb } from "./reset";
import { 到期提醒扫一遍, 钟上到期提醒, 忘掉到期提醒节流, 过了提醒时刻 } from "@/lib/enterprise/due-notice";
import { 等通知推完 } from "@/lib/enterprise/notify";
import { 飞书推送开关键, 清飞书推送令牌 } from "@/lib/enterprise/feishu-push";
import { 启动夜扫, 停夜扫, 夜扫在跑 } from "@/lib/project/nightly";

/** 北京时间的一个瞬间 */
const 京 = (s: string) => new Date(`${s.replace(" ", "T")}:00+08:00`);
const 今早 = 京("2026-11-02 10:00");

let 甲: string, 乙: string, 丙: string, 客户: string, 序 = 0;
const 人 = async (email: string, feishuOpenId: string | null = null, active = true) =>
  (await prisma.user.create({ data: { email, name: email, title: "", role: "SALES", password: "x", feishuOpenId, active } })).id;
const 新客户 = async (补: { salesOwnerId?: string } = {}) =>
  (await prisma.customer.create({ data: { name: `客户${++序}`, phone: `1380000${String(序).padStart(4, "0")}`, salesOwnerId: 补.salesOwnerId ?? 甲 } })).id;
const 计划 = (补: { plannedAt?: Date; plannedOn?: string | null; ownerId?: string; customerId?: string; done?: boolean; subject?: string } = {}) =>
  prisma.followPlan.create({
    data: {
      subject: 补.subject ?? "回访", plannedAt: 补.plannedAt ?? 今早, plannedOn: 补.plannedOn === undefined ? "2026-11-02" : 补.plannedOn,
      customerId: 补.customerId ?? 客户, ownerId: 补.ownerId ?? 甲, done: 补.done ?? false,
    },
  });
const 项目 = (补: Record<string, unknown> = {}) =>
  prisma.project.create({ data: { name: `项目${++序}`, customerId: 客户, ownerId: 甲, creatorId: 甲, ...补 } });
const 卡点 = async (projectId: string, 补: Record<string, unknown> = {}) =>
  prisma.entBlocker.create({
    data: {
      code: `KD${++序}`, title: "等报价", projectId, customerId: 客户, phase: "商机", type: "内部", impact: "中度", obstacle: "内部", description: "说明",
      dueDays: 3, dueAt: 京("2026-11-02 14:00"), creatorId: 丙, ...补,
    },
  });
const 通知们 = () => prisma.entNotice.findMany({ orderBy: [{ userId: "asc" }, { dedupeKey: "asc" }] });
const 钥匙们 = async () => (await 通知们()).map((n) => n.dedupeKey);

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  清飞书推送令牌();
  忘掉到期提醒节流();
  临时.视图中 = false;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  甲 = await 人("jia", "ou_jia");
  乙 = await 人("yi");
  丙 = await 人("bing");
  客户 = await 新客户();
});
afterEach(async () => {
  停夜扫();
  vi.useRealTimers();
  await 等通知推完();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await (await import("@/lib/prisma")).defaultClient.$disconnect();
  fs.rmSync(临时.dir, { recursive: true, force: true });
});

describe("今天到期才提醒", () => {
  it("跟进计划：给负责人，一条，点开有自己的项目去项目页、没有去客户页", async () => {
    const 有项目的客户 = await 新客户();
    const 他的 = await 项目({ customerId: 有项目的客户 });
    const a = await 计划({ customerId: 有项目的客户, subject: "带项目" });
    const b = await 计划({ subject: "不带项目" });
    expect(await 到期提醒扫一遍(今早)).toBe(2);
    const rows = await 通知们();
    expect(rows.map((n) => n.userId)).toEqual([甲, 甲]);
    const 那条 = (id: string) => rows.find((n) => n.dedupeKey === `due:plan:${id}:2026-11-02`)!;
    expect(那条(a.id)).toMatchObject({ kind: "跟进到期", link: `/projects/${他的.id}`, title: "跟进计划今天到期：带项目" });
    expect(那条(b.id)).toMatchObject({ kind: "跟进到期", link: `/customers/${客户}` });
    expect(那条(b.id).body).toContain("到期日 2026-11-02");
  });

  it("客户下的项目是别人的：不指过去（他不一定打得开），去客户页", async () => {
    await 项目({ ownerId: 乙 });
    await 计划();
    await 到期提醒扫一遍(今早);
    expect((await 通知们())[0].link).toBe(`/customers/${客户}`);
  });

  it("老计划没有 plannedOn：按 plannedAt 落在北京今天算", async () => {
    const a = await 计划({ plannedOn: null, plannedAt: 京("2026-11-02 08:00") });
    await 计划({ plannedOn: null, plannedAt: 京("2026-11-03 08:00") });
    await 计划({ plannedOn: null, plannedAt: 京("2026-11-01 08:00") });
    await 到期提醒扫一遍(今早);
    expect(await 钥匙们()).toEqual([`due:plan:${a.id}:2026-11-02`]);
  });

  it("项目下一步：给项目负责人，指向项目", async () => {
    const p = await 项目({ ownerId: 乙, nextStepAt: 京("2026-11-02 16:00"), nextStepText: "发方案" });
    await 到期提醒扫一遍(今早);
    expect(await 通知们()).toMatchObject([{ userId: 乙, kind: "跟进到期", link: `/projects/${p.id}`, dedupeKey: `due:next:${p.id}:2026-11-02` }]);
    expect((await 通知们())[0].body).toContain("发方案");
  });

  it("卡点：kind 是卡点到期，指向项目，正文写明到期日", async () => {
    const p = await 项目();
    const b = await 卡点(p.id);
    await 到期提醒扫一遍(今早);
    const [n] = await 通知们();
    expect(n).toMatchObject({ kind: "卡点到期", link: `/projects/${p.id}`, dedupeKey: `due:blocker:${b.id}:2026-11-02`, title: "卡点今天到期：等报价" });
    expect(n.body).toContain("到期日 2026-11-02");
  });

  it("明天到期的不提醒", async () => {
    await 计划({ plannedOn: "2026-11-03", plannedAt: 京("2026-11-03 10:00") });
    await 项目({ nextStepAt: 京("2026-11-03 10:00") });
    await 卡点((await 项目()).id, { dueAt: 京("2026-11-03 10:00") });
    expect(await 到期提醒扫一遍(今早)).toBe(0);
    expect(await 通知们()).toEqual([]);
  });

  it("历史逾期的不提醒（一上线不轰炸）：昨天的、去年的，三种来源都不补发", async () => {
    for (const [日, 时] of [["2026-11-01", "2026-11-01 10:00"], ["2025-03-01", "2025-03-01 10:00"]] as const) {
      await 计划({ plannedOn: 日, plannedAt: 京(时) });
      await 计划({ plannedOn: null, plannedAt: 京(时) });
      await 项目({ nextStepAt: 京(时) });
      await 卡点((await 项目()).id, { dueAt: 京(时) });
    }
    expect(await 到期提醒扫一遍(今早)).toBe(0);
    expect(await 通知们()).toEqual([]);
  });

  it("服务停了一整天：开机不补昨天到期的，只提醒今天的", async () => {
    await 计划({ plannedOn: "2026-11-02" });
    const 明天的 = await 计划({ plannedOn: "2026-11-03", plannedAt: 京("2026-11-03 10:00") });
    await 到期提醒扫一遍(京("2026-11-03 10:00"));
    expect(await 钥匙们()).toEqual([`due:plan:${明天的.id}:2026-11-03`]);
  });
});

describe("不该提醒的", () => {
  it("已完成的计划、已解决的卡点", async () => {
    await 计划({ done: true });
    await 卡点((await 项目()).id, { status: "已解决" });
    expect(await 到期提醒扫一遍(今早)).toBe(0);
  });

  it("已结束的项目：下一步、卡点都不提醒", async () => {
    await 项目({ result: "丢单", nextStepAt: 今早 });
    await 卡点((await 项目({ result: "成功交付" })).id);
    expect(await 到期提醒扫一遍(今早)).toBe(0);
  });

  it("公海的项目：下一步、卡点都不提醒", async () => {
    await 项目({ pooledAt: 京("2026-10-30 10:00"), nextStepAt: 今早 });
    await 卡点((await 项目({ pooledAt: 京("2026-10-30 10:00") })).id);
    expect(await 到期提醒扫一遍(今早)).toBe(0);
  });

  it("客户在公海：计划、项目下一步、卡点都不提醒", async () => {
    await 计划();
    await 项目({ nextStepAt: 今早 });
    await 卡点((await 项目()).id);
    await prisma.customerPool.create({ data: { customerId: 客户, reason: "手动" } });
    expect(await 到期提醒扫一遍(今早)).toBe(0);
  });

  it("客户、项目进了回收站：不提醒", async () => {
    const 要删的客户 = await 新客户();
    await 计划({ customerId: 要删的客户 });
    const 已删 = await 项目({ nextStepAt: 今早 });
    await 卡点(已删.id);
    await prisma.customer.update({ where: { id: 要删的客户 }, data: { deletedAt: 今早 } });
    await prisma.project.update({ where: { id: 已删.id }, data: { deletedAt: 今早 } });
    expect(await 到期提醒扫一遍(今早)).toBe(0);
  });

  it("停用的负责人不收", async () => {
    await 计划({ ownerId: await 人("走了", null, false) });
    expect(await 到期提醒扫一遍(今早)).toBe(0);
  });

  it("不是企业版：一条不写", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    await 计划();
    expect(await 到期提醒扫一遍(今早)).toBe(0);
    expect(await 通知们()).toEqual([]);
  });

  it("切换视图期间（只读预览）不扫", async () => {
    临时.视图中 = true;
    await 计划();
    expect(await 到期提醒扫一遍(今早)).toBe(0);
    expect(await 通知们()).toEqual([]);
  });
});

describe("卡点的收件人", () => {
  it("没点完成的认领人 + 老负责人列；点了完成的不再提醒；发布人不收", async () => {
    const b = await 卡点((await 项目()).id, { status: "处理中", assigneeId: 乙 });
    const 丁 = await 人("ding");
    await prisma.entBlockerClaim.createMany({ data: [{ blockerId: b.id, userId: 甲 }, { blockerId: b.id, userId: 丁, done: true }] });
    await 到期提醒扫一遍(今早);
    expect((await 通知们()).map((n) => n.userId).sort()).toEqual([甲, 乙].sort());
  });

  it("没人认领、没负责人：给发布人", async () => {
    await 卡点((await 项目()).id);
    await 到期提醒扫一遍(今早);
    expect((await 通知们()).map((n) => n.userId)).toEqual([丙]);
  });

  it("认领人都停用了：也给发布人；发布人也停用了就没人收", async () => {
    const 走了 = await 人("zou", null, false);
    const b = await 卡点((await 项目()).id, { status: "处理中" });
    await prisma.entBlockerClaim.create({ data: { blockerId: b.id, userId: 走了 } });
    const c = await 卡点((await 项目()).id, { creatorId: 走了 });
    await 到期提醒扫一遍(今早);
    expect(await 通知们()).toMatchObject([{ userId: 丙, dedupeKey: `due:blocker:${b.id}:2026-11-02` }]);
    expect(await 钥匙们()).not.toContain(`due:blocker:${c.id}:2026-11-02`);
  });
});

describe("只提醒一次", () => {
  it("重复扫不重复；进程重启（节流记号没了、库还在）也不重发", async () => {
    await 计划();
    await 卡点((await 项目()).id);
    expect(await 到期提醒扫一遍(今早)).toBe(2);
    expect(await 到期提醒扫一遍(今早)).toBe(0);
    忘掉到期提醒节流();
    expect(await 钟上到期提醒(京("2026-11-02 15:00"))).toBe(0);
    expect(await 通知们()).toHaveLength(2);
  });

  it("重复的那遍不撞唯一键：只查不写", async () => {
    await 计划();
    await 到期提醒扫一遍(今早);
    const 写 = vi.spyOn(prisma.entNotice, "create");
    await 到期提醒扫一遍(今早);
    expect(写).not.toHaveBeenCalled();
  });

  it("改了到期日，再到期可以再提醒；同一天改来改去不重发", async () => {
    const a = await 计划();
    await 到期提醒扫一遍(今早);
    // 改到后天：明天不提醒，后天提醒
    await prisma.followPlan.update({ where: { id: a.id }, data: { plannedOn: "2026-11-04", plannedAt: 京("2026-11-04 10:00") } });
    expect(await 到期提醒扫一遍(京("2026-11-03 10:00"))).toBe(0);
    expect(await 到期提醒扫一遍(京("2026-11-04 10:00"))).toBe(1);
    expect(await 钥匙们()).toEqual([`due:plan:${a.id}:2026-11-02`, `due:plan:${a.id}:2026-11-04`]);
    // 又改回 11-04 当天的别的钟点：还是这一天，不重发
    await prisma.followPlan.update({ where: { id: a.id }, data: { plannedAt: 京("2026-11-04 18:00") } });
    expect(await 到期提醒扫一遍(京("2026-11-04 11:00"))).toBe(0);
  });

  it("白天才改成今天到期的：下一遍提醒", async () => {
    await 到期提醒扫一遍(今早);
    const a = await 计划();
    expect(await 到期提醒扫一遍(京("2026-11-02 15:00"))).toBe(1);
    expect(await 钥匙们()).toEqual([`due:plan:${a.id}:2026-11-02`]);
  });
});

describe("提醒时点与北京跨日", () => {
  it("北京 09:00 起算：08:59 不发，09:00 发；晚起来当天 23:50 也补发", async () => {
    expect(过了提醒时刻(京("2026-11-02 08:59"))).toBe(false);
    expect(过了提醒时刻(京("2026-11-02 09:00"))).toBe(true);
    await 计划();
    expect(await 到期提醒扫一遍(京("2026-11-02 08:59"))).toBe(0);
    expect(await 到期提醒扫一遍(京("2026-11-02 23:50"))).toBe(1);
  });

  it("「今天」按北京日历，不按 UTC：UTC 还是 1 号、北京已是 2 号上午的提醒 2 号的", async () => {
    const a = await 计划({ plannedOn: "2026-11-02" });
    await 计划({ plannedOn: "2026-11-01", plannedAt: 京("2026-11-01 10:00") });
    // 北京 11-02 00:30 / 08:59：2 号了，但没到时点
    expect(await 到期提醒扫一遍(new Date("2026-11-01T16:30:00Z"))).toBe(0);
    expect(await 到期提醒扫一遍(new Date("2026-11-02T00:59:00Z"))).toBe(0);
    // 北京 11-02 09:00 = UTC 01:00
    expect(await 到期提醒扫一遍(new Date("2026-11-02T01:00:00Z"))).toBe(1);
    expect(await 钥匙们()).toEqual([`due:plan:${a.id}:2026-11-02`]);
  });

  it("北京 23:59:59 算当天、次日 00:00 算明天（下一步、卡点按瞬间存的）", async () => {
    const 当天 = await 项目({ nextStepAt: new Date("2026-11-02T15:59:59Z") });
    await 项目({ nextStepAt: new Date("2026-11-02T16:00:00Z") });
    const 当天卡点 = await 卡点((await 项目()).id, { dueAt: new Date("2026-11-01T16:00:00Z") }); // 北京 11-02 00:00
    await 卡点((await 项目()).id, { dueAt: new Date("2026-11-01T15:59:59Z") }); // 北京 11-01 23:59:59
    await 到期提醒扫一遍(京("2026-11-02 09:00"));
    expect((await 钥匙们()).sort()).toEqual([`due:blocker:${当天卡点.id}:2026-11-02`, `due:next:${当天.id}:2026-11-02`].sort());
  });

  it("UTC 同一天、北京已跨日（UTC 11-02 16:30 = 北京 11-03 00:30）：还没到 3 号的时点，2 号的也不再发", async () => {
    await 计划({ plannedOn: "2026-11-02" });
    expect(await 到期提醒扫一遍(new Date("2026-11-02T16:30:00Z"))).toBe(0);
    expect(await 到期提醒扫一遍(new Date("2026-11-03T01:00:00Z"))).toBe(0);
    expect(await 通知们()).toEqual([]);
  });
});

describe("钟与出错", () => {
  it("挂在夜扫钟上：到时点发，每分钟来一次但隔 5 分钟才再扫", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(京("2026-11-02 08:58"));
    await 计划();
    启动夜扫();
    const 走一分钟 = async () => { await vi.advanceTimersByTimeAsync(60_000); await 夜扫在跑(); };
    await 走一分钟(); // 08:59
    expect(await 通知们()).toEqual([]);
    await 走一分钟(); // 09:00
    expect(await 通知们()).toHaveLength(1);
    // 09:01 建的：这一遍还在节流里，09:05 才到
    await 计划({ subject: "后来改的" });
    await 走一分钟();
    expect(await 通知们()).toHaveLength(1);
    for (let i = 0; i < 4; i++) await 走一分钟();
    expect(await 通知们()).toHaveLength(2);
  });

  it("只从钟上触发：src 里除了 nightly.ts 没有别处引用（页面、动作碰不到，切换视图也就触发不到）", () => {
    const 根 = path.resolve(__dirname, "../src");
    const 引用了 = (fs.readdirSync(根, { recursive: true }) as string[])
      .filter((f) => /\.tsx?$/.test(f) && !f.includes("generated"))
      .filter((f) => fs.readFileSync(path.join(根, f), "utf8").includes("enterprise/due-notice"));
    expect(引用了.map((f) => f.replaceAll("\\", "/"))).toEqual(["lib/project/nightly.ts"]);
  });

  it("一处来源出错：只记日志、不抛，别的来源照发", async () => {
    await 计划();
    const b = await 卡点((await 项目()).id);
    const 错 = vi.spyOn(console, "error").mockImplementation(() => {});
    const 查 = vi.spyOn(prisma.followPlan, "findMany").mockRejectedValueOnce(new Error("库忙"));
    expect(await 到期提醒扫一遍(今早)).toBe(1);
    expect(查).toHaveBeenCalled();
    expect(错).toHaveBeenCalled();
    expect(await 钥匙们()).toEqual([`due:blocker:${b.id}:2026-11-02`]);
  });
});

describe("飞书", () => {
  const 回 = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

  it("开关关着：只有站内，一次 fetch 都不发", async () => {
    await 计划();
    await 到期提醒扫一遍(今早);
    await 等通知推完();
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await 通知们())[0].feishuStatus).toBe("没推");
  });

  it("开关开着：顺带推给绑了飞书的负责人", async () => {
    vi.stubEnv("ENT_FEISHU_APP_ID", "cli_test");
    vi.stubEnv("ENT_FEISHU_APP_SECRET", "s3cr3t");
    vi.stubEnv("ENT_PUBLIC_URL", "https://crm.example.test/");
    await setSetting(飞书推送开关键, true);
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("tenant_access_token") ? 回({ code: 0, tenant_access_token: "tok", expire: 7200 }) : 回({ code: 0, data: { message_id: "om_1" } }),
    );
    await 计划();
    await 到期提醒扫一遍(今早);
    await 等通知推完();
    expect((await 通知们())[0].feishuStatus).toBe("已推");
    const 发 = fetchMock.mock.calls.find((c) => String(c[0]).includes("/im/v1/messages"))!;
    expect(JSON.parse((发[1] as { body: string }).body).receive_id).toBe("ou_jia");
  });
});
