/**
 * ④ 扫库检测 第 2 阶段（E-383 / E-386）：凌晨扫 + 早 8 点通知，假时钟调 钟上扫库检测。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetDb } from "./reset";
import { prisma } from "@/lib/prisma";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 等通知推完, notify } from "@/lib/enterprise/notify";
import { 钟上扫库检测, 前一天, 达标 } from "@/lib/enterprise/scan-notice";
import { 扫库检测开关key } from "@/lib/enterprise/scan-query";

const 天 = "2026-11-26"; // 被查的那天
const 次日 = "2026-11-27";
const 时 = (d: string, hm: string) => new Date(`${d}T${hm}:00+08:00`);

const 人: Record<string, string> = {};
async function 建人(k: string, bizRole: string, managerId?: string | null, active = true) {
  人[k] = (await prisma.user.create({ data: { email: k, name: k, title: "", role: "SALES", password: "x", active } })).id;
  if (active) await prisma.entMember.create({ data: { userId: 人[k], bizRole, managerId: managerId ?? null } });
}
/** 给某人某天造 n 条查询，其中 hit 条撞上 */
async function 造查询(userId: string, day: string, n: number, hit: number) {
  await prisma.entScanQuery.createMany({
    data: Array.from({ length: n }, (_, i) => ({ userId, day, keyType: "号码", keyHash: `${userId}-${day}-${i}`, hit: i < hit })),
  });
}
const 通知 = (u: string) => prisma.entNotice.findMany({ where: { userId: u, kind: "扫库检测" }, orderBy: { createdAt: "asc" } });
const 触发 = () => prisma.entScanTrigger.findMany({ orderBy: [{ day: "asc" }, { userId: "asc" }] });

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await 建人("上级", "sales_mgr");
  await 建人("管理员", "director"); // 没业务线的总管理 = 系统管理员
  await 建人("乙", "sales", 人["上级"]);
  await 建人("丙", "sales"); // 没填直属上级
});
afterEach(async () => {
  await 等通知推完();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("④ 扫库检测 · 阈值", () => {
  it("达标判定：49 次不触发、50 次 60% 触发、50 次 59% 不触发", async () => {
    expect(达标(49, 49)).toBe(false);
    expect(达标(50, 30)).toBe(true);
    expect(达标(50, 29)).toBe(false);
    await 造查询(人["乙"], 天, 49, 49);
    await 钟上扫库检测(时(次日, "00:10"));
    expect(await 触发()).toHaveLength(0);
    await prisma.entScanQuery.deleteMany();
    await setSetting("entScan4ScanDay", "");
    await 造查询(人["乙"], 天, 50, 30);
    await 造查询(人["丙"], 天, 50, 29);
    await 钟上扫库检测(时(次日, "00:10"));
    const t = await 触发();
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ userId: 人["乙"], day: 天, queries: 50, hits: 30, noticeAt: null });
  });
});

describe("④ 扫库检测 · 时刻", () => {
  it("00:05 前不扫；之后扫昨天（不是今天、不追更早）", async () => {
    await 造查询(人["乙"], 天, 50, 40);
    await 造查询(人["丙"], "2026-11-25", 50, 40); // 更早的不补
    await 造查询(人["丙"], 次日, 50, 40); // 今天的不扫
    expect(await 钟上扫库检测(时(次日, "00:04"))).toBeNull();
    expect(await 触发()).toHaveLength(0);
    await 钟上扫库检测(时(次日, "00:05"));
    expect((await 触发()).map((x) => `${x.day}:${x.userId}`)).toEqual([`${天}:${人["乙"]}`]);
  });

  it("08:00 前不发、之后发；重复跑钟不重发", async () => {
    await 造查询(人["乙"], 天, 62, 41);
    await 钟上扫库检测(时(次日, "00:10"));
    await 钟上扫库检测(时(次日, "07:59"));
    expect(await 通知(人["上级"])).toHaveLength(0);
    const 明细 = await 钟上扫库检测(时(次日, "08:00"));
    expect(明细?.发?.条).toBe(1);
    await 钟上扫库检测(时(次日, "08:30"));
    await 钟上扫库检测(时(次日, "09:30"));
    expect(await 通知(人["上级"])).toHaveLength(1);
    const t = (await 触发())[0];
    expect(t.notifiedTo).toBe(人["上级"]);
    expect(t.noticeAt).not.toBeNull();
  });

  it("备份窗口（E-387）：开机补扫落在 00:15–00:50 / 03:15–03:50 里推迟，窗口结束后再扫；窗口前 00:14 照扫", async () => {
    await 造查询(人["乙"], 天, 60, 60);
    for (const hm of ["00:15", "00:30", "00:50", "03:15", "03:50"]) expect(await 钟上扫库检测(时(次日, hm))).toBeNull();
    expect(await 触发()).toHaveLength(0);
    expect((await 钟上扫库检测(时(次日, "00:51")))?.扫?.达标).toBe(1);
    expect(await 触发()).toHaveLength(1);
  });

  it("备份窗口（E-387）：00:14 在窗口前，照扫；03:51 补扫", async () => {
    await 造查询(人["乙"], 天, 60, 60);
    expect((await 钟上扫库检测(时(次日, "00:14")))?.扫?.达标).toBe(1);
    await prisma.entScanTrigger.deleteMany({});
    await setSetting("entScan4ScanDay", "");
    expect(await 钟上扫库检测(时(次日, "03:30"))).toBeNull();
    expect((await 钟上扫库检测(时(次日, "03:51")))?.扫?.达标).toBe(1);
  });

  it("服务停过 08:00 后才开机：先补扫昨天再发", async () => {
    await 造查询(人["乙"], 天, 60, 60);
    await 钟上扫库检测(时(次日, "10:00"));
    expect(await 通知(人["上级"])).toHaveLength(1);
  });
});

