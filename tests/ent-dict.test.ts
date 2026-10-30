/**
 * 企业版选项字典（2026-10-26，迁移 057）：
 *   - 第一次读某一类补默认选项（固定 id、按顺序），再读不重复补；每类各补各的
 *   - 加：排最后；同名回错；停用过的同名重新启用；空的、太长回错；没有的种类回错
 *   - 改名不换 id、和同类撞名回错；停用后 可选项 里没有、列表里还在
 *   - 谁能改：老板能；普通销售不能（「后台设置谁能改」字典一行，默认总管理员）
 *   - 改动留痕
 *   - 开关关着：不读不写，设置页不出这张卡，一行都不建
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "ADMIN", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 企业字典, 全部企业字典, 可选项, 加字典项, 改字典项, 字典定义, 字典种类们 } from "@/lib/enterprise/dict";
import { 加企业选项, 改企业选项 } from "@/app/(app)/settings/ent-dict-actions";

type 人 = { id: string; role: string };
let 老板: 人, 销售: 人;

async function 建(email: string, role: string): Promise<人> {
  const u = await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } });
  return { id: u.id, role };
}
const 当 = (p: 人) => { mocks.user = { ...mocks.user, id: p.id, role: p.role, name: p.id }; };

beforeEach(async () => {
  await resetDb();
  老板 = await 建("boss", "ADMIN");
  销售 = await 建("sales", "SALES");
  await prisma.entMember.create({ data: { userId: 销售.id } });
  当(老板);
  vi.stubEnv("CRM_ENTERPRISE", "1");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => prisma.$disconnect());

describe("企业版选项字典", () => {
  it("第一次读补默认、固定 id、按顺序；再读不重复；每类各补各的", async () => {
    const xs = await 企业字典("assign");
    expect(xs.map((x) => x.name)).toEqual([...字典定义.assign.默认]);
    expect(xs[0].id).toBe("dict-assign-0");
    expect((await 企业字典("assign")).length).toBe(字典定义.assign.默认.length);
    expect(await prisma.entDictItem.count({ where: { kind: { not: "assign" } } })).toBe(0);
    const 全部 = await 全部企业字典();
    expect(Object.keys(全部!)).toEqual([...字典种类们]);
    expect(全部!.projTag.map((x) => x.name)).toEqual(["A 重点推进", "B 潜力跟进", "C 正常培育"]);
  });

  it("几个人同时第一次读（空库 / 老库补新默认）：不撞唯一键、不多建", async () => {
    for (let 轮 = 0; 轮 < 3; 轮++) {
      await prisma.entDictItem.deleteMany({});
      await prisma.setting.deleteMany({ where: { key: { startsWith: "entDict." } } });
      for (const k of 字典种类们) await Promise.all(Array.from({ length: 5 }, () => 企业字典(k)));
      for (const k of 字典种类们) expect(await prisma.entDictItem.count({ where: { kind: k } })).toBe(字典定义[k].默认.length);
      // 老库：每类只剩前一半默认项、补新记号没了，几个人同时读
      for (const k of 字典种类们) {
        const n = 字典定义[k].默认.length;
        await prisma.entDictItem.deleteMany({ where: { kind: k, id: { in: Array.from({ length: n }, (_, i) => `dict-${k}-${i}`).slice(Math.ceil(n / 2)) } } });
      }
      await prisma.setting.deleteMany({ where: { key: { startsWith: "entDict.defaultAdded." } } });
      for (const k of 字典种类们) await Promise.all(Array.from({ length: 5 }, () => 企业字典(k)));
      for (const k of 字典种类们) expect(await prisma.entDictItem.count({ where: { kind: k } })).toBe(字典定义[k].默认.length);
    }
  });

  it("加：排最后、同名回错、停用过的同名重新启用、空 / 太长 / 没有的种类回错", async () => {
    const r = await 加字典项(老板, "recycle", "  客户搬迁 ");
    expect(r.ok).toBe(true);
    const xs = await 企业字典("recycle");
    expect(xs.at(-1)!.name).toBe("客户搬迁");
    expect(await 加字典项(老板, "recycle", "客户搬迁")).toMatchObject({ ok: false, error: expect.stringContaining("已经有") });
    expect(await 改字典项(老板, r.id!, { active: false })).toMatchObject({ ok: true });
    expect(await 加字典项(老板, "recycle", "客户搬迁")).toEqual({ ok: true, id: r.id });
    expect(await 加字典项(老板, "recycle", "  ")).toMatchObject({ ok: false });
    expect(await 加字典项(老板, "recycle", "长".repeat(21))).toMatchObject({ ok: false, error: expect.stringContaining("20") });
    expect(await 加字典项(老板, "nope", "x")).toMatchObject({ ok: false, error: "没有这类选项" });
    // 别的类有同名不算撞
    expect((await 加字典项(老板, "invalid", "客户搬迁")).ok).toBe(true);
  });

  it("改名不换 id、同类撞名回错；停用后下拉里没有、列表里还在", async () => {
    const [首, 次] = await 企业字典("verify");
    expect(await 改字典项(老板, 首.id, { name: "无效线索" })).toMatchObject({ ok: false, error: expect.stringContaining("已经有") });
    expect(await 改字典项(老板, 首.id, { name: "核实有效" })).toMatchObject({ ok: true });
    expect((await prisma.entDictItem.findUniqueOrThrow({ where: { id: 首.id } })).name).toBe("核实有效");
    await 改字典项(老板, 次.id, { active: false });
    expect(await 可选项("verify")).toEqual(["核实有效"]);
    expect((await 企业字典("verify")).length).toBe(2);
    expect(await 改字典项(老板, "不存在", { active: false })).toMatchObject({ ok: false, error: expect.stringContaining("不在了") });
  });

  it("普通销售改不了；老板能", async () => {
    expect(await 加字典项(销售, "transfer", "其它原因")).toMatchObject({ ok: false, error: expect.stringContaining("转让原因") });
    const [首] = await 企业字典("transfer");
    expect((await 改字典项(销售, 首.id, { active: false })).ok).toBe(false);
    expect((await 加字典项(老板, "transfer", "其它原因")).ok).toBe(true);
  });

  it("加、改都留痕", async () => {
    const r = await 加企业选项("custStatus", "长期合作");
    expect(r.ok).toBe(true);
    await 改企业选项((r as { id: string }).id, { active: false });
    const 痕 = await prisma.auditLog.findMany({ where: { entity: "EntDictItem" }, orderBy: { at: "asc" } });
    expect(痕.map((x) => x.summary)).toEqual(["加了客户状态「长期合作」", "停用客户状态「长期合作」"]);
  });

  it("开关关着：不读不写，一行都不建", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 全部企业字典()).toBeNull();
    expect(await 可选项("assign")).toEqual([]);
    expect(await 加字典项(老板, "assign", "随便")).toMatchObject({ ok: false });
    expect(await 加企业选项("assign", "随便")).toMatchObject({ ok: false });
    expect(await prisma.entDictItem.count()).toBe(0);
  });
});
