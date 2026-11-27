/**
 * 回填脚本和对拍脚本的逻辑（E-417 包 1）：scripts/pool-prev-owner-backfill.ts、scripts/pool-prev-owner-compare.ts 只管开关和打印，
 * 规矩在 src/lib/enterprise/pool-prev-owner-backfill.ts、pool-prev-owner-compare.ts。
 *   - dry（只算计划 + 出三张表）不写库；真写后值对；再跑一次没有变化（重复跑）
 *   - 回填后对拍 0 不一致；列被改坏（含「为空」这个坑）对拍报得出
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma, defaultClient as raw } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 无负责人占位Id } from "@/lib/no-owner-db";
import { 算回填计划, 写回填, 汇总表, 动作of } from "@/lib/enterprise/pool-prev-owner-backfill";
import { 对拍 } from "@/lib/enterprise/pool-prev-owner-compare";

let 序号 = 0;
const 人 = async (key: string) => (await raw.user.create({ data: { email: `${key}@x`, name: key, title: "", role: "SALES", password: "x" } })).id;
const 客户 = async (ownerId: string, 进公海?: Date) => {
  序号 += 1;
  const c = await raw.customer.create({ data: { name: `客户${序号}`, phone: `139${String(序号).padStart(8, "0")}`, salesOwnerId: ownerId } });
  if (进公海) await raw.customerPool.create({ data: { customerId: c.id, userId: null, reason: "手动", at: 进公海 } });
  return c.id;
};
const 项目 = async (customerId: string, 进公海?: Date) => {
  序号 += 1;
  return (await raw.project.create({ data: { name: `项目${序号}`, customerId, ownerId: "", creatorId: "x", phase: "线索", node: "潜客培育", ...(进公海 ? { pooledAt: 进公海 } : {}) } })).id;
};
const 项目痕 = (projectId: string, from: string | null, at: Date) =>
  raw.projectNodeLog.create({ data: { projectId, userId: from ?? "sys", kind: "pool-release", fromOwnerId: from, at, toPhase: "线索", toNode: "潜客培育" } });
const 客户痕 = (customerId: string, from: string, to: string, at: Date) =>
  raw.customerOwnerLog.create({ data: { customerId, userId: from, fromOwnerId: from, toOwnerId: to, kind: "pool-release", at } });

let 甲: string, 乙: string, 丙: string, 占位: string;
const t = (s: string) => new Date(`2026-11-${s}:00+08:00`);
let 公海项目们: Record<string, string>;
let 公海客户们: Record<string, string>;

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  甲 = await 人("jia");
  乙 = await 人("yi");
  丙 = await 人("bing");
  占位 = await 无负责人占位Id(prisma);

  // 项目侧：客户都在非公海，项目各自在公海
  const 普 = await 客户(丙);
  const 单 = await 项目(普, t("03 10:00")); await 项目痕(单, 甲, t("03 10:00"));
  const 多次 = await 项目(普, t("09 09:30")); await 项目痕(多次, 乙, t("02 08:00")); await 项目痕(多次, 甲, t("09 09:30"));
  const 导入无主 = await 项目(普, t("04 12:00")); await 项目痕(导入无主, null, t("04 12:00"));
  const 没留痕 = await 项目(普, t("05 12:00"));
  const 不在公海 = await 项目(普); await 项目痕(不在公海, 乙, t("01 08:00"));
  公海项目们 = { 单, 多次, 导入无主, 没留痕, 不在公海 };

  // 客户侧
  const 新式 = await 客户(占位, t("06 10:00")); await 客户痕(新式, 甲, 占位, t("06 10:00"));
  const 退过两次 = await 客户(占位, t("10 10:00")); await 客户痕(退过两次, 乙, 占位, t("02 10:00")); await 客户痕(退过两次, 丙, 占位, t("10 10:00"));
  const 老数据 = await 客户(乙, t("01 10:00"));
  const 没留痕占位 = await 客户(占位, t("07 10:00"));
  const 不在公海客户 = await 客户(甲);
  公海客户们 = { 新式, 退过两次, 老数据, 没留痕占位, 不在公海客户 };
  // 项目连带：在公海的客户「退过两次」下面挂一个没进线索公海的项目（旧算法按客户算回避）
  await 项目(退过两次);
});
afterEach(() => {
  vi.unstubAllEnvs();
  忘掉企业版范围();
});

const 列们 = async () => ({
  项目: Object.fromEntries(await Promise.all(Object.entries(公海项目们).map(async ([k, id]) => [k, (await raw.project.findUniqueOrThrow({ where: { id } })).poolPrevOwnerId]))),
  客户: Object.fromEntries(await Promise.all(Object.entries(公海客户们).map(async ([k, id]) => [k, (await raw.customer.findUniqueOrThrow({ where: { id } })).poolPrevOwnerId]))),
});

describe("回填：dry 不写，真写后值对，重复跑没有变化", () => {
  it("dry：只出计划和三张表，库里一格没动；表里有数于北京时刻、总行数、按人、按北京日期", async () => {
    const 计划 = await 算回填计划(raw);
    const 表 = 汇总表(计划);
    expect(表).toMatch(/^数于（北京时刻）\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    expect(表).toContain("## 项目：表 1 总行数");
    expect(表).toContain("## 项目：表 2 按人（原负责人 id，前 20 + 其余合计）");
    expect(表).toContain("## 客户：表 3 按放进公海的北京日期");
    expect(表).toContain("在公海里 4 行"); // 项目：单 / 多次 / 导入无主 / 没留痕
    expect(表).toContain("在公海里 4 行；将写 3");
    expect(表).toContain("2026-11-03\t1");
    expect(await 列们()).toEqual({
      项目: { 单: null, 多次: null, 导入无主: null, 没留痕: null, 不在公海: null },
      客户: { 新式: null, 退过两次: null, 老数据: null, 没留痕占位: null, 不在公海客户: null },
    });
  });

  it("真写：项目按最近一条 pool-release 的 from；客户按最近一条（占位那条）的 from，老数据取当前负责人；留痕没记人 / 没留痕不写；不在公海的不碰", async () => {
    const 计划 = await 算回填计划(raw);
    const 日志: string[] = [];
    const r = await 写回填(raw, 计划, (l) => 日志.push(l));
    expect(r.项目).toEqual({ 写了: 2, 已相同跳过: 0, 无可写: 2, 并发跳过: 0 });
    expect(r.客户).toEqual({ 写了: 3, 已相同跳过: 0, 无可写: 1, 并发跳过: 0 });
    expect(await 列们()).toEqual({
      项目: { 单: 甲, 多次: 甲, 导入无主: null, 没留痕: null, 不在公海: null },
      客户: { 新式: 甲, 退过两次: 丙, 老数据: 乙, 没留痕占位: null, 不在公海客户: null },
    });
    expect(日志.length).toBe(计划.项目.length + 计划.客户.length); // 逐行都有日志
    expect(日志.some((l) => l.startsWith("项目\t") && l.includes("写"))).toBe(true);
  });

  it("重复跑：第二次全是已相同 / 无可写，一行不写，库不变", async () => {
    await 写回填(raw, await 算回填计划(raw), () => {});
    const 前 = await 列们();
    const 二 = await 算回填计划(raw);
    expect([...二.项目, ...二.客户].filter((r) => 动作of(r) === "写")).toEqual([]);
    const r = await 写回填(raw, 二, () => {});
    expect(r.项目.写了 + r.客户.写了).toBe(0);
    expect(r.项目.已相同跳过).toBe(2);
    expect(r.客户.已相同跳过).toBe(3);
    expect(await 列们()).toEqual(前);
  });

  it("只写这一列：别的列（updatedAt、负责人、公海时刻）一格不变；读到旧值后被别人改了的行不覆盖", async () => {
    const 前c = await raw.customer.findUniqueOrThrow({ where: { id: 公海客户们.老数据 } });
    const 前p2 = await raw.project.findUniqueOrThrow({ where: { id: 公海项目们.多次 } });
    const 计划 = await 算回填计划(raw);
    // 算完计划、写之前，别处刚把这个项目放进公海写了新值
    await raw.project.update({ where: { id: 公海项目们.单 }, data: { poolPrevOwnerId: 丙 } });
    const r = await 写回填(raw, 计划, () => {});
    expect(r.项目.并发跳过).toBe(1);
    const 后p = await raw.project.findUniqueOrThrow({ where: { id: 公海项目们.单 } });
    expect(后p.poolPrevOwnerId).toBe(丙);
    // 别的行照写，且 updatedAt 一格不刷
    const 后p2 = await raw.project.findUniqueOrThrow({ where: { id: 公海项目们.多次 } });
    expect(后p2).toEqual({ ...前p2, poolPrevOwnerId: 甲 });
    const 后c = await raw.customer.findUniqueOrThrow({ where: { id: 公海客户们.老数据 } });
    expect(后c.salesOwnerId).toBe(乙);
    expect(后c.poolPrevOwnerId).toBe(乙);
    expect(前c.updatedAt).toEqual(后c.updatedAt);
    expect(后c).toEqual({ ...前c, poolPrevOwnerId: 乙 });
  });
});

describe("对拍：旧算法 vs 按列", () => {
  it("回填之后每位在职员工两个集合完全相同（0 不一致）；回填之前列是空的，会报出不一致", async () => {
    const 前 = await 对拍(raw);
    expect(前.不一致人数).toBeGreaterThan(0);
    await 写回填(raw, await 算回填计划(raw), () => {});
    const 后 = await 对拍(raw);
    expect(后.在职人数).toBeGreaterThanOrEqual(3);
    expect(后).toMatchObject({ 不一致人数: 0, 不一致: [], 互补不成立人数: 0 });
  });

  it("列被改坏报得出，报的是哪位、哪个 id；改成别人的也报", async () => {
    await 写回填(raw, await 算回填计划(raw), () => {});
    await raw.project.update({ where: { id: 公海项目们.单 }, data: { poolPrevOwnerId: null } });
    const r = await 对拍(raw);
    expect(r.不一致人数).toBe(1);
    expect(r.不一致[0]).toMatchObject({ userId: 甲, 实体: "项目", 旧多出: [公海项目们.单], 新多出: [] });
    expect(r.不一致.some((x) => x.实体 === "客户")).toBe(false);
    await raw.project.update({ where: { id: 公海项目们.单 }, data: { poolPrevOwnerId: 乙 } });
    expect((await 对拍(raw)).不一致人数).toBe(2);
  });

  it("可空列的坑：回避以外的人（列为空）不被误挡——互补核对成立", async () => {
    const r = await 对拍(raw); // 没回填、列全空
    expect(r.互补不成立人数).toBe(0);
  });
});
