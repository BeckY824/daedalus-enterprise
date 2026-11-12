/**
 * 客户三态 · 第二轮审查修复 + 客户 11-12 答复 T1–T12 落地的用例。日子都是改出来的。
 *   - A：转让事务里算归零只用 tx 读规则；夜扫一批写之前在事务里重收事实
 *   - T1–T12 各一组，见各 describe
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const 坏人 = vi.hoisted(() => new Set<string>());
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
// 模拟发到一半断掉：坏人里的人那条没记上
vi.mock("@/lib/enterprise/notify", async (原) => {
  const m = await 原<typeof import("@/lib/enterprise/notify")>();
  return { ...m, notify: (ids: readonly (string | null | undefined)[], n: Parameters<typeof m.notify>[1]) => m.notify(ids.filter((u) => !u || !坏人.has(u)), n) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 三态夜扫, 三态扫过键, 收三态客户, 写一批, 公海状态 } from "@/lib/enterprise/tri-state-db";
import { 钟上三态提醒, 三态提醒水位键 } from "@/lib/enterprise/tri-state-notice";
import { 继续持有, 暂缓回收动作 } from "@/lib/enterprise/tri-state-hold";
import { 读组织 } from "@/lib/enterprise/org";
import { 默认组织规则, 默认三态规则, type 组织规则, type 三态规则 } from "@/lib/project/org-rules";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 加天 } from "@/lib/enterprise/tri-state";
import { 删被撤的换负责人记录, 记换负责人 } from "@/lib/owner-log-db";
import { 查完再写 } from "@/lib/check-then-write";
import { 有内容的沟通, 拨钟的沟通, 默认占位词 } from "@/lib/enterprise/tri-state-quota";
import { 读占位词, 存占位词 } from "@/lib/enterprise/tri-state-db";
import { 等通知推完 } from "@/lib/enterprise/notify";

const 起 = "2026-11-01";
const 日 = (n: number) => 加天(起, n);
const 早 = (n: number) => new Date(`${日(n)}T00:10:00+08:00`);
const 八点 = (n: number) => new Date(`${日(n)}T08:10:00+08:00`);
const 白天 = (n: number) => new Date(`${日(n)}T10:00:00+08:00`);
const 开三态 = (改: Partial<三态规则> = {}): 组织规则 => ({ ...默认组织规则, 三态: { ...默认三态规则, 开: true, ...改 } });
async function 过(n: number) {
  await 三态夜扫(早(n));
  await 钟上三态提醒(八点(n));
}

const 人 = {} as Record<"乙" | "丙" | "甲" | "总内" | "总外" | "系", { id: string; name: string }>;
let 客户: string;
const 钟 = () => prisma.entCustomerClock.findUnique({ where: { customerId: 客户 } });
const 痕 = () => prisma.entCustomerStateLog.findMany({ where: { customerId: 客户 }, orderBy: [{ at: "asc" }, { id: "asc" }], select: { fromState: true, toState: true, via: true, reason: true } });
const 三态通知 = async (u: string) => prisma.entNotice.findMany({ where: { userId: u, dedupeKey: { startsWith: "tri-daily:" } }, select: { title: true, body: true } });
async function 转给(到: string, n: number) {
  const c = await prisma.customer.findUniqueOrThrow({ where: { id: 客户 } });
  await prisma.customerOwnerLog.create({ data: { customerId: 客户, userId: 人.系.id, fromOwnerId: c.salesOwnerId, toOwnerId: 到, kind: "assign", at: 白天(n) } });
  await prisma.customer.update({ where: { id: 客户 }, data: { salesOwnerId: 到 } });
}
/** 被同事项目挡住：第 210 天该进公海进不去 */
async function 到期被挡() {
  await prisma.project.create({ data: { name: "同事的项目", customerId: 客户, ownerId: 人.丙.id, creatorId: 人.丙.id, createdAt: new Date("2026-10-20T10:00:00+08:00") } });
  await 三态夜扫(早(180));
  await prisma.entCustomerClock.update({ where: { customerId: 客户 }, data: { noticeCount: 3, lastNoticeDay: 日(200) } });
  await 三态夜扫(早(210));
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  坏人.clear();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  for (const k of ["乙", "丙", "甲", "总内", "总外", "系"] as const) {
    const u = await prisma.user.create({ data: { email: k, name: k, title: "", role: "SALES", password: "x" } });
    人[k] = { id: u.id, name: u.name };
  }
  await prisma.entMember.createMany({
    data: [
      { userId: 人.乙.id, bizRole: "sales", line: "内贸", managerId: 人.甲.id },
      { userId: 人.丙.id, bizRole: "sales", line: "内贸", managerId: 人.甲.id },
      { userId: 人.甲.id, bizRole: "sales_mgr", line: "内贸" },
      { userId: 人.总内.id, bizRole: "director", line: "内贸" },
      { userId: 人.总外.id, bizRole: "director", line: "外贸" },
      { userId: 人.系.id, bizRole: "director" },
    ],
  });
  客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "13800000001", salesOwnerId: 人.乙.id, createdAt: new Date("2026-10-01T10:00:00+08:00") } })).id;
  await setSetting("business", { projectMode: true });
  await setSetting("orgRules", 开三态());
});
afterEach(async () => {
  await 等通知推完();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("A · 转让事务里算归零", () => {
  it("在事务里调 记换负责人：设置缓存刚失效也不走外面的连接读规则，归零照存", async () => {
    invalidateSettingsCache();
    const 外面读设置 = vi.spyOn(prisma.setting, "findMany");
    await 查完再写(async (tx) => {
      await tx.customer.update({ where: { id: 客户 }, data: { salesOwnerId: 人.丙.id } });
      await 记换负责人(tx, [{ customerId: 客户, from: 人.乙.id, to: 人.丙.id }], 人.系.id, "assign");
    });
    expect(外面读设置).not.toHaveBeenCalled();
    expect((await prisma.customerOwnerLog.findMany({ select: { clockReset: true } })).map((x) => x.clockReset)).toEqual([true]);
  });

  it("三态关着 / 不是企业版：转让照写、归零留空", async () => {
    await setSetting("orgRules", { ...默认组织规则 });
    await 查完再写((tx) => 记换负责人(tx, [{ customerId: 客户, from: 人.乙.id, to: 人.丙.id }], 人.系.id, "assign"));
    vi.stubEnv("CRM_ENTERPRISE", "");
    await setSetting("orgRules", 开三态());
    await 查完再写((tx) => 记换负责人(tx, [{ customerId: 客户, from: 人.丙.id, to: 人.乙.id }], 人.系.id, "assign"));
    expect((await prisma.customerOwnerLog.findMany({ select: { clockReset: true } })).map((x) => x.clockReset)).toEqual([null, null]);
  });
});

describe("A · 夜扫一批写之前在事务里重收事实", () => {
  it("事务外读完以后有人转让了（钟没动）：按转让后的事实写，不写过时的状态留痕", async () => {
    await 三态夜扫(早(95));
    expect((await 钟())!.state).toBe("沉睡");
    const 规则 = 开三态();
    const org = await 读组织();
    const 旧的 = await 收三态客户(prisma, [客户], 规则, org, 早(96));
    await 转给(人.丙.id, 95);
    await 写一批(规则, org, 旧的, 早(96), 日(96));
    expect(await 钟()).toMatchObject({ state: "活跃", enteredDay: 日(95) });
    expect((await 痕()).at(-1)).toMatchObject({ fromState: "沉睡", toState: "活跃" });
  });

  it("事务外读完以后记了一条有内容的沟通：按新沟通归零", async () => {
    await 三态夜扫(早(95));
    const 规则 = 开三态();
    const org = await 读组织();
    const 旧的 = await 收三态客户(prisma, [客户], 规则, org, 早(96));
    await prisma.followUp.create({ data: { type: "PHONE", title: "电话", content: "聊了下季度采购计划", customerId: 客户, ownerId: 人.乙.id, occurredAt: 白天(95) } });
    await 写一批(规则, org, 旧的, 早(96), 日(96));
    expect(await 钟()).toMatchObject({ state: "活跃", enteredDay: 日(95) });
  });
});

describe("T1 / T2 · 有效沟通判定（纯函数）", () => {
  it("去空白、标点、表情、链接后不足 4 字算空", () => {
    for (const x of ["", "   ", "好的。", "OK!!", "👍👍👍👍", "电 话 了", "https://pan.example.com/s/abc123 ", "www.example.com/a/b"]) expect(有内容的沟通(x), x).toBe(false);
    for (const x of ["约了下周见面", "客户要报价单", "这周五去拜访张总"]) expect(有内容的沟通(x), x).toBe(true);
  });
  it("整条只由占位词拼成算空（连写、重复都算）；夹了别的字不算占位", () => {
    for (const x of ["跟进", "已联系，跟进。", "已沟通 已沟通 已沟通", "1111", "拜访/回访"]) expect(有内容的沟通(x), x).toBe(false);
    expect(有内容的沟通("已联系，下周报价")).toBe(true);
    expect(有内容的沟通("回访：设备运行正常")).toBe(true);
  });
  it("AI 起草成功的以生成结果判：有字就算；空的照样不算", () => {
    expect(有内容的沟通("已联系", { AI生成: true })).toBe(true);
    expect(有内容的沟通("  。 ", { AI生成: true })).toBe(false);
  });
  it("拨钟和回满额度同源", () => {
    for (const x of ["", "跟进", "约了下周见面"]) expect(拨钟的沟通(x)).toBe(有内容的沟通(x));
  });
  it("词表可换：自定义词表只认表里的词", () => {
    expect(有内容的沟通("电话沟通过了", { 占位词: ["电话沟通过了"] })).toBe(false);
    expect(有内容的沟通("已联系已联系", { 占位词: [] })).toBe(true);
  });
});

describe("T1 / T2 · 读库：无效沟通不拨钟、不回满", () => {
  const 记 = (n: number, content: string, 时 = "10:00") => prisma.followUp.create({ data: { type: "PHONE", title: "", content, customerId: 客户, ownerId: 人.乙.id, occurredAt: new Date(`${日(n)}T${时}:00+08:00`) } });

  it("沉睡里记了空 / 占位 / 只贴链接的沟通：不回活跃；有效的才回；同一天几条算一次", async () => {
    await 三态夜扫(早(95));
    await 记(96, "跟进");
    await 记(96, "https://pan.example.com/s/录音", "11:00");
    await 三态夜扫(早(97));
    expect(await 钟()).toMatchObject({ state: "沉睡", quotaResetDay: null });
    await 记(97, "约了下周见面", "09:00");
    await 记(97, "已联系", "15:00"); // 同一天后面那条无效：往前找到上午那条
    await 三态夜扫(早(98));
    expect(await 钟()).toMatchObject({ state: "活跃", enteredDay: 日(97), quotaResetDay: 日(97) });
  });

  it("AI 起草成功的短沟通照样拨钟", async () => {
    await 三态夜扫(早(95));
    const f = await 记(96, "已联系");
    await prisma.followUpSource.create({ data: { followUpId: f.id, text: "客户说下周来看样品" } });
    await 三态夜扫(早(97));
    expect(await 钟()).toMatchObject({ state: "活跃", enteredDay: 日(96) });
  });

  it("占位词表存 Setting、后台可改：默认词表；改了以后按新表判", async () => {
    expect(await 读占位词()).toEqual(默认占位词);
    expect(await 存占位词(["  电话沟通过了。", "电话沟通过了", "", 1 as unknown as string])).toEqual(["电话沟通过了"]);
    invalidateSettingsCache();
    expect(await 读占位词()).toEqual(["电话沟通过了"]);
    await 三态夜扫(早(95));
    await 记(96, "电话沟通过了！");
    await 三态夜扫(早(97));
    expect((await 钟())!.state).toBe("沉睡");
  });
});