describe("④ 扫库检测 · 收件人与内容", () => {
  it("直属上级正常 → 发上级；没填 → 系统管理员；上级已停用 → 系统管理员", async () => {
    await 建人("老上级", "sales_mgr", null, false);
    await 建人("丁", "sales", 人["老上级"]); // 填的上级已停用（不在组织成员里）
    await prisma.entMember.update({ where: { userId: 人["丁"] }, data: { managerId: 人["老上级"] } }).catch(() => undefined);
    for (const k of ["乙", "丙", "丁"]) await 造查询(人[k], 天, 50, 50);
    await 钟上扫库检测(时(次日, "08:10"));
    expect(await 通知(人["上级"])).toHaveLength(1);
    expect(await 通知(人["管理员"])).toHaveLength(2); // 丙、丁
    expect((await 通知(人["上级"]))[0].title).toBe("扫库检测：乙 11-26 查询 50 次，撞上 50 次，撞号率 100%");
  });

  it("正文只有人名、日期、次数、撞号率，不带号码和客户名", async () => {
    await prisma.customer.create({ data: { name: "编的客户乙", phone: "13800138000", salesOwnerId: 人["丙"] } });
    await 造查询(人["乙"], 天, 62, 41);
    await 钟上扫库检测(时(次日, "08:10"));
    const n = (await 通知(人["上级"]))[0];
    expect(n.title).toBe("扫库检测：乙 11-26 查询 62 次，撞上 41 次，撞号率 66%");
    expect(`${n.title}${n.body}`).not.toMatch(/\d{11}|编的客户/);
  });

  it("查询人次日已停用：发给其停用前的直属上级；没填上级的发系统管理员", async () => {
    await 造查询(人["乙"], 天, 50, 50);
    await 造查询(人["丙"], 天, 50, 50);
    await prisma.user.updateMany({ where: { id: { in: [人["乙"], 人["丙"]] } }, data: { active: false } });
    await 钟上扫库检测(时(次日, "08:10"));
    expect(await 通知(人["上级"])).toHaveLength(1);
    expect((await 通知(人["上级"]))[0].title).toContain("乙");
    expect(await 通知(人["管理员"])).toHaveLength(1);
    expect((await 通知(人["管理员"]))[0].title).toContain("丙");
  });
});

