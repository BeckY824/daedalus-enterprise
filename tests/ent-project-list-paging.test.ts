/**
 * 项目列表服务端分页（11-11）：原来一次取最近改过的 500 条、筛选的一部分和排序在内存里做，超过 500 条看不全。
 *   - 总数 = 全部符合条件的条数，各页相加 = 总数，无重复、无遗漏；页码越界落到最后一页
 *   - 排序（创建时间、预计成交、负责人）在服务端对全部结果做，跨页连续，同值按默认序（最近改过在前）、主键兜底
 *   - 各角色（系统管理员、总管理、销管、销售、市场管理、市场成员）看到的集合和旧实现（tests/project-list-old.ts）逐条一致：
 *     ≤ 500 条时每一行、每一格、顺序都一样；旧的取到 500 上限时，旧的那几行按原顺序都在新的里
 *   - 原来在内存里滤的几道（客户不露时按客户名搜、按号码筛、按客户来源算渠道不算中；收回次数；3 天内回公海）挪到服务端后照样生效
 *   - 看板列头的数和金额按全部算；渠道页数字 = 点进去项目列表的服务端总数（超过 500 也对得上）
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "a@x", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 市场成员key } from "@/lib/enterprise/market";
import { 读项目列表, 认每页, 认项目排序 } from "@/lib/project/list";
import { 看板分列, type 项目行 } from "@/lib/project/board";
import { 字典of } from "@/lib/project/stage-dict";
import { 按预计成交排 } from "@/lib/project/project-fields";
import { 读渠道统计 } from "@/lib/enterprise/channel-stats-db";
import { 名单链接, 名单键们, type 名单键 } from "@/lib/enterprise/channel-stats";
import { 存组织规则 } from "@/lib/project/org-rules-store";
import { 默认组织规则 } from "@/lib/project/org-rules";
import { dayjs } from "@/lib/utils";
import { 旧读项目列表 } from "./project-list-old";

type 人 = { id: string; name: string; role: string };
const 人们: Record<string, 人> = {};
let A = "", B = "";
const 甲客: { id: string; phone: string }[] = [];
const 乙客: { id: string; phone: string }[] = [];
const 总条数 = 620;
const 现在 = Date.now();
const 第几个建的 = (i: number) => new Date(现在 - (总条数 - i) * 3600_000);

const 设身份 = (谁: 人) => { mocks.user = { ...mocks.user, id: 谁.id, name: 谁.name, role: 谁.role }; };
const 新 = (谁: 人, sp: Record<string, string>, 只看阶段?: "线索") => { 设身份(谁); return 以谁的身份(谁.id, () => 读项目列表(谁, sp, 只看阶段)); };
const 旧 = (谁: 人, sp: Record<string, string>, 只看阶段?: "线索") => { 设身份(谁); return 以谁的身份(谁.id, () => 旧读项目列表(谁, sp, 只看阶段)); };

/** 一页一页翻到底：各页拼起来、每页的总数都一样，页数 = ceil(总数 / 每页) */
async function 翻到底(谁: 人, sp: Record<string, string>, 每页 = 100, 只看阶段?: "线索"): Promise<{ 行: 项目行[]; 总数: number }> {
  const 第一页 = await 新(谁, { ...sp, page: "1", pageSize: String(每页) }, 只看阶段);
  const 行 = [...第一页.行];
  const 页数 = Math.max(1, Math.ceil(第一页.总数 / 每页));
  for (let p = 2; p <= 页数; p++) {
    const d = await 新(谁, { ...sp, page: String(p), pageSize: String(每页) }, 只看阶段);
    expect(d.总数).toBe(第一页.总数);
    expect(d.页).toBe(p);
    expect(d.行.length).toBe(p < 页数 ? 每页 : 第一页.总数 - (页数 - 1) * 每页);
    行.push(...d.行);
  }
  expect(行.length, "各页之和 = 总数").toBe(第一页.总数);
  expect(new Set(行.map((r) => r.id)).size, "无重复").toBe(行.length);
  return { 行, 总数: 第一页.总数 };
}

