/**
 * 零项目客户出公海补潜客培育项目（M-公海-14 + M-公海-08，11-17）：客户公海里允许零项目客户，出来那一刻就得带 1 个潜客培育项目。
 *   - 领取 / 分配公海（公海客户出手）：同一个事务补，负责人 = 领到 / 分到的人、创建人 = 操作人；回收站里有项目的不补；不是企业版不补
 *   - 持有上限：补的这 1 个算进去（核上限之前建），超了整批不领、也不补
 *   - 撤销领取 / 分配（P-撤销-01）：补的项目没动过就整条删、客户回到零项目；动过（记了沟通、编辑过）这一位不撤
 *   - 导入把无主客户换上负责人出公海（enterprise-import/apply.ts 改）：先记待补、整批处理完再补（同批商机行建了项目就不补）；没真出公海、已有项目的不补；
 *     同一批改回占位账号（整批撤回 / 恢复）：补的没动过就删，动过的留下、列进撤回结果
 *   - 回收站恢复客户 / 查重捞回（soft-delete.ts 恢复一条）：回到客户名单、零项目的补；原负责人停用、恢复后进了公海的不补
 * 统计（补零项目客户的脚本建的项目 creatorId = system、createdAt = 客户建档时间）：
 *   - 「新建」类不算它：首页卡本月新增、数据页 新建（走势、按人、本段漏斗）、渠道分档的总线索 / 关联项目（「全部」照算）
 *   - 首页卡暂未跟进：补建的项目客户身上有过沟通（没挂项目的老沟通）就不算暂未跟进；别的项目照旧只看挂在项目上的沟通
 */
import { afterAll, describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 持有数 } from "@/lib/project/db";
import { 默认组织规则 } from "@/lib/project/org-rules";
import { 第一个节点 } from "@/lib/project/nodes";
import { 字典of } from "@/lib/project/stage-dict";
import { 领取, 分配公海, 撤销公海 } from "@/app/(app)/customers/pool-actions";
import { 零项目客户补潜客培育, 潜客培育动没动 } from "@/lib/project/nurture";
import { 改, 读现值, 开现场, type 改的批 } from "@/lib/enterprise-import/apply";
import { 补待补的, 培育行 } from "@/lib/enterprise-import/nurture-rows";
import { 无主入池理由 } from "@/lib/enterprise-import/project-target";
import { 恢复 } from "@/lib/enterprise/soft-delete";
import { 无负责人占位邮箱, 无负责人占位名 } from "@/lib/pool";
import { 首页卡条件 } from "@/lib/project/home-cards";
import { 项目一段 } from "@/app/(app)/overview/project-stats";
import { 补建创建人, 历史分析来源 } from "@/lib/project/system-created";
import { 领取公海项目 } from "@/lib/project/db";
import { 算分期统计, 算看板底数, type 看板项目 } from "@/lib/enterprise/channel-dash";
import type { 统计用项目 } from "@/lib/enterprise/channel-stats";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
let 总管: 人;
let 甲: 人;
let 丙: 人;

const 造人 = async (key: string, name: string, role: string, bizRole: string, active = true): Promise<人> => {
  const u = await prisma.user.create({ data: { email: `${key}@x`, name, title: "", role, password: "x", active } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, ...(bizRole === "sales" ? { line: "内贸" } : {}) } });
  return { id: u.id, name, email: `${key}@x`, role, title: "", avatar: null };
};
const 当 = (u: 人) => { mocks.user = { ...u }; };

