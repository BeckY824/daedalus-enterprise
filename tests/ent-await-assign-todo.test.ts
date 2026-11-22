/**
 * 首页待办「待分配新线索 N 条」（11-21 改版，替原来一事一张、分走也不消的黄色大卡）：
 * - 算哪些：线索阶段、标了待分配、没定时、不在公海、没结局、没进回收站；分走了（清了待分配）自动少，没有了 = null 不画
 * - 谁有：能手动分配线索的人（市场管理、销售管理、总管理），按他能分的业务线圈（内贸销售管理不看外贸的；「暂不分配」的都看得到）；
 *   系统管理员不限线；销售没有；「线索分配」开关关着只有系统管理员（X-79）
 * - 首页的 N == 新线索页 /leads?f=await-assign 的行数（同一个 列表条件），范围限定开着也一样
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "a@x", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 数待分配, 读项目列表 } from "@/lib/project/list";
import { 待分配筛 } from "@/lib/enterprise/await-assign-core";
import { 发待分配提醒 } from "@/lib/enterprise/lead-full-notice";
import { 读组织 } from "@/lib/enterprise/org";
import { 看全部 } from "@/lib/team-scope";
import { 短时刻 } from "@/lib/project/time-fields";
import { 自动分配线索 } from "@/app/(app)/leads/assign-actions";
import { 标待分配 } from "@/lib/enterprise/await-assign";
import { 自动分配不参与key } from "@/lib/enterprise/lead-assign";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: string | null };
let 老板: 人, 外条线: 人, 市场管: 人, 内管: 人, 内销: 人, 外管: 人, 外销: 人;
let 序 = 0;
const 早 = new Date("2026-11-01T02:00:00Z");

async function 线索(name: string, 建的人: 人, 另: { bizLine?: string | null; awaitAssignAt?: Date | null; scheduledAssignAt?: Date; pooledAt?: Date; result?: string; deletedAt?: Date; phase?: string } = {}) {
  序++;
  const c = (await prisma.customer.create({ data: { name: `客户${序}`, phone: `1390000${String(序).padStart(4, "0")}`, salesOwnerId: 建的人.id } })).id;
  return (await prisma.project.create({
    data: {
      name, customerId: c, ownerId: 建的人.id, creatorId: 建的人.id, phase: 另.phase ?? "线索", bizLine: 另.bizLine ?? null,
      awaitAssignAt: 另.awaitAssignAt === undefined ? new Date("2026-11-20T08:00:00Z") : 另.awaitAssignAt,
      scheduledAssignAt: 另.scheduledAssignAt ?? null, pooledAt: 另.pooledAt ?? null, result: 另.result ?? null, deletedAt: 另.deletedAt ?? null,
    },
  })).id;
}

const 数 = async (谁: 人) => { mocks.user = 谁; return 以谁的身份(谁.id, () => 数待分配(谁)); };
const 列 = async (谁: 人) => {
  mocks.user = 谁;
  const d = await 以谁的身份(谁.id, () => 读项目列表(谁, { f: 待分配筛, pageSize: "100" }, "线索"));
  return { 总数: d.总数, 名: d.行.map((r) => r.name).sort(), f: d.filters.f };
};
/** 首页那一行数到的 = 新线索页 f=await-assign 列出来的 */
async function 两边对得上(谁: 人): Promise<string[]> {
  const [n, l] = [await 数(谁), await 列(谁)];
  expect(l.f).toBe(待分配筛);
  expect(l.总数).toBe(n?.条数 ?? 0);
  expect(l.名).toHaveLength(l.总数);
  return l.名;
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  序 = 0;
  const 建 = async (email: string, bizRole: string, extra: { line?: string; managerId?: string } = {}): Promise<人> => {
    const u = await prisma.user.create({ data: { email, name: email, title: "", role: "SALES", password: "x" } });
    await prisma.entMember.create({ data: { userId: u.id, bizRole, line: extra.line ?? null, managerId: extra.managerId ?? null } });
    return { id: u.id, name: u.name, email: u.email, role: u.role, title: "", avatar: null };
  };
  老板 = await 建("boss", "director");
  外条线 = await 建("wdir", "director", { line: "外贸" });
  市场管 = await 建("mkt", "marketing_mgr");
  内管 = await 建("nmgr", "sales_mgr", { line: "内贸" });
  内销 = await 建("ns", "sales", { line: "内贸", managerId: 内管.id });
  外管 = await 建("wmgr", "sales_mgr", { line: "外贸" });
  外销 = await 建("ws", "sales", { line: "外贸", managerId: 外管.id });
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting(规则.线索分配.key, true);
  // 先关着「按组织看客户」：人人看得到全部，单看待分配这一层怎么按角色、业务线圈；开着的另一组
  await setSetting(规则.按组织看客户.key, false);
  忘掉企业版范围();

  await 线索("内贸的", 市场管, { bizLine: "内贸", awaitAssignAt: 早 });
  await 线索("外贸的", 市场管, { bizLine: "外贸" });
  await 线索("暂不分配的", 市场管, { bizLine: "暂不分配" });
  // 老项目没填业务线：按占着负责人格的人（外贸销售）的线 = 外贸
  await 线索("没填线外贸人建的", 外销, { bizLine: null });
  // 下面这些都不算
  await 线索("定时的", 市场管, { bizLine: "内贸", scheduledAssignAt: new Date("2026-12-01T00:00:00Z") });
  await 线索("进公海的", 市场管, { bizLine: "内贸", pooledAt: new Date() });
  await 线索("有结局的", 市场管, { bizLine: "内贸", result: "线索流失" });
  await 线索("进回收站的", 市场管, { bizLine: "内贸", deletedAt: new Date() });
  await 线索("已分走的", 内销, { bizLine: "内贸", awaitAssignAt: null });
  await 线索("转了商机的", 市场管, { bizLine: "内贸", phase: "商机" });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("谁看得到、看哪几条（开关开着）", () => {
  it("系统管理员：全部 4 条，最早那条的时间；定时的、进公海的、有结局的、进回收站的、已分走的、转了商机的都不算", async () => {
    // 最早：服务端按北京墙钟写好（不在浏览器里按本地时区格式化）
    // 最早At（设计语言 H-A 11-21）：同一刻的 ISO，首页现状主题拿它走 smartTime
    expect(await 数(老板)).toEqual({ 条数: 4, 最早: 短时刻(早), 最早At: new Date(早).toISOString() });
    expect(await 两边对得上(老板)).toEqual(["内贸的", "外贸的", "暂不分配的", "没填线外贸人建的"].sort());
  });

  it("市场管理（没设业务线）：不限线；新线索页是市场视角（P-界面-05，只列本人 + 下属建的 / 负责的），首页的数跟着同一圈，销售自己建的不算", async () => {
    expect(await 两边对得上(市场管)).toEqual(["内贸的", "外贸的", "暂不分配的"].sort());
  });

  it("内贸销售管理：只看内贸的 + 暂不分配的，不看外贸的（含没填线、外贸人占着的）", async () => {
    expect((await 数(内管))?.条数).toBe(2);
    expect(await 两边对得上(内管)).toEqual(["内贸的", "暂不分配的"].sort());
  });

  it("外贸销售管理：外贸的、没填线外贸人建的、暂不分配的", async () => {
    expect(await 两边对得上(外管)).toEqual(["外贸的", "暂不分配的", "没填线外贸人建的"].sort());
  });

  it("外贸条线总管理（总管理设了业务线）：同样只看外贸这条线", async () => {
    expect(await 两边对得上(外条线)).toEqual(["外贸的", "暂不分配的", "没填线外贸人建的"].sort());
  });

  it("销售（不能分配）：没有这一行，新线索页筛出来也是空的", async () => {
    expect(await 数(内销)).toBeNull();
    expect(await 数(外销)).toBeNull();
    expect(await 两边对得上(内销)).toEqual([]);
  });

  it("分走了自动少，一条都不剩 = null（不画），不用谁去关", async () => {
    await prisma.project.updateMany({ where: { name: { in: ["内贸的", "暂不分配的"] } }, data: { awaitAssignAt: null } });
    expect(await 数(内管)).toBeNull();
    expect((await 数(老板))?.条数).toBe(2);
  });
});

describe("「线索分配」开关关着（X-79）：只有系统管理员", () => {
  beforeEach(async () => {
    await setSetting(规则.线索分配.key, false);
    忘掉企业版范围();
  });
  it("系统管理员照样看全部；市场管理、销售管理、条线总管理都没有", async () => {
    expect(await 两边对得上(老板)).toHaveLength(4);
    for (const 谁 of [市场管, 内管, 外管, 外条线]) {
      expect(await 数(谁)).toBeNull();
      expect(await 两边对得上(谁)).toEqual([]);
    }
  });
});

describe("「按组织看客户」开着：可见范围照旧由限定层管，首页的数和新线索页的行还是对得上", () => {
  beforeEach(async () => {
    await setSetting(规则.按组织看客户.key, true);
    // 内贸销售自己建、没分出去的
    await 线索("内贸销售建的", 内销, { bizLine: "内贸" });
    忘掉企业版范围();
  });
  it("内贸销售管理：看得到下属占着的那条，两边一致；系统管理员全看", async () => {
    const 内 = await 两边对得上(内管);
    expect(内).toContain("内贸销售建的");
    expect(内).not.toContain("外贸的");
    expect(await 两边对得上(老板)).toHaveLength(5);
    await 两边对得上(外管);
    await 两边对得上(市场管);
  });
});

describe("铃铛 / 飞书「待分配」提醒的收件人 = 首页那一行数得到这条的人（11-21，P-转-38 / X-79）", () => {
  const 收件人 = async () => (await prisma.entNotice.findMany({ where: { kind: "待分配" } })).map((n) => n.userId).sort();
  const 发 = async (名: string) => {
    const p = await prisma.project.findFirstOrThrow({ where: { name: 名 }, select: { id: true } });
    // 调用方常在 看全部 里：收件人照样按各人的范围算
    await 看全部(async () => 发待分配提醒(await 读组织(), [{ id: p.id, 名 }], "录入的人", "这条业务线没人可分"));
  };

  it("外贸的：外贸销售管理、外贸条线总管理、系统管理员、市场管理（自己建的）收到；内贸销售管理、销售收不到", async () => {
    await 发("外贸的");
    expect(await 收件人()).toEqual([老板.id, 外条线.id, 市场管.id, 外管.id].sort());
  });

  it("内贸的：内贸销售管理收到，外贸销售管理收不到", async () => {
    await 发("内贸的");
    const 们 = await 收件人();
    expect(们).toContain(内管.id);
    expect(们).not.toContain(外管.id);
    expect(们).not.toContain(内销.id);
  });

  it("市场管理只在自己圈里的才收到：外贸销售自己建的那条，市场管理收不到（他的新线索页也不列）", async () => {
    await 发("没填线外贸人建的");
    expect(await 收件人()).toEqual([老板.id, 外条线.id, 外管.id].sort());
  });

  it("批量：一人一条，各人只列自己数得到的那几条", async () => {
    const ps = await prisma.project.findMany({ where: { name: { in: ["内贸的", "外贸的"] } }, select: { id: true, name: true } });
    await 发待分配提醒(await 读组织(), ps.map((p) => ({ id: p.id, 名: p.name })), "录入的人", "没人可分");
    const 们 = await prisma.entNotice.findMany({ where: { kind: "待分配" } });
    const of = (id: string) => 们.filter((n) => n.userId === id);
    expect(of(老板.id)).toHaveLength(1);
    expect(of(老板.id)[0].title).toBe("待分配：2 条新线索没自动分出去");
    expect(of(内管.id)[0].title).toBe("待分配：1 条新线索没自动分出去");
    expect(of(内管.id)[0].body).toMatch(/^内贸的（/);
    expect(of(外管.id)[0].body).toMatch(/^外贸的（/);
  });

  it("「线索分配」开关关着：只有系统管理员", async () => {
    await setSetting(规则.线索分配.key, false);
    忘掉企业版范围();
    await 发("外贸的");
    expect(await 收件人()).toEqual([老板.id]);
  });

  it("已经分走（不在待分配了）的：谁都不发", async () => {
    await prisma.project.updateMany({ where: { name: "外贸的" }, data: { awaitAssignAt: null } });
    await 发("外贸的");
    expect(await 收件人()).toEqual([]);
  });
});

describe("挑不到人标待分配：写不套点击人的写范围（11-21 审查）", () => {
  beforeEach(async () => {
    await setSetting(规则.按组织看客户.key, true);
    // 外贸线没人可自动分：外贸销售、外贸销售管理都不参与
    await setSetting(自动分配不参与key, { [外销.id]: "禁止", [外管.id]: "禁止" });
    忘掉企业版范围();
  });

  it("外贸条线总管理对条线里非下属的新线索点自动分配、挑不到人：照样标上待分配、提醒发出去、话里说已标成", async () => {
    // 外贸销售占着负责人格（不是条线总管理的下属：条线内只读不可写），还没待分配
    const p = await 线索("外贸销售的", 外销, { bizLine: "外贸", awaitAssignAt: null });
    mocks.user = 外条线;
    const r = await 以谁的身份(外条线.id, () => 自动分配线索(p, { 项目: true }));
    expect(r).toMatchObject({ ok: false, 待分配: true, error: expect.stringContaining("已标成待分配") });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p } })).awaitAssignAt).not.toBeNull();
    const 收 = (await prisma.entNotice.findMany({ where: { kind: "待分配" } })).map((n) => n.userId);
    expect(收).toContain(外条线.id);
    expect(收).toContain(老板.id);
  });

  it("标不上（不在线索阶段）：回 false，不发提醒", async () => {
    const p = await 线索("转了的", 外销, { bizLine: "外贸", awaitAssignAt: null, phase: "商机" });
    const org = await 读组织();
    expect(await 以谁的身份(内销.id, () => 标待分配(p, { org, 名: "转了的", 谁建的: "x", 为什么: "没人" }))).toBe(false);
    expect(await prisma.entNotice.count({ where: { kind: "待分配" } })).toBe(0);
  });

  it("点的人写不到这条也标得上（入口已查过能不能分）", async () => {
    const p = await 线索("别人的", 外销, { bizLine: "外贸", awaitAssignAt: null });
    expect(await 以谁的身份(内销.id, () => 标待分配(p, null))).toBe(true);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p } })).awaitAssignAt).not.toBeNull();
  });
});