/** 旧的（≤ 500 条）和新的逐条一样；旧的取到上限时，旧的那几行按原顺序是新的子序列 */
async function 对拍(谁: 人, sp: Record<string, string>, 只看阶段?: "线索") {
  const o = await 旧(谁, sp, 只看阶段);
  const n = await 翻到底(谁, sp, 100, 只看阶段);
  const 名 = `${谁.name} ${JSON.stringify(sp)}`;
  if (!o.取到上限) {
    expect(n.行, 名).toEqual(o.行);
  } else {
    const 位 = new Map(n.行.map((r, i) => [r.id, i]));
    const 旧位 = o.行.map((r) => 位.get(r.id));
    expect(旧位.every((x) => x !== undefined), 名).toBe(true);
    expect([...旧位].sort((a, b) => a! - b!), 名).toEqual(旧位);
  }
  return { o, n };
}

/** 旧界面在浏览器里排（antd：降序 = 比较结果取反，稳定排序，同值保持默认的最近改过在前） */
const 旧比较: Record<string, (a: 项目行, b: 项目行, 降: boolean) => number> = {
  created: (a, b, 降) => (降 ? -1 : 1) * (a.createdAt ?? "").localeCompare(b.createdAt ?? ""),
  deal: (a, b, 降) => (降 ? -1 : 1) * 按预计成交排(a.expectedDealAt, b.expectedDealAt, 降),
  owner: (a, b, 降) => (降 ? -1 : 1) * a.ownerName.localeCompare(b.ownerName, "zh-CN"),
};
const 旧排 = (行: 项目行[], sort: string) => {
  const [键, 向] = sort.split("-");
  return [...行].sort((a, b) => 旧比较[键](a, b, 向 === "desc"));
};
const 排序们 = ["created-asc", "created-desc", "deal-asc", "deal-desc", "owner-asc", "owner-desc"];

beforeAll(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  const 建人 = async (名: string, role: string, bizRole: string, managerId?: string) => {
    const id = (await prisma.user.create({ data: { email: `${名}@t`, name: 名, title: "", role, password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: id, bizRole, ...(managerId ? { managerId } : {}) } });
    人们[名] = { id, name: 名, role };
  };
  await 建人("系统管理员", "ADMIN", "admin");
  await 建人("总管理", "SALES", "director");
  await 建人("销管", "SALES", "sales_mgr");
  await 建人("销售甲", "SALES", "sales", 人们.销管.id);
  await 建人("销售乙", "SALES", "sales");
  await 建人("市场管理", "SALES", "marketing_mgr");
  await 建人("市场成员", "SALES", "channel_ops", 人们.市场管理.id);
  await setSetting("business", { projectMode: true });
  await setSetting("enterprise.rule.org_scope", true);
  await setSetting(市场成员key, [人们.市场成员.id]);
  invalidateSettingsCache();
  忘掉企业版范围();

  const 主 = (await prisma.entChannelMain.create({ data: { name: "线上" } })).id;
  A = (await prisma.channel.create({ data: { name: "线上|甲号", platform: "线上", mainId: 主, channelOwnerId: 人们.系统管理员.id } })).id;
  B = (await prisma.channel.create({ data: { name: "线上|乙号", platform: "线上", mainId: 主, channelOwnerId: 人们.系统管理员.id } })).id;
  for (let k = 0; k < 40; k++) {
    const p1 = `1391000${String(k).padStart(4, "0")}`;
    甲客.push({ id: (await prisma.customer.create({ data: { name: `甲方客户${k}`, phone: p1, salesOwnerId: 人们.销售甲.id, channelId: A } })).id, phone: p1 });
    const p2 = `1392000${String(k).padStart(4, "0")}`;
    乙客.push({ id: (await prisma.customer.create({ data: { name: `乙方客户${k}`, phone: p2, salesOwnerId: 人们.销售乙.id, channelId: k % 4 === 3 ? B : A } })).id, phone: p2 });
  }
  const 位置们 = [
    ["线索", "潜客培育", null], ["线索", "线索验证", null], ["商机", "痛点挖掘", null], ["商机", "方案敲定", null],
    ["订单", "生产备货", null], ["线索", "潜客培育", "线索流失"], ["商机", "成交推进", "丢单"], ["订单", "尾款结算", "交付结清"],
  ] as const;
  const 级别们 = ["S", "A", "B", "C", null];
  const 数据 = Array.from({ length: 总条数 }, (_, i) => {
    // 0–239 甲负责、甲的客户；240–499 乙；500–539 甲负责、乙的客户（销管看得到项目、看不到客户）；
    // 540–579 市场成员建给乙；580–599 市场成员建给甲；600–619 在公海（负责人空、乙的客户）
    const 段 = i < 240 ? "甲" : i < 500 ? "乙" : i < 540 ? "甲跨" : i < 580 ? "市乙" : i < 600 ? "市甲" : "公海";
    const ownerId = 段 === "甲" || 段 === "甲跨" || 段 === "市甲" ? 人们.销售甲.id : 段 === "公海" ? "" : 人们.销售乙.id;
    const creatorId = 段.startsWith("市") ? 人们.市场成员.id : 段 === "公海" ? 人们.销售乙.id : ownerId;
    const customerId = 段 === "甲" || 段 === "市甲" ? 甲客[i % 40].id : 乙客[i % 40].id;
    const [phase, node, result] = 位置们[i % 位置们.length];
    return {
      name: `项目${i}`, customerId, ownerId, creatorId, phase, node, result,
      channelId: i % 10 === 0 ? B : i % 10 === 1 ? null : A,
      amount: i * 10, currency: i % 7 === 0 ? "USD" : "CNY",
      level: 级别们[i % 级别们.length],
      expectedDealAt: i % 4 === 0 ? null : new Date(Date.UTC(2026, 11, 1 + (i % 28))),
      createdAt: 第几个建的(i),
      // 最近改过：打乱的一个排列（7919 和 620 互素），和建的先后不一样
      updatedAt: new Date(现在 - ((i * 7919) % 总条数) * 60_000),
      ...(段 === "公海" ? { pooledAt: new Date(现在 - i * 1000) } : {}),
    };
  });
  await prisma.project.createMany({ data: 数据 });
  // 公海里一半被收回过（放回公海的留痕），收回次数 0 / 1 两档都有
  const 公海 = await prisma.project.findMany({ where: { pooledAt: { not: null } }, select: { id: true }, orderBy: { name: "asc" } });
  await prisma.projectNodeLog.createMany({ data: 公海.filter((_, k) => k % 2 === 0).map((p) => ({ projectId: p.id, userId: 人们.销售乙.id, toPhase: "线索", toNode: "潜客培育", kind: "pool-release", fromOwnerId: 人们.销售乙.id })) });
  // 先读一遍：回填一次、超时回收这些「读的时候顺手做的」先做完，后面新旧两边看的是同一份
  await 新(人们.总管理, {});
}, 120_000);
afterAll(async () => {
  vi.unstubAllEnvs();
  忘掉企业版范围();
  await prisma.$disconnect();
});