let 序号 = 0;
const 客户 = async (ownerId: string) => {
  序号 += 1;
  return (await prisma.customer.create({ data: { name: `客户${序号}`, phone: `139${String(序号).padStart(8, "0")}`, salesOwnerId: ownerId } })).id;
};
const 项目 = async (customerId: string, ownerId: string, extra: Record<string, unknown> = {}) => {
  序号 += 1;
  return (await prisma.project.create({ data: { name: `项目${序号}`, customerId, ownerId, creatorId: ownerId, ...extra } })).id;
};
/** 甲放进客户公海、名下一个项目都没有的客户（丙来领，甲是原负责人领不回） */
const 零项目公海客户 = async () => {
  const c = await 客户(甲.id);
  await prisma.customerPool.create({ data: { customerId: c, userId: 甲.id, reason: "手动" } });
  return c;
};
const 名下项目 = (customerId: string) => prisma.project.findMany({ where: { customerId } });
const 上限 = async (n: number) => {
  await setSetting("orgRules", { ...默认组织规则, 公海: { ...默认组织规则.公海, 持有上限开: true, 默认上限: n } });
  invalidateSettingsCache();
};
const 项目模式 = async (开: boolean) => {
  await setSetting("business", { projectMode: 开 });
  invalidateSettingsCache();
};

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await 项目模式(true);
  总管 = await 造人("boss", "总管某", "ADMIN", "director");
  甲 = await 造人("jia", "销售甲某", "SALES", "sales");
  丙 = await 造人("bing", "销售丙某", "SALES", "sales");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("领取 / 分配公海：零项目客户出公海补潜客培育", () => {
  it("丙领零项目客户：同一个事务补 1 个，负责人、创建人都是丙，落在第一个节点、记一行节点变更；撤销用的 id 回在 带过来.培育", async () => {
    const c = await 零项目公海客户();
    当(丙);
    const r = await 领取([c]);
    if (!r.ok) throw new Error(r.error);
    expect(r.updated).toBe(1);
    const 们 = await 名下项目(c);
    expect(们).toHaveLength(1);
    expect(们[0]).toMatchObject({ ownerId: 丙.id, creatorId: 丙.id, phase: 第一个节点.phase, node: 第一个节点.node, result: null, pooledAt: null });
    expect(await prisma.projectNodeLog.count({ where: { projectId: 们[0].id } })).toBe(1);
    expect(r.带过来?.培育).toEqual([们[0].id]);
    expect(await prisma.customerPool.count({ where: { customerId: c } })).toBe(0);
  });

  it("名下已经有项目（在线索公海里）的不补；回收站里有项目的也不补（算有项目）", async () => {
    const 有 = await 零项目公海客户();
    await 项目(有, 甲.id, { pooledAt: new Date() });
    const 删过 = await 零项目公海客户();
    await 项目(删过, 甲.id, { deletedAt: new Date() });
    当(丙);
    const r = await 领取([有, 删过]);
    if (!r.ok) throw new Error(r.error);
    expect(r.updated).toBe(2);
    expect(await prisma.project.count({ where: { customerId: 有 } })).toBe(1);
    expect(await prisma.project.count({ where: { customerId: 删过 } })).toBe(0);
    expect(r.带过来?.培育).toBeUndefined();
  });

  it("不是企业版（企业版恒开项目模式，团队版没有这条）：照旧领，不补", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    const c = await 零项目公海客户();
    当(丙);
    expect(await 领取([c])).toMatchObject({ ok: true, updated: 1 });
    expect(await prisma.project.count({ where: { customerId: c } })).toBe(0);
  });

  it("总管分给丙：负责人 = 丙、创建人 = 总管", async () => {
    const c = await 零项目公海客户();
    当(总管);
    const r = await 分配公海([c], 丙.id);
    if (!r.ok) throw new Error(r.error);
    const 们 = await 名下项目(c);
    expect(们).toHaveLength(1);
    expect(们[0]).toMatchObject({ ownerId: 丙.id, creatorId: 总管.id });
    expect(r.带过来?.培育).toEqual([们[0].id]);
  });
});

