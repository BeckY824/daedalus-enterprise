/**
 * ④ 扫库检测 第 3 阶段（E-383）：90 天清理 + 开关动作 + 开关总览一行。
 *   - 清理口径「超过 90 天删」：今天 − 90 天那天留（正好 90 天），91 天前删；89 天留
 *   - 两张表都清；开关关着照清；一天一次（水位）；停机几天后开机第一遍把所有超期的一次删光
 *   - 开关动作：只有总管理能改，别的角色拒绝；写 Setting + 操作日志（谁、打开 / 关掉）；总览「上次」读得到
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", role: "SALES", email: "" } as { id: string; name: string; role: string; email: string } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (f: unknown) => f }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user, currentUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));

import { resetDb } from "./reset";
import { prisma } from "@/lib/prisma";
import { getSetting, invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 钟上清扫库记录, 前几天, 扫库清水位键 } from "@/lib/enterprise/scan-notice";
import { 扫库检测开关key, 扫库检测开着 } from "@/lib/enterprise/scan-query";
import { 设扫库检测 } from "@/app/(app)/leads/assign-actions";
import { 开关现状, 读开关改动 } from "@/app/(app)/settings/switch-actions";

const 今天 = "2026-11-27";
const 时 = (d: string, hm = "03:00") => new Date(`${d}T${hm}:00+08:00`);
const id: Record<string, string> = {};

async function 建人(k: string, bizRole: string, role = "SALES") {
  id[k] = (await prisma.user.create({ data: { email: `${k}@x.test`, name: k, title: "", role, password: "x", active: true } })).id;
  await prisma.entMember.create({ data: { userId: id[k], bizRole } });
}
const 当 = (k: string, role = "SALES") => { mocks.user = { id: id[k], name: k, role, email: `${k}@x.test` }; };
async function 造(day: string, tag: string) {
  await prisma.entScanQuery.create({ data: { userId: id.乙, day, keyType: "号码", keyHash: `h-${tag}`, hit: false } });
  await prisma.entScanTrigger.create({ data: { day, userId: `u-${tag}`, queries: 50, hits: 40 } });
}
const 剩 = async () => ({
  q: (await prisma.entScanQuery.findMany({ select: { day: true } })).map((r) => r.day).sort(),
  t: (await prisma.entScanTrigger.findMany({ select: { day: true } })).map((r) => r.day).sort(),
});

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await 建人("管理员", "director", "ADMIN");
  await 建人("经理", "sales_mgr");
  await 建人("市场", "market_mgr");
  await 建人("乙", "sales");
});
afterEach(() => vi.unstubAllEnvs());

describe("④ 扫库检测 · 90 天清理", () => {
  it("前几天：跨月、跨年、定长可比", () => {
    expect(前几天("2026-11-27", 90)).toBe("2026-08-29");
    expect(前几天("2026-01-05", 10)).toBe("2025-12-26");
  });

  it("89 天留、90 天留（边界：超过 90 天才删）、91 天删；两张表都清", async () => {
    await 造(前几天(今天, 89), "a89");
    await 造(前几天(今天, 90), "a90");
    await 造(前几天(今天, 91), "a91");
    await 造(前几天(今天, 200), "a200");
    expect(await 钟上清扫库记录(时(今天))).toEqual({ 查询: 2, 触发: 2 });
    const r = await 剩();
    expect(r.q).toEqual([前几天(今天, 90), 前几天(今天, 89)].sort());
    expect(r.t).toEqual(r.q);
  });

  it("开关关着照清", async () => {
    await setSetting(扫库检测开关key, false);
    await 造(前几天(今天, 120), "old");
    await 造(前几天(今天, 5), "new");
    expect(await 钟上清扫库记录(时(今天))).toEqual({ 查询: 1, 触发: 1 });
    expect((await 剩()).q).toEqual([前几天(今天, 5)]);
  });

  it("一天一次：同一天再跑不动；第二天再跑", async () => {
    await 造(前几天(今天, 91), "x");
    expect(await 钟上清扫库记录(时(今天, "00:01"))).toBeNull(); // 00:05 前不清
    expect(await 钟上清扫库记录(时(今天, "00:06"))).toEqual({ 查询: 1, 触发: 1 });
    expect(await getSetting<string>(扫库清水位键)).toBe(今天);
    await 造(前几天(今天, 91), "y");
    expect(await 钟上清扫库记录(时(今天, "09:00"))).toBeNull();
    expect((await 剩()).q).toHaveLength(1);
    expect(await 钟上清扫库记录(时("2026-11-28"))).toEqual({ 查询: 1, 触发: 1 });
  });

  it("备份窗口里不清，窗口结束后补上（E-387）", async () => {
    await 造(前几天(今天, 91), "w");
    for (const hm of ["00:15", "00:50", "03:15", "03:50"]) expect(await 钟上清扫库记录(时(今天, hm))).toBeNull();
    expect((await 剩()).q).toHaveLength(1);
    expect(await 钟上清扫库记录(时(今天, "03:51"))).toEqual({ 查询: 1, 触发: 1 });
  });

  it("停机几天后开机：第一遍就把所有超期的一次删光，不用逐天补", async () => {
    await 钟上清扫库记录(时(今天));
    for (const n of [91, 93, 96, 100]) await 造(前几天("2026-12-02", n), `d${n}`);
    await 造(前几天("2026-12-02", 90), "keep");
    expect(await 钟上清扫库记录(时("2026-12-02"))).toEqual({ 查询: 4, 触发: 4 });
    expect((await 剩()).q).toEqual([前几天("2026-12-02", 90)]);
  });

  it("不是企业版：不动", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    await 造(前几天(今天, 120), "old");
    expect(await 钟上清扫库记录(时(今天))).toBeNull();
    expect((await 剩()).q).toHaveLength(1);
  });
});

describe("④ 扫库检测 · 开关动作", () => {
  it("没存过 = 开；系统管理员能关能开，操作日志写谁、打开 / 关掉", async () => {
    expect(await 扫库检测开着()).toBe(true);
    当("管理员", "ADMIN");
    expect(await 设扫库检测(false)).toEqual({ ok: true });
    expect(await 扫库检测开着()).toBe(false);
    expect(await 设扫库检测(false)).toEqual({ ok: true }); // 没变不重复写日志
    expect(await 设扫库检测(true)).toEqual({ ok: true });
    expect(await 扫库检测开着()).toBe(true);
    const 日志 = await prisma.auditLog.findMany({ where: { entity: "Setting", entityId: 扫库检测开关key }, });
    expect(日志.map((l) => l.summary).sort()).toEqual(["关掉扫库检测", "打开扫库检测"]);
    expect(日志.every((l) => l.userId === id.管理员 && l.at instanceof Date)).toBe(true);
  });

  it("销售管理、市场管理、销售都改不了，开关不变、没有日志", async () => {
    for (const k of ["经理", "市场", "乙"]) {
      当(k);
      expect(await 设扫库检测(false)).toMatchObject({ ok: false, error: "只有系统管理员能改这个开关" });
    }
    expect(await 扫库检测开着()).toBe(true);
    expect(await prisma.auditLog.count({ where: { entityId: 扫库检测开关key } })).toBe(0);
  });

  it("参数不是布尔：拒绝", async () => {
    当("管理员", "ADMIN");
    expect(await 设扫库检测("x" as unknown as boolean)).toMatchObject({ ok: false });
  });

  it("总览：scan_detect 默认开；改过以后「上次」写谁、打开 / 关掉", async () => {
    当("管理员", "ADMIN");
    const a = await 开关现状();
    if (!a.ok) throw new Error(a.error);
    expect(a.值.scan_detect).toBe(true);
    await 设扫库检测(false);
    const b = await 开关现状();
    if (!b.ok) throw new Error(b.error);
    expect(b.值.scan_detect).toBe(false);
    const 改 = await 读开关改动();
    if (!改.ok) throw new Error("读不出");
    expect(改.上次.scan_detect).toMatchObject({ 谁: "管理员", 动作: "关掉" });
  });
});