const 角色们 = ["系统管理员", "总管理", "销管", "销售甲", "销售乙", "市场管理", "市场成员"];

describe("参数", () => {
  it("每页 10–100、默认 20；排序只认六种，别的当默认", () => {
    expect([认每页(undefined), 认每页("5"), 认每页("50"), 认每页("500"), 认每页("abc"), 认每页("-1")]).toEqual([20, 10, 50, 100, 20, 20]);
    expect(认项目排序("owner-desc")).toBe("owner-desc");
    expect(认项目排序("updatedAt")).toBe("");
  });
});

describe("超过 500 条：总数、翻页、排序", () => {
  it("总管理看全部 600 个不在公海的：总数对、各页之和 = 总数、无重复无遗漏；页码越界落到最后一页", async () => {
    const 全 = await 翻到底(人们.总管理, {}, 20);
    expect(全.总数).toBe(600);
    expect(new Set(全.行.map((r) => r.name))).toEqual(new Set(Array.from({ length: 600 }, (_, i) => `项目${i}`)));
    // 默认最近改过在前
    expect(全.行.map((r) => r.updatedAt)).toEqual([...全.行.map((r) => r.updatedAt)].sort().reverse());
    const 越界 = await 新(人们.总管理, { page: "999", pageSize: "50" });
    expect([越界.页, 越界.要的页, 越界.行.length]).toEqual([12, "999", 50]);
    expect(越界.行.map((r) => r.id)).toEqual(全.行.slice(550).map((r) => r.id));
  });

  it("每种排序在全部结果里排、跨页连续：等于把全部按旧界面的比法稳定排一遍", async () => {
    const 默认 = (await 翻到底(人们.总管理, {}, 100)).行;
    for (const sort of 排序们) {
      const 排后 = await 翻到底(人们.总管理, { sort }, 30);
      expect(排后.行.map((r) => r.id), sort).toEqual(旧排(默认, sort).map((r) => r.id));
      expect((await 新(人们.总管理, { sort })).排序).toBe(sort);
    }
    // 排序带着筛选一起：负责人倒序 + 渠道 + 阶段
    const 筛 = { channelId: A, phase: "商机" };
    const 筛后默认 = (await 翻到底(人们.总管理, 筛, 100)).行;
    expect((await 翻到底(人们.总管理, { ...筛, sort: "owner-desc" }, 10)).行.map((r) => r.id)).toEqual(旧排(筛后默认, "owner-desc").map((r) => r.id));
  });

  it("看板：列头的数和金额按全部算（不是这一页），卡片只是这一页", async () => {
    const d = await 新(人们.总管理, { pageSize: "20" });
    const 全 = (await 翻到底(人们.总管理, {}, 100)).行;
    const 字典 = 字典of(true);
    const 按页 = 看板分列(d.行, 字典, undefined, d.看板合计);
    const 按全部 = 看板分列(全, 字典);
    expect(按页.map((c) => [c.列, c.数, c.合计])).toEqual(按全部.map((c) => [c.列, c.数, c.合计]));
    expect(按页.flatMap((c) => c.行).length).toBe(20);
    expect(按页.reduce((n, c) => n + c.数, 0)).toBe(600);
  });

  it("系统管理员（600 条，旧的取到 500 上限）：旧的 500 条按原顺序都在新的里，前 500 条一模一样", async () => {
    const { o, n } = await 对拍(人们.系统管理员, {});
    expect(o.取到上限).toBe(true);
    expect(n.总数).toBe(600);
    expect(n.行.slice(0, 500)).toEqual(o.行);
  });
});