describe("持有上限：补的那 1 个算进去", () => {
  it("名下 2 个、上限 2：领零项目客户 = 要领 1 个，整批不领、也不补", async () => {
    await 上限(2);
    for (let i = 0; i < 2; i++) await 项目(await 客户(丙.id), 丙.id);
    const c = await 零项目公海客户();
    当(丙);
    const r = await 领取([c]);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("这次要领 1 个，最多还能领 0 个");
    expect(await prisma.customerPool.count({ where: { customerId: c } })).toBe(1);
    expect(await prisma.project.count({ where: { customerId: c } })).toBe(0);
    expect(await 持有数(prisma, 丙.id)).toBe(2);
  });

  it("名下 2 个、上限 3：领到，补的那个算进持有数 = 3", async () => {
    await 上限(3);
    for (let i = 0; i < 2; i++) await 项目(await 客户(丙.id), 丙.id);
    const c = await 零项目公海客户();
    当(丙);
    expect(await 领取([c])).toMatchObject({ ok: true, updated: 1 });
    expect(await 持有数(prisma, 丙.id)).toBe(3);
  });

  it("总管分给丙也一样核：丙名下 1 个、上限 1，一个都不分", async () => {
    await 上限(1);
    await 项目(await 客户(丙.id), 丙.id);
    const c = await 零项目公海客户();
    当(总管);
    const r = await 分配公海([c], 丙.id);
    expect(r.ok).toBe(false);
    expect(await prisma.customerPool.count({ where: { customerId: c } })).toBe(1);
    expect(await prisma.project.count({ where: { customerId: c } })).toBe(0);
  });
});

describe("撤销领取 / 分配：补的潜客培育没动过就删", () => {
  it("撤销领取：补的项目连留痕一起删，客户回公海、回到零项目", async () => {
    const c = await 零项目公海客户();
    当(丙);
    const r = await 领取([c]);
    if (!r.ok) throw new Error(r.error);
    const 补的 = r.带过来!.培育![0];
    expect(await 撤销公海("领取", r.原负责人!, r.带过来, undefined, r.公海项目)).toMatchObject({ ok: true, updated: 1 });
    expect(await prisma.customerPool.count({ where: { customerId: c } })).toBe(1);
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: c } })).toMatchObject({ salesOwnerId: 甲.id });
    expect(await prisma.project.count({ where: { customerId: c } })).toBe(0);
    expect(await prisma.projectNodeLog.count({ where: { projectId: 补的 } })).toBe(0);
  });

  it("撤销分配：同样删", async () => {
    const c = await 零项目公海客户();
    当(总管);
    const r = await 分配公海([c], 丙.id);
    if (!r.ok) throw new Error(r.error);
    expect(await 撤销公海("分配", r.原负责人!, r.带过来, r.给谁?.id, r.公海项目)).toMatchObject({ ok: true, updated: 1 });
    expect(await prisma.customerPool.count({ where: { customerId: c } })).toBe(1);
    expect(await prisma.project.count({ where: { customerId: c } })).toBe(0);
  });

  it("补的项目上记过沟通：不撤，客户、项目都留在丙名下，说清为什么", async () => {
    const c = await 零项目公海客户();
    当(丙);
    const r = await 领取([c]);
    if (!r.ok) throw new Error(r.error);
    const 补的 = r.带过来!.培育![0];
    const f = await prisma.followUp.create({ data: { customerId: c, ownerId: 丙.id, type: "PHONE", title: "电话", content: "聊了" } });
    await prisma.followUpProject.create({ data: { followUpId: f.id, projectId: 补的, node: 第一个节点.node } });
    const u = await 撤销公海("领取", r.原负责人!, r.带过来, undefined, r.公海项目);
    expect(u).toEqual({ ok: false, error: "刚补的潜客培育项目已经有人动过（记了沟通、换了节点或编辑过），这次没有撤销" });
    expect(await prisma.customerPool.count({ where: { customerId: c } })).toBe(0);
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: c } })).toMatchObject({ salesOwnerId: 丙.id });
    expect(await prisma.project.findUniqueOrThrow({ where: { id: 补的 } })).toMatchObject({ ownerId: 丙.id });
  });

  it("一起撤两位：一位的项目编辑过不撤，另一位照撤", async () => {
    const a = await 零项目公海客户();
    const b = await 零项目公海客户();
    当(丙);
    const r = await 领取([a, b]);
    if (!r.ok) throw new Error(r.error);
    const a的 = (await 名下项目(a))[0].id;
    await prisma.project.update({ where: { id: a的 }, data: { remark: "改过", updatedAt: new Date(Date.now() + 10_000) } });
    expect(await 撤销公海("领取", r.原负责人!, r.带过来, undefined, r.公海项目)).toMatchObject({ ok: true, updated: 1 });
    expect(await prisma.customerPool.count({ where: { customerId: a } })).toBe(0);
    expect(await prisma.project.count({ where: { customerId: a } })).toBe(1);
    expect(await prisma.customerPool.count({ where: { customerId: b } })).toBe(1);
    expect(await prisma.project.count({ where: { customerId: b } })).toBe(0);
  });

  it("潜客培育动没动：换了节点 / 换了负责人 / 有附件 = 动过；被删进回收站 = 不在了", async () => {
    const c = await 客户(丙.id);
    const 补 = async () => (await prisma.$transaction((tx) => 零项目客户补潜客培育(tx, [c], 丙.id))).get(c)!;
    const 认 = { customerId: c, 负责人: 丙.id, 创建人: 丙.id };
    let p = await 补();
    expect(await prisma.$transaction((tx) => 潜客培育动没动(tx, p, 认))).toBe("没动过");
    await prisma.projectNodeLog.create({ data: { projectId: p, userId: 丙.id, fromPhase: 第一个节点.phase, fromNode: 第一个节点.node, toPhase: 第一个节点.phase, toNode: "线索验证" } });
    expect(await prisma.$transaction((tx) => 潜客培育动没动(tx, p, 认))).toBe("动过");
    await prisma.project.deleteMany({ where: { customerId: c } });
    p = await 补();
    expect(await prisma.$transaction((tx) => 潜客培育动没动(tx, p, { ...认, 负责人: 甲.id }))).toBe("动过");
    await prisma.attachment.create({ data: { projectId: p, name: "a.pdf", mime: "application/pdf", size: 1, sha256: "x", userId: 丙.id } });
    expect(await prisma.$transaction((tx) => 潜客培育动没动(tx, p, 认))).toBe("动过");
    await prisma.attachment.deleteMany({});
    await prisma.project.update({ where: { id: p }, data: { deletedAt: new Date() } });
    expect(await prisma.$transaction((tx) => 潜客培育动没动(tx, p, 认))).toBe("不在了");
  });
});