describe("④ 扫库检测 · 每天一条、开关", () => {
  it("连着两天触发各一条，同人同日只一条", async () => {
    await 造查询(人["乙"], 天, 50, 50);
    await 造查询(人["乙"], 次日, 70, 50);
    await 钟上扫库检测(时(次日, "08:10"));
    await 钟上扫库检测(时("2026-11-28", "08:10"));
    await 钟上扫库检测(时("2026-11-28", "08:40"));
    const ns = await 通知(人["上级"]);
    expect(ns).toHaveLength(2);
    expect(ns.map((x) => x.title)).toEqual([expect.stringContaining("11-26"), expect.stringContaining("11-27")]);
  });

  it("总开关关了：不扫、不发（已写进触发表的也不发）；再开后补发昨天的", async () => {
    await 造查询(人["乙"], 天, 50, 50);
    await 钟上扫库检测(时(次日, "00:10")); // 先扫进表
    expect(await 触发()).toHaveLength(1);
    await setSetting(扫库检测开关key, false);
    expect(await 钟上扫库检测(时(次日, "08:10"))).toBeNull();
    expect(await 通知(人["上级"])).toHaveLength(0);
    await prisma.entScanTrigger.deleteMany();
    await setSetting("entScan4ScanDay", "");
    expect(await 钟上扫库检测(时(次日, "00:20"))).toBeNull();
    expect(await 触发()).toHaveLength(0);
    await setSetting(扫库检测开关key, true);
    await 钟上扫库检测(时(次日, "08:20"));
    expect(await 通知(人["上级"])).toHaveLength(1);
  });

  it("前一天跨月、跨年", () => {
    expect(前一天("2026-12-01")).toBe("2026-11-30");
    expect(前一天("2027-01-01")).toBe("2026-12-31");
  });
});

describe("④ 扫库检测 · 收件人边界与补发", () => {
  it("直属上级填的是自己 → 发系统管理员", async () => {
    await 建人("戊", "sales");
    await prisma.entMember.update({ where: { userId: 人["戊"] }, data: { managerId: 人["戊"] } });
    await 造查询(人["戊"], 天, 50, 50);
    await 钟上扫库检测(时(次日, "08:10"));
    expect(await 通知(人["戊"])).toHaveLength(0);
    expect(await 通知(人["管理员"])).toHaveLength(1);
  });

  it("没有系统管理员 → 不发、warn 一行（不带号码 / 客户名）、水位照记", async () => {
    await prisma.entMember.delete({ where: { userId: 人["管理员"] } });
    await 造查询(人["丙"], 天, 50, 50);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await 钟上扫库检测(时(次日, "08:10"));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0].join(" ")).toContain(人["丙"]);
    expect(warn.mock.calls[0].join(" ")).toContain(天);
    expect(await prisma.entNotice.count({ where: { kind: "扫库检测" } })).toBe(0);
    expect((await 触发())[0].noticeAt).toBeNull();
    expect(await (await import("@/lib/settings")).getSetting<string>("entScan4NoticeDay")).toBe(次日);
  });

  it("发到一半挂了重跑：通知已记、noticeAt 没写回 → 重跑不重发，noticeAt 补上", async () => {
    await 造查询(人["乙"], 天, 50, 50);
    await 钟上扫库检测(时(次日, "00:10"));
    const t = (await 触发())[0];
    await notify([人["上级"]], { kind: "扫库检测", title: "x", body: "x", link: null, key: `扫库检测:${天}:${人["乙"]}` });
    await 等通知推完();
    expect(await 通知(人["上级"])).toHaveLength(1);
    await 钟上扫库检测(时(次日, "08:10"));
    expect(await 通知(人["上级"])).toHaveLength(1);
    expect((await prisma.entScanTrigger.findUnique({ where: { id: t.id } }))!.noticeAt).not.toBeNull();
  });

  it("查询人本人是系统管理员且没上级 → 不发给自己，发其他系统管理员", async () => {
    await 建人("管理员2", "director");
    await 造查询(人["管理员"], 天, 50, 50);
    await 钟上扫库检测(时(次日, "08:10"));
    expect(await 通知(人["管理员"])).toHaveLength(0);
    expect(await 通知(人["管理员2"])).toHaveLength(1);
  });

  it("只有一位系统管理员且就是查询人本人 → 不发、warn", async () => {
    await 造查询(人["管理员"], 天, 50, 50);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await 钟上扫库检测(时(次日, "08:10"));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(await prisma.entNotice.count({ where: { kind: "扫库检测" } })).toBe(0);
  });

  it("停机两天后开机：前两天没发的都补发、各一条，更早的（超出 3 天）不补", async () => {
    for (const d of ["2026-11-23", "2026-11-25", 天]) await prisma.entScanTrigger.create({ data: { day: d, userId: 人["乙"], queries: 50, hits: 50 } });
    await 钟上扫库检测(时(次日, "09:00"));
    const ns = await 通知(人["上级"]);
    expect(ns.map((x) => x.title)).toEqual([expect.stringContaining("11-25"), expect.stringContaining("11-26")]);
    await 钟上扫库检测(时("2026-11-28", "09:00"));
    expect(await 通知(人["上级"])).toHaveLength(2);
  });
});