describe("各角色可见集合和旧实现逐条一致（≤ 500 条）", () => {
  const 筛选们 = (): Record<string, string>[] => [
    {},
    { keyword: "乙方客户1" },
    { keyword: "项目12" },
    { channelId: A },
    { channelId: B },
    { phone: 乙客[3].phone },
    { phone: 甲客[5].phone },
    { phase: "商机" },
    { phase: "线索", node: "线索流失" },
    { createdFrom: dayjs(第几个建的(100)).format("YYYY-MM-DD"), createdTo: dayjs(第几个建的(300)).format("YYYY-MM-DD") },
    { ownerId: 人们.销售甲.id },
    { level: "S" },
    { level: "未分级" },
    { f: "month-new" },
    { f: "key" },
    { f: "month-new", keyword: "乙方客户2" },
    { pool: "1" },
    { pool: "1", recycled: "0" },
    { pool: "1", recycled: "1" },
    // 组合：渠道 + 阶段 + 创建时间 + 手机号 + 负责人
    { channelId: A, phase: "线索", createdFrom: dayjs(第几个建的(0)).format("YYYY-MM-DD"), phone: 甲客[2].phone, ownerId: 人们.销售甲.id },
    { channelId: A, phase: "商机", keyword: "乙方客户", ownerId: 人们.销售甲.id },
  ];
  for (const 谁 of 角色们) {
    it(`${谁}`, async () => {
      for (const sp of 筛选们()) {
        if (谁 === "系统管理员" && !Object.keys(sp).length) continue; // 600 条那条上面单测
        await 对拍(人们[谁], sp);
      }
      // 企业版新线索页（只看线索阶段）
      await 对拍(人们[谁], {}, "线索");
    }, 120_000);
  }

  it("排序：≤ 500 条的角色，服务端排出来的 = 旧界面在那一页里排的", async () => {
    for (const 谁 of ["销管", "销售乙", "市场管理"]) {
      const o = await 旧(人们[谁], {});
      expect(o.取到上限).toBe(false);
      for (const sort of 排序们) expect((await 翻到底(人们[谁], { sort }, 25)).行, `${谁} ${sort}`).toEqual(旧排(o.行, sort));
    }
  }, 120_000);
});