describe("出公海同时写「客户分配」和补潜客培育（合 #337 后两样都要）", () => {
  const 分配of = async (c: string) => (await prisma.customer.findUniqueOrThrow({ where: { id: c }, select: { assignWay: true } })).assignWay;

  it("两位零项目客户领取：都记公海领取、各补 1 个；撤销时一位的培育项目动过 → 这位整笔不撤（客户分配也留公海领取），另一位客户分配还回原值、补的删掉", async () => {
    const a = await 零项目公海客户();
    const b = await 零项目公海客户();
    await prisma.customer.update({ where: { id: a }, data: { assignWay: "非自持" } });
    await prisma.customer.update({ where: { id: b }, data: { assignWay: "自持" } });
    当(丙);
    const r = await 领取([a, b]);
    if (!r.ok) throw new Error(r.error);
    expect(await 分配of(a)).toBe("公海领取");
    expect(await 分配of(b)).toBe("公海领取");
    expect(r.原负责人).toEqual([{ id: a, 值: 甲.id, 分: "非自持" }, { id: b, 值: 甲.id, 分: "自持" }]);
    expect(r.带过来?.培育).toHaveLength(2);
    const b的 = (await 名下项目(b))[0].id;
    await prisma.project.update({ where: { id: b的 }, data: { remark: "改过", updatedAt: new Date(Date.now() + 10_000) } });
    // 浏览器带回来的（过一遍 JSON）
    const u = await 撤销公海("领取", JSON.parse(JSON.stringify(r.原负责人)), JSON.parse(JSON.stringify(r.带过来)), undefined, r.公海项目);
    expect(u).toMatchObject({ ok: true, updated: 1 });
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: a } })).toMatchObject({ salesOwnerId: 甲.id, assignWay: "非自持" });
    expect(await prisma.customerPool.count({ where: { customerId: a } })).toBe(1);
    expect(await prisma.project.count({ where: { customerId: a } })).toBe(0);
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: b } })).toMatchObject({ salesOwnerId: 丙.id, assignWay: "公海领取" });
    expect(await prisma.customerPool.count({ where: { customerId: b } })).toBe(0);
    expect(await prisma.project.count({ where: { customerId: b } })).toBe(1);
  });
});

