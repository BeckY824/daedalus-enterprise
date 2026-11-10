/**
 * 主渠道自己记负责人和渠道属性（获客方式）（11-10，P-渠道-10 / P-渠道-11，迁移 118）。
 * 原来这两样只记在子渠道上，一个子渠道都没有的主渠道没地方记。
 *
 * - saveMainChannel：能存、能清；不交 = 不动（拨开关不冲掉）；负责人要在候选里、属性要在字典里，原值没动的照收
 * - 改主渠道负责人：下面的子渠道、已有客户身上的渠道负责人都不动
 * - 子渠道没单独填时沿用主渠道的：saveChannel 没交负责人 / 属性时取主渠道的；交了的照交的来
 * - 在只有主渠道的主渠道下建出单一入口后，新客户选它：渠道负责人照子渠道的老逻辑带（= 那一行的负责人 = 主渠道负责人）
 * - 老库升级：迁移 118 只加两列，旧行两格是空
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "a@x", role: "ADMIN", title: "", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { saveChannel, saveMainChannel } from "@/app/(app)/channels/actions";
import { 读主渠道们 } from "@/lib/enterprise/channel-main";
import { resolveAttribution } from "@/lib/attribution";

let 老板: string;
let 甲: string;
let 乙: string;

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  老板 = (await prisma.user.create({ data: { email: "boss", name: "老板", title: "", role: "ADMIN", password: "x" } })).id;
  await prisma.entMember.create({ data: { userId: 老板, bizRole: "director" } });
  甲 = (await prisma.user.create({ data: { email: "a", name: "运营甲", title: "", role: "SALES", password: "x" } })).id;
  await prisma.entMember.create({ data: { userId: 甲, bizRole: "channel_ops" } });
  乙 = (await prisma.user.create({ data: { email: "b", name: "运营乙", title: "", role: "SALES", password: "x" } })).id;
  await prisma.entMember.create({ data: { userId: 乙, bizRole: "channel_ops" } });
  mocks.user = { ...mocks.user, id: 老板, role: "ADMIN" };
});
afterEach(() => vi.unstubAllEnvs());

const 主 = (id: string) => prisma.entChannelMain.findUniqueOrThrow({ where: { id } });
const 建主 = async (x: Partial<Parameters<typeof saveMainChannel>[0]> = {}) => {
  const r = await saveMainChannel({ name: "百度", allowSub: true, selfDev: false, ...x });
  if (!r.ok) throw new Error(r.error);
  return r.id;
};

describe("迁移 118", () => {
  it("只加 EntChannelMain 的 ownerId、attr 两列，都可空、没有默认值", () => {
    const sql = fs.readFileSync(path.resolve("migrations/118-ent-channel-main-owner.sql"), "utf8");
    const 句 = sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--"));
    expect(句).toEqual([
      'ALTER TABLE "EntChannelMain" ADD COLUMN "ownerId" TEXT;',
      'ALTER TABLE "EntChannelMain" ADD COLUMN "attr" TEXT;',
    ]);
  });
  it("旧行（不带这两格建的）读出来是空", async () => {
    const m = await prisma.entChannelMain.create({ data: { name: "老主渠道" } });
    expect(await 主(m.id)).toMatchObject({ ownerId: null, attr: null });
  });
});

describe("saveMainChannel 存负责人、渠道属性", () => {
  it("新建时带上；读主渠道们带出负责人名字", async () => {
    const id = await 建主({ ownerId: 甲, attr: "公域引流" });
    expect(await 主(id)).toMatchObject({ ownerId: 甲, attr: "公域引流" });
    expect((await 读主渠道们()).find((m) => m.id === id)).toMatchObject({ ownerId: 甲, ownerName: "运营甲", attr: "公域引流" });
  });
  it("不交 = 不动（拨开关不冲掉）；交 null = 清空", async () => {
    const id = await 建主({ ownerId: 甲, attr: "公域引流" });
    expect((await saveMainChannel({ id, name: "百度", allowSub: false, selfDev: true })).ok).toBe(true);
    expect(await 主(id)).toMatchObject({ ownerId: 甲, attr: "公域引流", allowSub: false, selfDev: true });
    expect((await saveMainChannel({ id, name: "百度", allowSub: false, selfDev: true, ownerId: null, attr: null })).ok).toBe(true);
    expect(await 主(id)).toMatchObject({ ownerId: null, attr: null });
  });
  it("负责人不在候选里（不存在、停用）拒收；属性不在字典里拒收", async () => {
    expect(await saveMainChannel({ name: "百度", allowSub: true, selfDev: false, ownerId: "没有这个人" })).toMatchObject({ ok: false });
    await prisma.user.update({ where: { id: 乙 }, data: { active: false } });
    expect(await saveMainChannel({ name: "百度", allowSub: true, selfDev: false, ownerId: 乙 })).toMatchObject({ ok: false });
    expect(await saveMainChannel({ name: "百度", allowSub: true, selfDev: false, attr: "字典里没有的" })).toMatchObject({ ok: false });
    expect(await prisma.entChannelMain.count()).toBe(0);
  });
  it("原来的负责人后来停用了、原来的属性后来不在字典里：没换的照收（改名不被卡住）", async () => {
    const m = await prisma.entChannelMain.create({ data: { name: "百度", ownerId: 乙, attr: "老属性" } });
    await prisma.user.update({ where: { id: 乙 }, data: { active: false } });
    expect((await saveMainChannel({ id: m.id, name: "百度搜索", allowSub: true, selfDev: false, ownerId: 乙, attr: "老属性" })).ok).toBe(true);
    expect(await 主(m.id)).toMatchObject({ name: "百度搜索", ownerId: 乙, attr: "老属性" });
  });
  it("不能管渠道的人改不了主渠道负责人（和改子渠道负责人同一道闸）", async () => {
    const id = await 建主({ ownerId: 甲 });
    const 销售 = (await prisma.user.create({ data: { email: "s1", name: "小王", title: "", role: "SALES", password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: 销售, bizRole: "sales" } });
    mocks.user = { ...mocks.user, id: 销售, role: "SALES" };
    expect(await saveMainChannel({ id, name: "百度", allowSub: true, selfDev: false, ownerId: 乙 })).toMatchObject({ ok: false });
    expect((await 主(id)).ownerId).toBe(甲);
  });
});

describe("改主渠道负责人不追溯", () => {
  it("下面的子渠道、已有客户身上的渠道负责人都不动", async () => {
    const id = await 建主({ ownerId: 甲, attr: "公域引流" });
    const c = await prisma.channel.create({ data: { name: "百度|号1", platform: "百度", mainId: id, channelOwnerId: 甲 } });
    const 客 = await prisma.customer.create({ data: { name: "老客户", phone: "13800000001", salesOwnerId: 甲, channelId: c.id, attributionChannelId: c.id, channelOwnerId: 甲 } });
    expect((await saveMainChannel({ id, name: "百度", allowSub: true, selfDev: false, ownerId: 乙 })).ok).toBe(true);
    expect((await prisma.channel.findUniqueOrThrow({ where: { id: c.id } })).channelOwnerId).toBe(甲);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: 客.id } })).channelOwnerId).toBe(甲);
  });
});

describe("子渠道没单独填时沿用主渠道的", () => {
  const 表单 = (x: Partial<Parameters<typeof saveChannel>[0]> = {}) =>
    saveChannel({ name: "", phone: null, remark: null, attr: "", platform: "百度", source: "", ...x });

  it("渠道表单没交负责人、属性：取主渠道的", async () => {
    const id = await 建主({ ownerId: 甲, attr: "公域引流" });
    const r = await 表单();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await prisma.channel.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ name: "百度", mainId: id, channelOwnerId: 甲, attr: "公域引流" });
  });
  it("交了的照交的来，不被主渠道的盖掉", async () => {
    await 建主({ ownerId: 甲, attr: "公域引流" });
    const r = await 表单({ source: "号2", channelOwnerId: 乙, attr: "个人自拓" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await prisma.channel.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ channelOwnerId: 乙, attr: "个人自拓" });
  });
  it("主渠道也没填：照旧报「请选择渠道属性」「请选择渠道负责人」", async () => {
    await 建主();
    expect(await 表单()).toEqual({ ok: false, error: "请选择渠道属性" });
    expect(await 表单({ attr: "公域引流" })).toEqual({ ok: false, error: "请选择渠道负责人" });
  });
  it("不走渠道表单新建（客户表单就地建、AI）：没交负责人时取主渠道的", async () => {
    await 建主({ ownerId: 甲 });
    const r = await saveChannel({ name: "百度|号3", phone: null, remark: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await prisma.channel.findUniqueOrThrow({ where: { id: r.id } })).channelOwnerId).toBe(甲);
  });
  it("编辑老子渠道不交负责人：不拿主渠道的去换（原负责人照留）", async () => {
    const id = await 建主({ ownerId: 甲, attr: "公域引流" });
    const c = await prisma.channel.create({ data: { name: "百度|号1", platform: "百度", mainId: id, attr: "个人自拓", channelOwnerId: 乙 } });
    expect((await 表单({ id: c.id, source: "号1", attr: "个人自拓", remark: "改个备注" })).ok).toBe(true);
    expect(await prisma.channel.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ channelOwnerId: 乙, remark: "改个备注" });
  });
});

describe("新客户选只有主渠道的来源", () => {
  it("在主渠道下建出单一入口后，新客户的渠道负责人照子渠道的老逻辑带 = 主渠道负责人；之后主渠道换人，这位客户不动", async () => {
    const id = await 建主({ ownerId: 甲, attr: "公域引流" });
    const r = await saveChannel({ name: "", phone: null, remark: null, attr: "", platform: "百度", source: "" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const 归属 = await resolveAttribution({ channelId: r.id });
    expect(归属).toMatchObject({ channelId: r.id, attributionChannelId: r.id, channelOwnerId: 甲 });
    const 客 = await prisma.customer.create({ data: { name: "新客户", phone: "13800000002", salesOwnerId: 乙, ...归属 } });
    await saveMainChannel({ id, name: "百度", allowSub: true, selfDev: false, ownerId: 乙 });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: 客.id } })).channelOwnerId).toBe(甲);
  });
});
