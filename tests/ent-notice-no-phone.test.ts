/**
 * 通知里不带手机号（审核 11-18 通知与定时任务 P1-2；P-转-12「提醒里不带手机号」、P-教练-21「飞书只推标题和去哪看，不带……手机号」）。
 * 钉的是：
 *   - notice-mask.ts：像手机号 / 电话的数字串打码；日期、时间、金额、编号、项目 id 不动；名字就是号码的换成客户编号
 *   - notify() 写库前打码（铃铛、飞书同一份）；feishu-push 发出前再打一遍（防着直接写进表的行）
 *   - 挂靠申请因客户进公海关闭：标题不再带撞上的号码（单测 N-1 同一个场景）
 * 撞号预警 1 档、挂靠申请、同号再次录入三处在各自的测试文件里（ent-dupe-ledger / enterprise-same-number-collab）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ 企业版: true }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/enterprise/switch", () => ({ 企业版: () => mocks.企业版 }));

import { prisma } from "@/lib/prisma";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { resetDb } from "./reset";
import { notify, 等通知推完 } from "@/lib/enterprise/notify";
import { 飞书推送开关键, 清飞书推送令牌, 推通知们 } from "@/lib/enterprise/feishu-push";
import { 通知文字打码, 通知里的客户名, 撞的写法, 名字是号码 } from "@/lib/enterprise/notice-mask";
import { 进公海挂靠通知 } from "@/lib/enterprise/attach-approval";
import { 挂靠进公海状态 } from "@/lib/owner-log-db";

describe("notice-mask：打码只打号码", () => {
  it.each([
    ["13912345678", "139****5678"],
    ["分给你：139 1234 5678", "分给你：139****5678"],
    ["（139-1234-5678）", "（139****5678）"],
    ["+86 139 1234 5678", "139****5678"],
    ["+971 50 123 4567", "971****4567"],
    ["971501234567", "971****4567"],
    ["021-12345678", "021****5678"],
    ["１３９１２３４５６７８", "139****5678"],
    // 下划线、点号分段（11-22 录音点评 PR6）
    ["回电 139_1234_5678", "回电 139****5678"],
    ["139.1234.5678 打过来", "139****5678 打过来"],
    ["座机 0571.8888.6666。", "座机 057****6666。"],
    ["座机 0571_88886666", "座机 057****6666"],
    ["手机 13912345678.", "手机 139****5678."],
  ])("号码 %s → %s", (原, 打) => {
    expect(通知文字打码(原)).toBe(打);
  });

  it.each([
    "原定 2026-11-18 08:00 分配",
    "（2026-11-18 至 2026-11-20）",
    "金额 1250000.00 元",
    "金额 12500000 元",
    "第 3 次 7 天内撞上",
    "客户 NO.00012",
    "项目 cmw0dschg1145du2xy5372i96",
    "发布了卡点 BLK-20261118-001",
    "老卡点 BLK20261118001",
    "金额 12345.67 元",
    "合计 1,250,000.00",
    "日期 2026.11.18",
    "日期 2026_11_18",
    "地址 192.168.100.200",
    "版本 0.46.33",
    "文件 record_2026",
  ])("不是号码的不动：%s", (s) => {
    expect(通知文字打码(s)).toBe(s);
  });

  it("名字就是号码：换成客户编号，没编号用短号；名字里夹着号码的打码", () => {
    expect(名字是号码("138 0013 8000")).toBe(true);
    expect(名字是号码("某公司")).toBe(false);
    expect(通知里的客户名({ name: "13800138000", customerNo: 12 })).toBe("客户 NO.00012");
    expect(通知里的客户名({ name: "13800138000", id: "cmabcdef123456" })).toBe("客户 #123456");
    expect(通知里的客户名({ name: "13800138000" })).toBe("一位客户");
    expect(通知里的客户名({ name: "张三 13800138000" })).toBe("张三 138****8000");
    expect(通知里的客户名({ name: "某公司", customerNo: 3 })).toBe("某公司");
  });

  it("撞号键：手机号打码、邮箱只留头一个字和域名、客户名是号码的不写出来", () => {
    expect(撞的写法("手机号", "13800138000")).toBe("手机号 138****8000");
    expect(撞的写法("邮箱", "buyer@example.com")).toBe("邮箱 b***@example.com");
    expect(撞的写法("微信", "13800138000")).toBe("微信 138****8000");
    expect(撞的写法("客户名", "13800138000")).toBe("客户名「（号码）」");
    expect(撞的写法("客户名", "编的客户")).toBe("客户名「编的客户」");
  });
});

const 令牌地址 = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";
const 回 = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
let fetchMock: ReturnType<typeof vi.fn>;
const 环境 = { ...process.env };
let 甲 = "";

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  mocks.企业版 = true;
  清飞书推送令牌();
  fetchMock = vi.fn(async (url: string) => (url === 令牌地址 ? 回({ code: 0, tenant_access_token: "tok", expire: 7200 }) : 回({ code: 0 })));
  vi.stubGlobal("fetch", fetchMock);
  process.env.ENT_FEISHU_APP_ID = "cli_test";
  process.env.ENT_FEISHU_APP_SECRET = "s3cr3t";
  甲 = (await prisma.user.create({ data: { email: "a", name: "甲", title: "", role: "SALES", password: "x", feishuOpenId: "ou_jia" } })).id;
  await setSetting(飞书推送开关键, true);
});
afterEach(async () => {
  await 等通知推完();
  vi.unstubAllGlobals();
  process.env = { ...环境 };
});

/** 推到飞书的那几次请求体里的文字 */
const 推出去的 = () => fetchMock.mock.calls.filter(([url]) => url !== 令牌地址).map(([, init]) => String((init as RequestInit).body));