describe("导入把无主客户换上负责人出公海（apply.ts 改 + nurture-rows.ts）", () => {
  let 占位: string;
  let 批次: string;
  const 无主客户 = async () => {
    const c = await 客户(占位);
    await prisma.customerPool.create({ data: { customerId: c, userId: 占位, reason: 无主入池理由 } });
    return c;
  };
  const 换 = (c: string, 给: string, 批?: 改的批) =>
    prisma.$transaction(async (tx) => 改(tx, "customer", c, { salesOwnerId: 给 }, (await 读现值(tx, "customer", c))!, new Date().toISOString(), 批));
  const 补完 = () => prisma.$transaction((tx) => 补待补的(tx, 批次, 总管.id));
  beforeEach(async () => {
    占位 = (await prisma.user.create({ data: { email: 无负责人占位邮箱, name: 无负责人占位名, title: "", role: "SALES", password: "x", active: false } })).id;
    批次 = (await prisma.entImportBatch.create({ data: { source: "excel", status: "applying", userId: 总管.id } })).id;
  });

  it("出了公海、零项目：先记待补、不马上建；补待补的 时补 1 个（负责人 = 新负责人、创建人 = 导入的人），那行改成 create 指着新项目", async () => {
    const c = await 无主客户();
    await 换(c, 甲.id, { 批次Id: 批次, 补培育: true });
    expect(await prisma.customerPool.count({ where: { customerId: c } })).toBe(0);
    expect(await prisma.project.count({ where: { customerId: c } })).toBe(0);
    expect(await 补完()).toBe(1);
    const 们 = await 名下项目(c);
    expect(们).toHaveLength(1);
    expect(们[0]).toMatchObject({ ownerId: 甲.id, creatorId: 总管.id, node: 第一个节点.node });
    expect(await prisma.entImportRow.findFirstOrThrow({ where: { batchId: 批次, entity: 培育行 } })).toMatchObject({ kind: "create", externalId: c, targetId: 们[0].id });
  });

  it("同一批后面给这位建了项目（商机行）：补待补的 时不再补，待补那行删掉", async () => {
    const c = await 无主客户();
    await 换(c, 甲.id, { 批次Id: 批次, 补培育: true });
    await 项目(c, 甲.id);
    expect(await 补完()).toBe(0);
    expect(await prisma.project.count({ where: { customerId: c } })).toBe(1);
    expect(await prisma.entImportRow.count({ where: { batchId: 批次, entity: 培育行 } })).toBe(0);
  });

  it("不带补培育（不是项目模式）、名下已有项目、别的原因进的公海（没出来）：都不补", async () => {
    const 没开 = await 无主客户();
    await 换(没开, 甲.id, { 批次Id: 批次, 补培育: false });
    const 有 = await 无主客户();
    await 项目(有, 占位, { pooledAt: new Date() });
    await 换(有, 甲.id, { 批次Id: 批次, 补培育: true });
    const 手动 = await 客户(占位);
    await prisma.customerPool.create({ data: { customerId: 手动, userId: 甲.id, reason: "手动" } });
    await 换(手动, 甲.id, { 批次Id: 批次, 补培育: true });
    await 补完();
    expect(await prisma.project.count({ where: { customerId: 没开 } })).toBe(0);
    expect(await prisma.project.count({ where: { customerId: 有 } })).toBe(1);
    expect(await prisma.customerPool.count({ where: { customerId: 手动 } })).toBe(1);
    expect(await prisma.project.count({ where: { customerId: 手动 } })).toBe(0);
  });

  it("同一批改回占位账号（撤回 / 恢复回公海）：补的没动过就删、那行也删；动过的留在原负责人名下、名字回在 留下培育", async () => {
    const 没动 = await 无主客户();
    const 动了 = await 无主客户();
    for (const c of [没动, 动了]) await 换(c, 甲.id, { 批次Id: 批次, 补培育: true });
    await 补完();
    const 动了的 = (await 名下项目(动了))[0];
    await prisma.projectNodeLog.create({ data: { projectId: 动了的.id, userId: 甲.id, fromPhase: 第一个节点.phase, fromNode: 第一个节点.node, toPhase: 第一个节点.phase, toNode: "线索验证" } });
    const 批: 改的批 = { 批次Id: 批次, 补培育: true };
    for (const c of [没动, 动了]) await 换(c, 占位, 批);
    expect(await prisma.customerPool.count({ where: { customerId: { in: [没动, 动了] } } })).toBe(2);
    expect(await prisma.project.count({ where: { customerId: 没动 } })).toBe(0);
    expect(await prisma.project.findUniqueOrThrow({ where: { id: 动了的.id } })).toMatchObject({ ownerId: 甲.id });
    expect(批.留下培育).toEqual([动了的.name]);
    expect(await prisma.entImportRow.findMany({ where: { batchId: 批次, entity: 培育行 }, select: { externalId: true, undo: true } })).toEqual([{ externalId: 动了, undo: "留下" }]);
  });

  it("别的批补的不归这一批收：换回占位时不动", async () => {
    const c = await 无主客户();
    await 换(c, 甲.id, { 批次Id: 批次, 补培育: true });
    await 补完();
    const 别批 = (await prisma.entImportBatch.create({ data: { source: "excel", status: "applying" } })).id;
    await 换(c, 占位, { 批次Id: 别批, 补培育: true });
    expect(await prisma.project.count({ where: { customerId: c } })).toBe(1);
  });

  it("开现场：企业版（项目模式）才带 补培育", async () => {
    const 用户 = { id: 总管.id, name: 总管.name };
    expect((await 开现场("", "excel" as never, {} as never, 用户)).补培育).toBe(true);
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect((await 开现场("", "excel" as never, {} as never, 用户)).补培育).toBe(false);
  });
});

