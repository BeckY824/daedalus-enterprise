/**
 * 企业版渠道两层（2026-11-08）：主渠道 + 子渠道。
 * - 补主渠道：没挂主渠道的老渠道按名字补挂，可重复跑。
 * - saveChannel：子渠道可留空；不设子渠道的主渠道拒收子渠道；停用的主渠道拒收（老渠道主渠道没换的照收）；
 *   主渠道名不能有「|」；运营策略新选的要在字典里，老渠道上已有的照收。
 * - saveMainChannel：改名时子渠道全称一起改，撞名、带「|」报错；toggleMainChannel 停用 / 启用。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "a@x", role: "ADMIN", title: "", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { saveChannel, saveMainChannel, toggleMainChannel } from "@/app/(app)/channels/actions";
import { 补主渠道 } from "@/lib/enterprise/channel-main";
import { 拆主子, 子渠道名, 读策略, 写策略 } from "@/lib/enterprise/channel-main-core";

let 老板: string;
let 负责人: string;

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  老板 = (await prisma.user.create({ data: { email: "boss", name: "老板", title: "", role: "ADMIN", password: "x" } })).id;
  await prisma.entMember.create({ data: { userId: 老板, bizRole: "director" } });
  负责人 = (await prisma.user.create({ data: { email: "own", name: "渠道运营", title: "", role: "SALES", password: "x" } })).id;
  await prisma.entMember.create({ data: { userId: 负责人, bizRole: "channel_ops" } });
  mocks.user = { ...mocks.user, id: 老板, role: "ADMIN" };
});
afterEach(() => vi.unstubAllEnvs());

const 交 = (x: Partial<Parameters<typeof saveChannel>[0]> = {}) =>
  saveChannel({ name: "", phone: null, remark: null, channelOwnerId: 负责人, attr: "公域引流", platform: "小红书", source: "店铺", ...x });
const 取 = (id: string) => prisma.channel.findUniqueOrThrow({ where: { id } });
const 主 = (name: string) => prisma.entChannelMain.findUniqueOrThrow({ where: { name } });

describe("纯函数", () => {
  it("拆主子按第一个半角 / 全角竖线拆，拆不开整段当主渠道", () => {
    expect(拆主子("抖音|官方号")).toEqual({ 主: "抖音", 子: "官方号" });
    expect(拆主子("Facebook｜个人账号")).toEqual({ 主: "Facebook", 子: "个人账号" });
    expect(拆主子("LinkedIn")).toEqual({ 主: "LinkedIn", 子: "" });
    expect(拆主子("|无主")).toEqual({ 主: "|无主", 子: "" });
  });
  it("子渠道名：全称等于主渠道名 = 留空", () => {
    expect(子渠道名("阿里国际站", "阿里国际站")).toBe("");
    expect(子渠道名("展会|2026广交会", "展会")).toBe("2026广交会");
    expect(子渠道名("展会｜2026广交会", "展会")).toBe("2026广交会");
  });
  it("运营策略读写：去空去重，空数组存 null，坏 JSON 读成空", () => {
    expect(写策略([" A ", "A", "", "B"])).toBe('["A","B"]');
    expect(写策略([])).toBeNull();
    expect(读策略('["A","B"]')).toEqual(["A", "B"]);
    expect(读策略("坏")).toEqual([]);
    expect(读策略(null)).toEqual([]);
  });
});

describe("补主渠道", () => {
  it("按渠道名称 / 全称前段补挂，第二遍 0 条", async () => {
    const a = (await prisma.channel.create({ data: { name: "抖音|官方号", platform: "抖音", channelOwnerId: 负责人 } })).id;
    const b = (await prisma.channel.create({ data: { name: "抖音|小号", platform: "抖音", channelOwnerId: 负责人 } })).id;
    const c = (await prisma.channel.create({ data: { name: "Facebook｜个人账号", channelOwnerId: 负责人 } })).id;
    const d = (await prisma.channel.create({ data: { name: "LinkedIn", channelOwnerId: 负责人 } })).id;
    expect(await 补主渠道()).toBe(4);
    expect(await 补主渠道()).toBe(0);
    const 抖音 = await 主("抖音");
    expect((await 取(a)).mainId).toBe(抖音.id);
    expect((await 取(b)).mainId).toBe(抖音.id);
    expect(await 取(c)).toMatchObject({ mainId: (await 主("Facebook")).id, platform: "Facebook", name: "Facebook｜个人账号" });
    expect(await 取(d)).toMatchObject({ mainId: (await 主("LinkedIn")).id, platform: "LinkedIn" });
    expect(await prisma.entChannelMain.count()).toBe(3);
  });
});

describe("saveChannel 两层", () => {
  it("新主渠道保存时才建；子渠道留空全称就是主渠道名；和主渠道同名的子渠道当没写", async () => {
    const r1 = await 交({ platform: "阿里国际站", source: "" });
    expect(r1.ok).toBe(true);
    const m = await 主("阿里国际站");
    expect(await 取((r1 as { id: string }).id)).toMatchObject({ name: "阿里国际站", platform: "阿里国际站", mainId: m.id });
    const r2 = await 交({ platform: "中国制造网", source: "中国制造网" });
    expect(await 取((r2 as { id: string }).id)).toMatchObject({ name: "中国制造网" });
    // 校验没过不留下空主渠道
    expect(await 交({ platform: "新平台", source: "x".repeat(80) })).toMatchObject({ ok: false });
    expect(await prisma.entChannelMain.findUnique({ where: { name: "新平台" } })).toBeNull();
  });

  it("主渠道名带「|」、超长拒收", async () => {
    expect(await 交({ platform: "a|b" })).toEqual({ ok: false, error: "主渠道名里不能有「|」" });
    expect(await 交({ platform: "a｜b" })).toEqual({ ok: false, error: "主渠道名里不能有「|」" });
    expect(await 交({ platform: "长".repeat(41) })).toEqual({ ok: false, error: "主渠道名最多 40 个字" });
  });

  it("不设子渠道的主渠道：新建带子渠道拒收、留空照收；老渠道子渠道没改照收", async () => {
    const 老 = (await 交({ platform: "义乌展厅", source: "一楼" })) as { id: string };
    await prisma.entChannelMain.update({ where: { name: "义乌展厅" }, data: { allowSub: false } });
    expect(await 交({ platform: "义乌展厅", source: "二楼" })).toEqual({ ok: false, error: "主渠道「义乌展厅」不设子渠道，子渠道请留空" });
    expect((await 交({ platform: "义乌展厅", source: "" })).ok).toBe(true);
    // 老渠道：子渠道原样交回照收，改成别的拒收
    expect((await 交({ id: 老.id, platform: "义乌展厅", source: "一楼", remark: "改备注" })).ok).toBe(true);
    expect(await 交({ id: 老.id, platform: "义乌展厅", source: "三楼" })).toMatchObject({ ok: false });
  });

  it("停用的主渠道：新建拒收；老渠道主渠道没换照收", async () => {
    const 老 = (await 交({ platform: "Yandex", source: "店A" })) as { id: string };
    await prisma.entChannelMain.update({ where: { name: "Yandex" }, data: { active: false } });
    expect(await 交({ platform: "Yandex", source: "店B" })).toEqual({ ok: false, error: "主渠道「Yandex」已停用，请换一个" });
    expect((await 交({ id: 老.id, platform: "Yandex", source: "店A改" })).ok).toBe(true);
    expect((await 取(老.id)).name).toBe("Yandex|店A改");
    // 换到别的主渠道照常
    expect((await 交({ id: 老.id, platform: "谷歌", source: "店A改" })).ok).toBe(true);
    expect(await 取(老.id)).toMatchObject({ name: "谷歌|店A改", mainId: (await 主("谷歌")).id });
  });

  it("运营策略：新选的要在字典里；老渠道上已有的停用了照收；不交 = 不动", async () => {
    await prisma.entDictItem.create({ data: { kind: "channelStrategy", name: "投流", active: true, sort: 0 } });
    await prisma.entDictItem.create({ data: { kind: "channelStrategy", name: "自然流", active: true, sort: 1 } });
    expect(await 交({ strategies: ["没有这项"] })).toMatchObject({ ok: false });
    const r = (await 交({ strategies: ["投流", "自然流", "投流"] })) as { id: string };
    expect(读策略((await 取(r.id)).strategies)).toEqual(["投流", "自然流"]);
    await prisma.entDictItem.updateMany({ where: { kind: "channelStrategy", name: "投流" }, data: { active: false } });
    expect((await 交({ id: r.id, strategies: ["投流"] })).ok).toBe(true);
    expect(读策略((await 取(r.id)).strategies)).toEqual(["投流"]);
    expect((await 交({ id: r.id, remark: "只改备注" })).ok).toBe(true);
    expect(读策略((await 取(r.id)).strategies)).toEqual(["投流"]);
    expect((await 交({ id: r.id, strategies: [] })).ok).toBe(true);
    expect((await 取(r.id)).strategies).toBeNull();
  });
});

describe("saveMainChannel / toggleMainChannel", () => {
  it("新建：必填、不能带「|」、撞名报错", async () => {
    expect(await saveMainChannel({ name: " ", allowSub: true, selfDev: false })).toEqual({ ok: false, error: "请填写主渠道名" });
    expect(await saveMainChannel({ name: "a|b", allowSub: true, selfDev: false })).toMatchObject({ ok: false });
    const r = await saveMainChannel({ name: "TikTok", allowSub: true, selfDev: true });
    expect(r.ok).toBe(true);
    expect(await 主("TikTok")).toMatchObject({ allowSub: true, selfDev: true, active: true });
    expect(await saveMainChannel({ name: "TikTok", allowSub: false, selfDev: false })).toEqual({ ok: false, error: "主渠道「TikTok」已存在" });
  });

  it("改名：子渠道全称一起改，留空的子渠道全称就是新名", async () => {
    const a = (await 交({ platform: "阿里巴巴国际站", source: "店1" })) as { id: string };
    const b = (await 交({ platform: "阿里巴巴国际站", source: "" })) as { id: string };
    const m = await 主("阿里巴巴国际站");
    expect((await saveMainChannel({ id: m.id, name: "阿里国际站", allowSub: true, selfDev: false })).ok).toBe(true);
    expect(await 取(a.id)).toMatchObject({ name: "阿里国际站|店1", platform: "阿里国际站", mainId: m.id });
    expect(await 取(b.id)).toMatchObject({ name: "阿里国际站", platform: "阿里国际站" });
  });

  it("改名后和别的渠道重名报错，什么都不改", async () => {
    const a = (await 交({ platform: "甲", source: "店1" })) as { id: string };
    await 交({ platform: "乙", source: "店1" });
    const m = await 主("甲");
    expect(await saveMainChannel({ id: m.id, name: "乙", allowSub: true, selfDev: false })).toMatchObject({ ok: false });
    expect((await prisma.entChannelMain.findUnique({ where: { name: "乙" } }))).not.toBeNull();
    // 再试一个不撞主渠道名、但撞渠道全称的
    await prisma.channel.create({ data: { name: "丙|店1", platform: "丁", channelOwnerId: 负责人 } });
    expect(await saveMainChannel({ id: m.id, name: "丙", allowSub: true, selfDev: false })).toEqual({ ok: false, error: "改名后「丙|店1」和已有渠道重名，请先处理那个渠道" });
    expect(await 取(a.id)).toMatchObject({ name: "甲|店1", platform: "甲" });
    expect((await 主("甲")).id).toBe(m.id);
  });

  it("停用 / 启用：停用后新建选不到，启用后又能选", async () => {
    await 交({ platform: "微信", source: "公众号" });
    const m = await 主("微信");
    expect(await toggleMainChannel(m.id, false)).toEqual({ ok: true });
    expect(await 交({ platform: "微信", source: "视频号" })).toMatchObject({ ok: false });
    expect(await toggleMainChannel(m.id, true)).toEqual({ ok: true });
    expect((await 交({ platform: "微信", source: "视频号" })).ok).toBe(true);
    expect(await toggleMainChannel("没有这个", true)).toMatchObject({ ok: false });
  });

  it("不能管渠道的人调不动", async () => {
    const 销售 = (await prisma.user.create({ data: { email: "s1", name: "小王", title: "", role: "SALES", password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: 销售, bizRole: "sales" } });
    mocks.user = { ...mocks.user, id: 销售, role: "SALES" };
    expect(await saveMainChannel({ name: "X", allowSub: true, selfDev: false })).toMatchObject({ ok: false });
    expect(await prisma.entChannelMain.count()).toBe(0);
  });
});