describe("notify：写库前打码，铃铛和飞书同一份", () => {
  it("标题、正文里的号码（含客户名就是号码的）打码；日期时间照旧", async () => {
    await notify([甲], { kind: "分配", title: "老板 把客户分给你：13800138000", body: "原定 2026-11-18 08:00；客户电话 138 0013 8000", key: "k1" });
    await 等通知推完();
    const [r] = await prisma.entNotice.findMany({ where: { userId: 甲 } });
    expect(r.title).toBe("老板 把客户分给你：138****8000");
    expect(r.body).toBe("原定 2026-11-18 08:00；客户电话 138****8000");
    expect(r.feishuStatus).toBe("已推");
    const 体 = 推出去的();
    expect(体).toHaveLength(1);
    expect(体[0]).not.toContain("13800138000");
    expect(体[0]).not.toContain("0013");
    expect(体[0]).toContain("138****8000");
  });

  it("feishu-push 发出前再打一遍：直接写进表的行也不带号码", async () => {
    const r = await prisma.entNotice.create({ data: { userId: 甲, kind: "x", title: "撞上 13912345678", body: "+86 139 1234 5678", dedupeKey: "raw" } });
    await 推通知们([r.id]);
    const 体 = 推出去的();
    expect(体).toHaveLength(1);
    expect(体[0]).not.toMatch(/13912345678|1234 5678/);
    expect(体[0]).toContain("139****5678");
  });
});

describe("挂靠申请因客户进公海关闭（N-1）", () => {
  const 人 = async (name: string) => {
    const id = (await prisma.user.create({ data: { email: `${name}@x`, name, title: "", role: "SALES", password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: id, bizRole: "sales" } });
    return id;
  };
  it("按手机号撞上的：标题写打码后的号码，不出现原号", async () => {
    const 申请人 = await 人("申请人");
    const 原 = await 人("原负责人");
    const 号 = "13912345678";
    const c = await prisma.customer.create({ data: { name: "某客户", phone: 号, salesOwnerId: 原 } });
    await prisma.entDupeHit.create({
      data: { userId: 申请人, keyType: "手机号", keyValue: 号, customerId: c.id, ownerId: 原, action: "申请挂靠", actionAt: new Date(), status: 挂靠进公海状态, decidedAt: new Date() },
    });
    await 进公海挂靠通知([c.id]);
    const 们 = await prisma.entNotice.findMany({ where: { userId: 申请人 } });
    expect(们).toHaveLength(1);
    expect(`${们[0].title}\n${们[0].body}`).not.toContain(号);
    expect(们[0].title).toBe("挂靠申请已关闭：撞到的客户（按手机号 139****5678）已进公海");
  });

  it("按客户名撞上、客户名就是号码的：写客户编号", async () => {
    const 申请人 = await 人("申请人");
    const 原 = await 人("原负责人");
    const c = await prisma.customer.create({ data: { name: "13912345678", phone: "13912345678", salesOwnerId: 原, customerNo: 88 } });
    await prisma.entDupeHit.create({
      data: { userId: 申请人, keyType: "客户名", keyValue: "13912345678", customerId: c.id, ownerId: 原, action: "申请挂靠", actionAt: new Date(), status: 挂靠进公海状态, decidedAt: new Date() },
    });
    await 进公海挂靠通知([c.id]);
    const [n] = await prisma.entNotice.findMany({ where: { userId: 申请人 } });
    expect(n.title).toBe("挂靠申请已关闭：客户「客户 NO.00088」已进公海");
  });
});