describe("原来在内存里滤的几道，挪到服务端照样生效", () => {
  it("销管看得到甲负责的项目、看不到乙的客户：按乙的客户名 / 号码 / 客户来源都不算中，但项目名、项目自己选的渠道照常", async () => {
    const 销管 = 人们.销管;
    // 500–539：甲负责、乙的客户
    const 跨 = (await 翻到底(销管, { keyword: "项目52" })).行;
    expect(跨.map((r) => r.name).sort()).toEqual(["项目52", ...Array.from({ length: 10 }, (_, k) => `项目52${k}`)].sort());
    expect(跨.find((r) => r.name === "项目520")?.customerName).toBeNull();
    expect((await 翻到底(销管, { keyword: "乙方客户" })).总数).toBe(0);
    expect((await 翻到底(销管, { phone: 乙客[3].phone })).总数).toBe(0);
    // 渠道：项目没选、跟客户来源的（i % 10 = 1）不算；项目自己选了 A 的照算
    const 渠道A = (await 翻到底(销管, { channelId: A })).行.map((r) => Number(r.name.slice(2)));
    expect(渠道A.filter((i) => i >= 500 && i < 540 && i % 10 === 1)).toEqual([]);
    expect(渠道A.filter((i) => i >= 500 && i < 540).length).toBe(32);
    // 销售甲自己负责：客户不归他也露（露客户：不在公海、负责人是我），按客户名、客户来源照算中；
    // 按号码不算中（11-12 堵口子：输个号码看自己的项目留不留，就试得出看不到的客户的电话）
    expect((await 翻到底(人们.销售甲, { keyword: "乙方客户3" })).行.map((r) => r.name)).toContain("项目523");
    expect((await 翻到底(人们.销售甲, { phone: 乙客[3].phone })).总数).toBe(0);
    // 客户是自己的：号码照常算中
    expect((await 翻到底(人们.销售甲, { phone: 甲客[5].phone })).总数).toBeGreaterThan(0);
  });

  it("收回次数（项目公海）：服务端数完再分页，总数对", async () => {
    const 零 = await 翻到底(人们.总管理, { pool: "1", recycled: "0" }, 10);
    const 一 = await 翻到底(人们.总管理, { pool: "1", recycled: "1" }, 10);
    expect([零.总数, 一.总数]).toEqual([10, 10]);
    expect(零.行.every((r) => r.收回次数 === 0) && 一.行.every((r) => r.收回次数 === 1)).toBe(true);
  });

});

describe("渠道页数字 = 点进去的项目列表总数（超过 500 也对得上）", () => {
  const 键们 = Object.keys(名单键们) as 名单键[];
  it("总管理（渠道 A 超过 500 条）、销管、销售乙、市场成员", async () => {
    for (const 谁 of ["总管理", "销管", "销售乙", "市场成员"]) {
      const u = 人们[谁];
      设身份(u);
      const 统 = await 以谁的身份(u.id, () => 读渠道统计([A, B].map((id) => ({ id, createdAt: new Date("2026-01-01T00:00:00Z"), endDate: null })), new Date(), u));
      for (const ch of [A, B]) {
        for (const 键 of 键们) {
          const sp = Object.fromEntries(new URL(名单链接(ch, 键), "http://x").searchParams);
          expect(统[ch].名单![键].列表, `${谁} ${ch === A ? "A" : "B"} ${键}`).toBe((await 新(u, sp)).总数);
        }
      }
      if (谁 === "总管理") expect(统[A].名单!.关联项目.列表).toBeGreaterThan(500);
    }
  }, 120_000);
});

// 放最后：开了超时回收，读列表时会先把超时的收进公海（改数据）
describe("3 天内回公海", () => {
  it("3 天内回公海（f=due-soon）：取回候选逐个算、再分页；和旧实现一致", async () => {
    await 存组织规则({ ...默认组织规则, 超时回收: { 开: true, 起算日: null, 节点天数: {} } });
    // 建项目 5 天前、最近没动的线索 / 商机：7 天默认时长，回收日在 2 天后
    // 一个一个改、各给一个最近改过的时刻：同一刻的几行旧实现（只按最近改过排）谁先谁后不定，对拍不了
    for (const [k, name] of ["项目0", "项目1", "项目3", "项目250"].entries()) {
      await prisma.project.updateMany({ where: { name }, data: { createdAt: new Date(现在 - 5 * 86400_000), updatedAt: new Date(现在 + k * 1000) } });
    }
    try {
      for (const 谁 of ["总管理", "销售甲", "销管"]) {
        const { o, n } = await 对拍(人们[谁], { f: "due-soon" });
        expect(o.取到上限).toBe(false);
        expect(n.总数).toBe(o.行.length);
      }
      expect((await 翻到底(人们.总管理, { f: "due-soon" }, 10)).行.map((r) => r.name).sort()).toEqual(expect.arrayContaining(["项目0", "项目1", "项目3", "项目250"]));
    } finally {
      await 存组织规则(默认组织规则);
    }
  });
});
