/**
 * 企业版换负责人，东西跟着项目走（11-03 A2-3）：
 *   - 下一步时间和内容不清：转让（改项目）、批量转（转项目）、导入换负责人都留着；不是企业版照旧清掉
 *   - 「再不跟进就回公海」的提醒（自救任务）交给新负责人，不勾「带待办」也不关；回收日不在明天以内了（接手重新计时）才勾掉
 *   - 卡点认领行：导入把负责人从一个人换成另一个人，同转让交给新负责人；导入进公海（负责人清空）不动
 * 分配线索的下一步见 enterprise-lead-assign，沟通记录谁能看见见 ent-review-tabs（C6-2）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import dayjs from "dayjs";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "boss@local", role: "ADMIN", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 改项目 } from "@/lib/project/db";
import { 转项目 } from "@/lib/carry-over-db";
import { 改项目 as 导入改项目 } from "@/lib/enterprise-import/project-target";
import { 将回收提醒 } from "@/lib/project/timeout";
import { 默认组织规则 } from "@/lib/project/org-rules";
import { 转让关待办尾 } from "@/lib/enterprise/pool-rules";

type 人 = { id: string; name: string; role: string };
let 老板: 人;
let 乙: 人;
let 丙: 人;

const 下一步 = dayjs().add(5, "day").startOf("day").toDate();
const 明天 = dayjs().add(1, "day").format("YYYY-MM-DD");

async function 造人(email: string, name: string, role: string): Promise<人> {
  const u = await prisma.user.create({ data: { email, name, title: "", role, password: "x" } });
  return { id: u.id, name, role };
}
/** 潜客培育按几天回收：1 天 = 接手那天起算明天就收（提醒还作数），30 天 = 接手后远着呢（提醒勾掉） */
const 回收天数 = (天: number) => setSetting("orgRules", { ...默认组织规则, 超时回收: { 开: true, 起算日: null, 节点天数: { 潜客培育: 天 } } });

/** 乙负责、客户归老板的项目：填了下一步，乙名下有一条明天回收的提醒、一条普通待办，项目上一个乙认领着的卡点 */
async function 底子() {
  const c = (await prisma.customer.create({ data: { name: "测试客户", phone: "13900000001", salesOwnerId: 老板.id } })).id;
  const p = (await prisma.project.create({ data: { name: "一号项目", customerId: c, ownerId: 乙.id, creatorId: 乙.id, nextStepAt: 下一步, nextStepText: "约客户看样" } })).id;
  const 提醒 = await prisma.task.create({ data: { title: 将回收提醒("一号项目", "潜客培育", 明天), customerId: c, ownerId: 乙.id, dueOn: 明天 } });
  const 普通 = await prisma.task.create({ data: { title: "回个电话", customerId: c, ownerId: 乙.id, dueOn: 明天 } });
  const 卡 = await prisma.entBlocker.create({
    data: {
      code: "BLK-20261103-001", projectId: p, customerId: c, phase: "线索", type: "中度卡点", impact: "短期不影响", obstacle: "价格预算分歧",
      description: "预算没批", dueDays: 7, dueAt: dayjs().add(7, "day").toDate(), status: "处理中", creatorId: 乙.id,
    },
  });
  await prisma.entBlockerClaim.create({ data: { blockerId: 卡.id, userId: 乙.id } });
  return { c, p, 提醒, 普通, 卡: 卡.id };
}
const 看项目 = (id: string) => prisma.project.findUniqueOrThrow({ where: { id } });
const 看待办 = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });
const 认领人 = async (blockerId: string) => (await prisma.entBlockerClaim.findMany({ where: { blockerId } })).map((x) => x.userId);

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  老板 = await 造人("boss", "老板", "ADMIN");
  乙 = await 造人("yi", "乙", "SALES");
  丙 = await 造人("bing", "丙", "SALES");
  await prisma.entMember.createMany({
    data: [
      { userId: 老板.id, bizRole: "director" },
      { userId: 乙.id, bizRole: "sales" },
      { userId: 丙.id, bizRole: "sales" },
    ],
  });
  mocks.user = { ...mocks.user, id: 老板.id, name: 老板.name, role: 老板.role };
});
afterEach(() => {
  vi.unstubAllEnvs();
  忘掉企业版范围();
});

