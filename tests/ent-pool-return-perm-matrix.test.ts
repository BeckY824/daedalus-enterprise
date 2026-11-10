/**
 * 客户「放回公海」谁能放（P-公海-02：能放回 = 能转让，白名单见 P-转-01）＋按钮和服务端同一口径（P-公海-05）。
 *
 * 七种角色 × 本人的 / 下属的 / 别线的客户，一格一条：纯函数 能放回客户公海 和服务端动作 放进公海 都要对上。
 *   ① 负责人本人（只有项目组员角色的不算）② 实线直属上级（只上一级）且同业务线
 *   ③ 条线总管理，当前负责人在他这条线 ④ 系统管理员。虚线上级、只读管理员不能。
 * 改前服务端是「能管公海 或 负责人本人」：销售管理能放隔一级下属的、别线下属的；直属上级不是销售管理（市场管理、带人的销售）放不了下属的。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/shared-ws/current", async (原) => ({ ...(await 原<object>()), 当前是共享区: async () => false }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 权限组织 } from "@/lib/enterprise/org";
import * as 权限 from "@/lib/enterprise/permissions";
import { 放进公海 } from "@/app/(app)/customers/pool-actions";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
type 判 = (me: { id: string }, c: { salesOwnerId: string | null; 在公海: boolean }, org: unknown) => boolean;
/** 还没加这个函数时每格都红，不让整个文件转换失败 */
const 能放回客户公海: 判 = (me, c, org) => {
  const f = (权限 as unknown as { 能放回客户公海?: 判 }).能放回客户公海;
  if (!f) throw new Error("permissions.ts 还没有 能放回客户公海");
  return f(me, c, org);
};

const 人们: Record<string, 人> = {};
const 造人 = async (key: string, bizRole: string, extra: { 实线?: string; 虚线?: string; line?: string } = {}) => {
  const u = await prisma.user.create({ data: { email: `${key}@x`, name: key, title: "", role: "SALES", password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, managerId: extra.实线 ? 人们[extra.实线].id : undefined, dottedManagerId: extra.虚线 ? 人们[extra.虚线].id : undefined, line: extra.line ?? null } });
  人们[key] = { id: u.id, name: key, email: `${key}@x`, role: "SALES", title: "", avatar: null };
};
const 以 = <T,>(u: 人, fn: () => Promise<T>): Promise<T> => { mocks.user = { ...u }; return 以谁的身份(u.id, fn); };

let 序号 = 0;
const 客户 = async (ownerId: string) => {
  序号 += 1;
  return (await prisma.customer.create({ data: { name: `放回矩阵客户${序号}`, phone: `139${String(序号).padStart(8, "0")}`, salesOwnerId: ownerId } })).id;
};
const 在公海 = async (c: string) => !!(await prisma.customerPool.findUnique({ where: { customerId: c } }));

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  for (const k of Object.keys(人们)) delete 人们[k];
  await 造人("系统管理员", "director");
  await 造人("条线总管理", "director", { line: "内贸" });
  await 造人("只读管理员", "admin");
  // 条线总管理在这条线的实线链顶上：列表范围（visibility.ts）只按实线链算，不在链上的本线成员的客户他看不到，放回也就够不着
  await 造人("销售管理", "sales_mgr", { line: "内贸", 实线: "条线总管理" });
  await 造人("虚线管理", "sales_mgr", { line: "内贸" });
  await 造人("带人的销售", "sales", { line: "内贸", 实线: "销售管理", 虚线: "虚线管理" });
  await 造人("组员", "sales", { line: "内贸", 实线: "带人的销售" });
  await 造人("别线下属", "sales", { line: "外贸", 实线: "销售管理" });
  await 造人("外贸管理", "sales_mgr", { line: "外贸" });
  await 造人("外贸销售", "sales", { line: "外贸", 实线: "外贸管理" });
  await 造人("市场管理", "marketing_mgr");
  await 造人("市场成员", "channel_ops", { 实线: "市场管理" });
  await 造人("项目组员", "project_ops", { 实线: "销售管理" });
  await setSetting(规则.按组织看客户.key, true);
  invalidateSettingsCache();
  忘掉企业版范围();
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); });