describe("回收站恢复客户 / 查重捞回（恢复一条）", () => {
  const 删 = (c: string, at = new Date()) => prisma.customer.update({ where: { id: c }, data: { deletedAt: at } });

  it("恢复回到客户名单、零项目：补 1 个，负责人跟客户、创建人 = 恢复的人", async () => {
    const c = await 客户(甲.id);
    await 删(c);
    expect(await 恢复({ id: 总管.id, role: "ADMIN" }, "Customer", c)).toMatchObject({ ok: true });
    const 们 = await 名下项目(c);
    expect(们).toHaveLength(1);
    expect(们[0]).toMatchObject({ ownerId: 甲.id, creatorId: 总管.id });
  });

  it("回收站里还有更早单独删的项目：算有项目，不补", async () => {
    const c = await 客户(甲.id);
    await 项目(c, 甲.id, { deletedAt: new Date(Date.now() - 60_000) });
    await 删(c);
    expect(await 恢复({ id: 总管.id, role: "ADMIN" }, "Customer", c)).toMatchObject({ ok: true });
    expect(await prisma.project.count({ where: { customerId: c } })).toBe(0);
  });

  it("原负责人已停用、恢复后进了客户公海：不补（公海里能零项目）", async () => {
    await prisma.user.create({ data: { email: 无负责人占位邮箱, name: 无负责人占位名, title: "", role: "SALES", password: "x", active: false } });
    const 离职 = await 造人("left", "离职某", "SALES", "sales", false);
    const c = await 客户(离职.id);
    await 删(c);
    const r = await 恢复({ id: 总管.id, role: "ADMIN" }, "Customer", c);
    expect(r).toMatchObject({ ok: true, 停用负责人: { 进了公海: true } });
    expect(await prisma.customerPool.count({ where: { customerId: c } })).toBe(1);
    expect(await prisma.project.count({ where: { customerId: c } })).toBe(0);
  });
});