describe("转让（改项目 换负责人）", () => {
  it("下一步时间和内容留着；回收提醒交给丙、不勾带待办也不关（普通待办照样关）；卡点认领行给丙", async () => {
    await 回收天数(1);
    const { p, 提醒, 普通, 卡 } = await 底子();
    expect(await 改项目(老板, p, { name: "一号项目", ownerId: 丙.id, amount: 0 }, false)).toMatchObject({ ok: true });
    expect(await 看项目(p)).toMatchObject({ ownerId: 丙.id, nextStepAt: 下一步, nextStepText: "约客户看样" });
    expect(await 看待办(提醒.id)).toMatchObject({ ownerId: 丙.id, done: false, title: 提醒.title });
    expect(await 看待办(普通.id)).toMatchObject({ ownerId: 乙.id, done: true, title: `回个电话${转让关待办尾}` });
    expect(await 认领人(卡)).toEqual([丙.id]);
  });

  it("接手重新计时、回收日远了：提醒交给丙后勾掉，不留在乙那", async () => {
    await 回收天数(30);
    const { p, 提醒 } = await 底子();
    await 改项目(老板, p, { name: "一号项目", ownerId: 丙.id, amount: 0 }, true);
    const t = await 看待办(提醒.id);
    expect(t).toMatchObject({ ownerId: 丙.id, done: true, title: 提醒.title });
    expect(t.doneAt).not.toBeNull();
  });

  it("不是企业版：照旧清下一步，提醒不碰", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    const { p, 提醒 } = await 底子();
    await 改项目(老板, p, { name: "一号项目", ownerId: 丙.id, amount: 0 });
    expect(await 看项目(p)).toMatchObject({ ownerId: 丙.id, nextStepAt: null, nextStepText: null });
    expect(await 看待办(提醒.id)).toMatchObject({ ownerId: 乙.id, done: false });
  });
});

describe("批量转（转项目：客户交接、停用成员）", () => {
  it("下一步留着，提醒、卡点认领行给新负责人", async () => {
    const { p, 提醒, 普通, 卡 } = await 底子();
    expect(await prisma.$transaction((tx) => 转项目(tx, { id: p }, 丙.id, 老板.id))).toEqual([p]);
    expect(await 看项目(p)).toMatchObject({ ownerId: 丙.id, nextStepAt: 下一步, nextStepText: "约客户看样" });
    expect(await 看待办(提醒.id)).toMatchObject({ ownerId: 丙.id, done: false });
    expect(await 看待办(普通.id)).toMatchObject({ ownerId: 乙.id, done: false });
    expect(await 认领人(卡)).toEqual([丙.id]);
  });

  it("不是企业版：照旧清下一步，提醒不碰", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    const { p, 提醒 } = await 底子();
    await prisma.$transaction((tx) => 转项目(tx, { id: p }, 丙.id, 老板.id));
    expect(await 看项目(p)).toMatchObject({ ownerId: 丙.id, nextStepAt: null, nextStepText: null });
    expect(await 看待办(提醒.id)).toMatchObject({ ownerId: 乙.id });
  });
});

describe("导入换负责人", () => {
  const 现值 = { stage: "潜客培育", status: "进行中" };
  const 现在 = new Date().toISOString();

  it("从乙换成丙：下一步不动，提醒、卡点认领行给丙", async () => {
    const { p, 提醒, 卡 } = await 底子();
    await prisma.$transaction((tx) => 导入改项目(tx, p, { ownerId: 丙.id }, 现值, 现在));
    expect(await 看项目(p)).toMatchObject({ ownerId: 丙.id, nextStepAt: 下一步, nextStepText: "约客户看样" });
    expect(await 看待办(提醒.id)).toMatchObject({ ownerId: 丙.id, done: false });
    expect(await 认领人(卡)).toEqual([丙.id]);
  });

  it("负责人清空进公海：提醒、卡点不动（进公海另有规矩）", async () => {
    const { p, 提醒, 卡 } = await 底子();
    await prisma.$transaction((tx) => 导入改项目(tx, p, { ownerId: null }, 现值, 现在));
    expect((await 看项目(p)).pooledAt).not.toBeNull();
    expect(await 看待办(提醒.id)).toMatchObject({ ownerId: 乙.id });
    expect(await 认领人(卡)).toEqual([乙.id]);
  });
});
