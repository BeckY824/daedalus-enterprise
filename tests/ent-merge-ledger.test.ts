/**
 * 合并台账（lib/enterprise/merge-ledger.ts，12-02，客户 E-336 / E-337 / E-339）：
 * 只有系统管理员能看能导；一单合并后能列出、撤回后状态变；按时间范围、客户名 / 项目名筛；导出行数 = 列表行数、记导出日志。
 * 测试数据全是编的
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, defaultClient as raw } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 等通知推完 } from "@/lib/enterprise/notify";
import { 执行项目合并, 撤回项目合并 } from "@/lib/enterprise/project-merge";
import { 读合并台账, 导出合并台账, 只有系统管理员能看台账 } from "@/lib/enterprise/merge-ledger";

type 人 = { id: string; name: string; role: string };
let 老板: 人;
let 乙: 人;
let 序 = 0;
const 天 = 86_400_000;

async function 造人(email: string, name: string, role: string): Promise<人> {
  const u = await raw.user.create({ data: { email, name, title: "", role, password: "x" } });
  return { id: u.id, name: u.name, role };
}
async function 客户(name: string) {
  return (await raw.customer.create({ data: { name, phone: "", salesOwnerId: 乙.id } })).id;
}
async function 项目(customerId: string, name: string) {
  序++;
  return (await raw.project.create({ data: { name, customerId, ownerId: 乙.id, creatorId: 乙.id } })).id;
}
async function 并(a: string, b: string, me: 人, 现在?: Date) {
  const r = await 执行项目合并(prisma, a, b, me, { 已核未开票: true, 现在 });
  if (!r.ok) throw new Error(r.error);
  return r.mergeId;
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  老板 = await 造人("boss", "老板", "ADMIN");
  乙 = await 造人("yi", "乙", "SALES");
  await raw.entMember.createMany({ data: [{ userId: 老板.id, bizRole: "director" }, { userId: 乙.id, bizRole: "sales" }] });
  await setSetting("business", { projectMode: true });
});
afterEach(async () => {
  await 等通知推完();
  vi.unstubAllEnvs();
  忘掉企业版范围();
});

describe("谁能看", () => {
  it("非系统管理员列不出、导不了，也不记导出日志；系统管理员能", async () => {
    expect(await 读合并台账(prisma, 乙, {})).toEqual({ ok: false, error: 只有系统管理员能看台账 });
    expect(await 导出合并台账(prisma, 乙, {})).toEqual({ ok: false, error: 只有系统管理员能看台账 });
    expect(await raw.auditLog.count({ where: { action: "export" } })).toBe(0);
    expect(await 读合并台账(prisma, 老板, {})).toEqual({ ok: true, 行们: [], 截断: false });
    // 参数乱传也不崩（权限矩阵会这么调）
    expect(await 读合并台账(prisma, 老板, undefined)).toMatchObject({ ok: true });
  });
  it("不是企业版：一律不给", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "0");
    expect(await 读合并台账(prisma, 老板, {})).toMatchObject({ ok: false });
  });
});

describe("一单一行", () => {
  it("合并后列出来，各列对得上；撤回后状态变成已撤回、带撤回人和时间", async () => {
    const c = await 客户("编造测试客户甲");
    const a = await 项目(c, "留下的样板项目");
    const b = await 项目(c, "被并的样板项目");
    const id = await 并(a, b, 乙);
    const r1 = await 读合并台账(prisma, 老板, {});
    if (!r1.ok) throw new Error(r1.error);
    expect(r1.行们).toHaveLength(1);
    expect(r1.行们[0]).toMatchObject({
      id, 发起人: "乙", 客户id: c, 客户: "编造测试客户甲", 留下id: a, 留下项目: "留下的样板项目", 被并id: b, 被并项目: "被并的样板项目",
      留下负责人: "乙", 被并负责人: "乙", 自查人: "乙", 状态: "已合并", 撤回人: "", 撤回时间: null,
    });
    expect(r1.行们[0].自查时间).toBe(r1.行们[0].at);

    const u = await 撤回项目合并(prisma, id, 老板);
    expect(u.ok).toBe(true);
    const r2 = await 读合并台账(prisma, 老板, {});
    if (!r2.ok) throw new Error(r2.error);
    expect(r2.行们).toHaveLength(1);
    expect(r2.行们[0]).toMatchObject({ id, 状态: "已撤回", 撤回人: "老板" });
    expect(r2.行们[0].撤回时间).toBeTruthy();
  });

  it("按时间范围（含两端）、客户名 / 项目名筛；倒序；导出行数 = 列表行数，记一条导出日志", async () => {
    const 早 = new Date("2026-11-28T03:00:00.000Z");
    const 晚 = new Date(早.getTime() + 5 * 天);
    const c1 = await 客户("编造测试客户乙");
    const c2 = await 客户("编造测试客户丙");
    await 并(await 项目(c1, "一号留下"), await 项目(c1, "一号被并"), 乙, 早);
    await 并(await 项目(c2, "二号留下"), await 项目(c2, "二号被并"), 乙, 晚);

    const 全 = await 读合并台账(prisma, 老板, {});
    if (!全.ok) throw new Error(全.error);
    expect(全.行们.map((r) => r.留下项目)).toEqual(["二号留下", "一号留下"]);

    const 段 = { 起: "2026-11-28", 止: "2026-11-29" };
    const 筛时 = await 读合并台账(prisma, 老板, 段);
    expect(筛时.ok && 筛时.行们.map((r) => r.留下项目)).toEqual(["一号留下"]);

    const 搜客户 = await 读合并台账(prisma, 老板, { 词: " 客户丙 " });
    expect(搜客户.ok && 搜客户.行们.map((r) => r.客户)).toEqual(["编造测试客户丙"]);
    const 搜项目 = await 读合并台账(prisma, 老板, { 词: "一号被并" });
    expect(搜项目.ok && 搜项目.行们.map((r) => r.被并项目)).toEqual(["一号被并"]);
    const 没有 = await 读合并台账(prisma, 老板, { 词: "对不上的词" });
    expect(没有.ok && 没有.行们).toEqual([]);

    for (const 条件 of [{}, 段, { 词: "客户乙" }]) {
      const 列 = await 读合并台账(prisma, 老板, 条件);
      const 导 = await 导出合并台账(prisma, 老板, 条件);
      if (!列.ok || !导.ok) throw new Error("读不到");
      expect(导.行们).toHaveLength(列.行们.length);
      expect(导.行们.map((r) => r.id)).toEqual(列.行们.map((r) => r.id));
    }
    const 日志 = await raw.auditLog.findMany({ where: { action: "export", entity: "EntCustomerMerge" }, orderBy: { at: "asc" } });
    expect(日志).toHaveLength(3);
    expect(日志[0].summary).toContain("导出合并台账：全部时间，2 单");
    expect(JSON.parse(日志[1].detail!)).toMatchObject({ 行数: 1, 截断: false });
  });

  it("时间范围按北京日：北京日 00:00 和 23:59 的单两端都含，前一分钟 / 后一分钟不含；起止不是 YYYY-MM-DD 当没传", async () => {
    const c = await 客户("编造测试客户丁");
    // 北京 12-01 00:00 = 11-30T16:00Z；北京 12-01 23:59 = 12-01T15:59Z
    const 点 = [
      ["前一分钟", "2026-11-30T15:59:00.000Z"],
      ["零点", "2026-11-30T16:00:00.000Z"],
      ["二十三点五十九", "2026-12-01T15:59:00.000Z"],
      ["后一天零点", "2026-12-01T16:00:00.000Z"],
    ] as const;
    for (const [名, t] of 点) await 并(await 项目(c, `${名}留下`), await 项目(c, `${名}被并`), 乙, new Date(t));
    const 名们 = async (条件: { 起?: string | null; 止?: string | null }) => {
      const r = await 读合并台账(prisma, 老板, 条件);
      if (!r.ok) throw new Error(r.error);
      return r.行们.map((x) => x.留下项目).sort();
    };
    expect(await 名们({ 起: "2026-12-01", 止: "2026-12-01" })).toEqual(["二十三点五十九留下", "零点留下"]);
    expect(await 名们({ 起: "2026-12-01" })).toEqual(["二十三点五十九留下", "后一天零点留下", "零点留下"]);
    expect(await 名们({ 止: "2026-11-30" })).toEqual(["前一分钟留下"]);
    // ISO 串、乱写：当没传（不再按 ISO 解析）
    expect(await 名们({ 起: "2026-11-30T16:00:00.000Z", 止: "乱写" })).toHaveLength(4);
    expect(await 名们({ 起: 123 as unknown as string })).toHaveLength(4);
    // 导出日志的起止日直接写北京日期串
    const 导 = await 导出合并台账(prisma, 老板, { 起: "2026-12-01", 止: "2026-12-01" });
    expect(导.ok && 导.行们).toHaveLength(2);
    const 日志 = await raw.auditLog.findMany({ where: { action: "export", entity: "EntCustomerMerge" } });
    expect(日志[0].summary).toContain("2026-12-01 起、2026-12-01 止");
    expect(JSON.parse(日志[0].detail!)).toMatchObject({ 起: "2026-12-01", 止: "2026-12-01" });
    await 导出合并台账(prisma, 老板, { 起: "2026-12-01T00:00:00.000Z", 止: 5 as unknown as string });
    const 日志2 = await raw.auditLog.findMany({ where: { action: "export", entity: "EntCustomerMerge" }, orderBy: { at: "desc" } });
    expect(日志2[0].summary).toContain("导出合并台账：全部时间");
  });

  it("旧单 detail 里没有自查：自查人、自查时间两格为空", async () => {
    const c = await 客户("编造测试客户戊");
    await 并(await 项目(c, "旧单留下"), await 项目(c, "旧单被并"), 乙);
    const m = await raw.entCustomerMerge.findFirstOrThrow({ where: { kind: "项目" } });
    const d = JSON.parse(m.detail) as Record<string, unknown>;
    delete d.自查;
    await raw.entCustomerMerge.update({ where: { id: m.id }, data: { detail: JSON.stringify(d) } });
    const r = await 读合并台账(prisma, 老板, {});
    if (!r.ok) throw new Error(r.error);
    expect(r.行们).toHaveLength(1);
    expect(r.行们[0]).toMatchObject({ 自查人: "", 自查时间: null });
  });

  it("客户合并单（kind = 客户）不进台账", async () => {
    await raw.entCustomerMerge.create({ data: { kind: "客户", fromId: "x", intoId: "y", byUserId: 老板.id, fromName: "编造", detail: "{}" } });
    const r = await 读合并台账(prisma, 老板, {});
    expect(r.ok && r.行们).toEqual([]);
  });
});

describe("客户已删", () => {
  it("客户在回收站：名字后标（已删除）、状态回收站；彻底删除：只回（已删除的客户）、状态已删；在的状态是在", async () => {
    const c1 = await 客户("编造测试客户戊");
    const c2 = await 客户("编造测试客户己");
    const c3 = await 客户("编造测试客户庚");
    await 并(await 项目(c1, "戊留下"), await 项目(c1, "戊被并"), 乙);
    await 并(await 项目(c2, "己留下"), await 项目(c2, "己被并"), 乙);
    await 并(await 项目(c3, "庚留下"), await 项目(c3, "庚被并"), 乙);
    await raw.customer.update({ where: { id: c2 }, data: { deletedAt: new Date() } });
    await raw.customer.delete({ where: { id: c3 } });
    const r = await 读合并台账(prisma, 老板, {});
    if (!r.ok) throw new Error(r.error);
    const 按 = (项: string) => r.行们.find((x) => x.留下项目 === 项)!;
    expect(按("戊留下")).toMatchObject({ 客户: "编造测试客户戊", 客户状态: "在", 客户id: c1 });
    expect(按("己留下")).toMatchObject({ 客户: "编造测试客户己（已删除）", 客户状态: "回收站", 客户id: c2 });
    expect(按("庚留下")).toMatchObject({ 客户: "（已删除的客户）", 客户状态: "已删" });
  });
});