/** [谁, 哪种, 客户负责人, 能不能放回] */
const 矩阵: [string, string, string, boolean][] = [
  // 销售：本人的能；直属下属的能（P-转-01 ②）；别线的不能
  ["带人的销售", "本人的", "带人的销售", true],
  ["带人的销售", "下属的", "组员", true],
  ["带人的销售", "别线的", "外贸销售", false],
  ["组员", "同事的（没下属）", "带人的销售", false],
  // 销售管理：本人的、直属下属的能；隔一级的、别线的直属、别线的都不能
  ["销售管理", "本人的", "销售管理", true],
  ["销售管理", "下属的", "带人的销售", true],
  ["销售管理", "隔一级下属的", "组员", false],
  ["销售管理", "别线的直属下属的", "别线下属", false],
  ["销售管理", "别线的", "外贸销售", false],
  ["虚线管理", "虚线下属的", "带人的销售", false],
  // 市场成员：只有本人的
  ["市场成员", "本人的", "市场成员", true],
  ["市场成员", "上级的", "市场管理", false],
  ["市场成员", "别线的", "外贸销售", false],
  // 市场管理：本人的、直属下属的能
  ["市场管理", "本人的", "市场管理", true],
  ["市场管理", "下属的", "市场成员", true],
  ["市场管理", "别线的", "外贸销售", false],
  // 条线总管理：本人的、条线内的能；别线的不能
  ["条线总管理", "本人的", "条线总管理", true],
  ["条线总管理", "条线内的", "组员", true],
  ["条线总管理", "别线的", "外贸销售", false],
  // 只读管理员：都不能
  ["只读管理员", "本人的", "只读管理员", false],
  ["只读管理员", "下属的", "组员", false],
  ["只读管理员", "别线的", "外贸销售", false],
  // 系统管理员：都能
  ["系统管理员", "本人的", "系统管理员", true],
  ["系统管理员", "下属的", "组员", true],
  ["系统管理员", "别线的", "外贸销售", true],
  // 只有项目组员角色的，自己名下的也不能（P-转-01 ①）
  ["项目组员", "本人的", "项目组员", false],
];

describe("客户放回公海：角色 × 客户归谁（P-公海-02）", () => {
  it.each(矩阵)("%s · %s（负责人 %s）→ %s", async (谁, _哪种, 负责人, 期望) => {
    const me = 人们[谁];
    const c = await 客户(人们[负责人].id);
    const org = await 以(me, () => 权限组织());
    const r = await 以(me, () => 放进公海([c], "客户主动终止"));
    expect(await 在公海(c), `服务端：${JSON.stringify(r)}`).toBe(期望);
    if (期望) expect(r).toMatchObject({ ok: true, updated: 1 });
    expect(能放回客户公海(me, { salesOwnerId: 人们[负责人].id, 在公海: false }, org), "纯函数").toBe(期望);
  });

  it("已在公海的不算能放回", async () => {
    const me = 人们["系统管理员"];
    expect(能放回客户公海(me, { salesOwnerId: 人们["组员"].id, 在公海: true }, await 以(me, () => 权限组织()))).toBe(false);
  });

  it("批量：选中的里有放不了的，能放的照放、放不了的跳过并报几位", async () => {
    const me = 人们["销售管理"];
    const 能 = await 客户(人们["带人的销售"].id);
    const 不能 = await 客户(人们["组员"].id);
    const r = await 以(me, () => 放进公海([能, 不能], "客户主动终止"));
    expect(r).toMatchObject({ ok: true, updated: 1, 没权限: 1 });
    expect([await 在公海(能), await 在公海(不能)]).toEqual([true, false]);
  });

  it("全放不了：说清谁能放", async () => {
    const me = 人们["销售管理"];
    const c = await 客户(人们["组员"].id);
    const r = await 以(me, () => 放进公海([c], "客户主动终止"));
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/负责人.*直属上级/);
  });
});

describe("按钮和服务端同一个判定（P-公海-05）", () => {
  const 读 = (...p: string[]) => readFileSync(join(process.cwd(), "src", "app", "(app)", "customers", ...p), "utf8");
  it("服务端动作、客户详情、客户列表都调 能放回客户公海", () => {
    expect(读("pool-actions.ts")).toMatch(/能放回客户公海\(me,/);
    expect(读("[id]", "page.tsx")).toMatch(/能放公海=\{能放回客户公海\(me,/);
    expect(读("page.tsx")).toMatch(/放不了ids=\{[^\n]*能放回客户公海\(me,/);
  });
});

describe("不是企业版：照旧负责人本人或管理账号能放", () => {
  it("老规矩不变", () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    const 放 = (role: string, 自己的: boolean) => 能放回客户公海({ id: "a", role } as { id: string }, { salesOwnerId: 自己的 ? "a" : "b", 在公海: false }, null);
    expect([放("SALES", true), 放("SALES", false), 放("MANAGER", false), 放("ADMIN", false)]).toEqual([true, false, true, true]);
  });
});