describe("统计：补建的项目（creatorId = system）不算新建；暂未跟进看客户身上的沟通", () => {
  const 今 = new Date();
  const 字典 = 字典of(true);
  const 数 = (where: object) => prisma.project.count({ where });

  it("首页卡本月新增：补建的不算，同月别人建的照算", async () => {
    const c = await 客户(甲.id);
    await 项目(c, 甲.id);
    await 项目(c, 甲.id, { creatorId: 补建创建人 });
    expect(await 数(首页卡条件("month-new", 默认组织规则, 字典, 今))).toBe(1);
  });

  it("数据页 新建（走势、合计、按人）：补建的不算；转商机这类照常", async () => {
    const c = await 客户(甲.id);
    await 项目(c, 甲.id);
    await 项目(c, 甲.id, { creatorId: 补建创建人 });
    const 起 = new Date(今.getTime() - 86_400_000);
    const r = await 项目一段(起, new Date(今.getTime() + 86_400_000), "day", "CNY");
    expect(r.合计.新建).toBe(1);
    expect(r.trend.reduce((s, b) => s + b.新建, 0)).toBe(1);
    expect(r.按人.find((x) => x.id === 甲.id)?.新建).toBe(1);
  });

  it("暂未跟进：补建的客户身上有沟通 → 不算；客户没沟通 / 沟通在回收站 → 算；普通项目照旧只看挂在项目上的", async () => {
    const 有沟通 = await 客户(甲.id);
    await prisma.followUp.create({ data: { customerId: 有沟通, ownerId: 甲.id, type: "PHONE", title: "老沟通", content: "导入的" } });
    const 补建有沟通 = await 项目(有沟通, 甲.id, { creatorId: 补建创建人 });
    const 普通客户沟通 = await 项目(有沟通, 甲.id);
    const 没沟通 = await 客户(甲.id);
    const 补建没沟通 = await 项目(没沟通, 甲.id, { creatorId: 补建创建人 });
    const 删了的 = await 客户(甲.id);
    await prisma.followUp.create({ data: { customerId: 删了的, ownerId: 甲.id, type: "PHONE", title: "删了", content: "x", deletedAt: new Date() } });
    const 补建沟通删了 = await 项目(删了的, 甲.id, { creatorId: 补建创建人 });
    const 挂了 = await 客户(甲.id);
    const 普通挂了沟通 = await 项目(挂了, 甲.id);
    const f = await prisma.followUp.create({ data: { customerId: 挂了, ownerId: 甲.id, type: "PHONE", title: "挂项目", content: "x" } });
    await prisma.followUpProject.create({ data: { followUpId: f.id, projectId: 普通挂了沟通, node: 第一个节点.node } });
    const 列 = (await prisma.project.findMany({ where: 首页卡条件("no-follow", 默认组织规则, 字典, 今, [甲.id]), select: { id: true } })).map((p) => p.id).sort();
    expect(列).toEqual([普通客户沟通, 补建没沟通, 补建沟通删了].sort());
    expect(列).not.toContain(补建有沟通);
  });

  it("渠道分档：补建的不进本月总线索 / 关联项目，「全部」照算", () => {
    const 现在 = new Date("2026-11-17T04:00:00Z");
    const 本月 = new Date("2026-11-05T04:00:00Z");
    const 看板行 = (补建: boolean): 看板项目 => ({ channelId: "ch", phase: "线索", result: null, amount: 0, currency: "CNY", createdAt: 本月, 判定: null, 节点们: [], ...(补建 ? { 补建 } : {}) });
    const 板 = 算看板底数(["ch"], [看板行(false), 看板行(true)], [], 现在);
    expect(板.本月.ch.线索).toBe(1);
    expect(板.全部.ch.线索).toBe(2);
    const 列行 = (补建: boolean): 统计用项目 => ({ channelId: "ch", phase: "线索", result: null, amount: 0, currency: "CNY", createdAt: 本月, ...(补建 ? { 补建 } : {}) });
    const 列 = 算分期统计([{ id: "ch", createdAt: new Date("2026-01-01T00:00:00Z"), endDate: null }], [列行(false), 列行(true)], [], 现在);
    expect(列.本月.ch.关联项目).toBe(1);
    expect(列.全部.ch.关联项目).toBe(2);
  });
});

describe("历史分析回填（11-18，M-公海-14「领走补一个能推进的项目」；已结束的照 M-公海-02 / P-公海-02 随客户走）", () => {
  const 回填 = (customerId: string, extra: Record<string, unknown>) =>
    项目(customerId, "", { source: 历史分析来源, creatorId: 补建创建人, pooledAt: new Date(), ...extra });

  it("名下只有已结束的历史分析项目：领走时已结束的随客户一起出公海归丙，另补 1 个潜客培育；撤销时补的删掉、已结束的回公海", async () => {
    const c = await 零项目公海客户();
    const 流 = await 回填(c, { phase: "线索", node: "潜客培育", result: "线索流失", closedAt: new Date("2023-01-01") });
    const 丢 = await 回填(c, { phase: "商机", node: "共识方案", result: "丢单", closedAt: new Date("2024-01-01") });
    当(丙);
    const r = await 领取([c]);
    if (!r.ok) throw new Error(r.error);
    const 们 = await 名下项目(c);
    expect(们).toHaveLength(3);
    const 新 = 们.find((p) => ![流, 丢].includes(p.id))!;
    expect(新).toMatchObject({ ownerId: 丙.id, creatorId: 丙.id, phase: 第一个节点.phase, node: 第一个节点.node, result: null, pooledAt: null, source: null });
    // 已结束的不是单独领的：随客户整包出公海（带走公海项目），结局不动
    for (const id of [流, 丢]) expect(们.find((p) => p.id === id)).toMatchObject({ ownerId: 丙.id, pooledAt: null, source: 历史分析来源 });
    expect(们.find((p) => p.id === 流)?.result).toBe("线索流失");
    expect(r.带过来?.培育).toEqual([新.id]);
    // 持有数只算补的这 1 个（已结束的不算）
    expect(await 持有数(prisma, 丙.id)).toBe(1);
    expect(await 撤销公海("领取", r.原负责人!, r.带过来, undefined, r.公海项目)).toMatchObject({ ok: true, updated: 1 });
    expect((await 名下项目(c)).map((p) => p.id).sort()).toEqual([流, 丢].sort());
    expect(await prisma.customerPool.count({ where: { customerId: c } })).toBe(1);
  });

  it("名下有还在推的历史分析项目（没结局）：领走它就是能推进的，不补", async () => {
    const c = await 零项目公海客户();
    await 回填(c, { phase: "线索", node: "潜客培育", result: "线索流失" });
    await 回填(c, { phase: "商机", node: "明确需求" });
    当(丙);
    const r = await 领取([c]);
    if (!r.ok) throw new Error(r.error);
    expect(await prisma.project.count({ where: { customerId: c } })).toBe(2);
    expect(r.带过来?.培育).toBeUndefined();
  });

  it("名下有正常建的已结束项目：照旧算有项目、不补（只对历史分析回填的放宽）", async () => {
    const c = await 零项目公海客户();
    await 项目(c, 甲.id, { result: "线索流失", pooledAt: new Date() });
    await 回填(c, { phase: "线索", node: "潜客培育", result: "线索流失" });
    当(丙);
    const r = await 领取([c]);
    if (!r.ok) throw new Error(r.error);
    expect(await prisma.project.count({ where: { customerId: c } })).toBe(2);
    expect(r.带过来?.培育).toBeUndefined();
  });

  it("已结束的历史分析项目不能单独领（P-公海-02 / X-70），要领走客户整包", async () => {
    const c = await 零项目公海客户();
    const 流 = await 回填(c, { phase: "线索", node: "潜客培育", result: "线索流失" });
    当(丙);
    const r = await 领取公海项目(丙, 流);
    expect(r.ok).toBe(false);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 流 } })).pooledAt).not.toBeNull();
  });

  it("分配公海同样补（总管把只有已结束历史分析项目的客户分给丙）", async () => {
    const c = await 零项目公海客户();
    await 回填(c, { phase: "商机", node: "共识方案", result: "丢单" });
    当(总管);
    const r = await 分配公海([c], 丙.id);
    if (!r.ok) throw new Error(r.error);
    const 们 = await 名下项目(c);
    expect(们).toHaveLength(2);
    expect(们.filter((p) => !p.result)).toEqual([expect.objectContaining({ ownerId: 丙.id, creatorId: 总管.id, node: 第一个节点.node, source: null })]);
  });
});

// 跑完清库（同 beforeEach 那套 resetDb）：附件不挂外键，留在共享 test.db 会绊倒后面从它拷库、自带清库清单的用例
afterAll(async () => { await resetDb(); });
