/**
 * 主渠道停用 / 删除和子渠道对得上（11-17 客户报的两条）：
 * - 列表里写启用、「主渠道」里写已停用：主渠道停用后，下面的子渠道一律算停用（P-渠道-13）。
 *   服务端：主渠道停着时不让单开子渠道；新数据渠道不行 把「子渠道自己开着、主渠道停了」也认作停用
 * - 删了「义乌门店」上面还有：渠道列表删的是子渠道（单一入口，和主渠道同名），主渠道是另一条记录。
 *   deleteMainChannel 只删下面一个渠道都没挂的主渠道，挂着的报数、什么都不动
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
import { deleteChannel, deleteMainChannel, toggleChannel, toggleMainChannel } from "@/app/(app)/channels/actions";
import { 新数据渠道不行 } from "@/lib/enterprise/channel-main";
import { 筛渠道 } from "@/lib/enterprise/channel-dash";

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

/** 主渠道 + 一个同名的单一入口子渠道（子渠道名留空，全称 = 主渠道名） */
async function 单一入口(name: string, 主开着: boolean, 子开着: boolean) {
  const m = await prisma.entChannelMain.create({ data: { name, allowSub: false, active: 主开着 } });
  const c = await prisma.channel.create({ data: { name, platform: name, mainId: m.id, channelOwnerId: 负责人, active: 子开着 } });
  return { 主id: m.id, 子id: c.id };
}

describe("主渠道停用，子渠道一起算停用", () => {
  it("主渠道停着：单开子渠道被挡、库里不动；停用子渠道照收；主渠道启用后再开得了", async () => {
    const { 主id, 子id } = await 单一入口("门店甲", false, false);
    expect(await toggleChannel(子id, true)).toEqual({ ok: false, error: "主渠道「门店甲」已停用，先到「主渠道」里启用" });
    expect((await prisma.channel.findUniqueOrThrow({ where: { id: 子id } })).active).toBe(false);
    expect(await toggleMainChannel(主id, true)).toEqual({ ok: true });
    expect(await toggleChannel(子id, true)).toEqual({ ok: true });
    expect((await prisma.channel.findUniqueOrThrow({ where: { id: 子id } })).active).toBe(true);
    // 停用不看主渠道
    await toggleMainChannel(主id, false);
    expect(await toggleChannel(子id, false)).toEqual({ ok: true });
  });

  it("新数据渠道不行：子渠道自己开着、主渠道停了 → 停用；都开着 → 能选；没挂主渠道的只看自己", async () => {
    const 停主 = await 单一入口("门店乙", false, true);
    const 开主 = await 单一入口("门店丙", true, true);
    const 没挂 = (await prisma.channel.create({ data: { name: "老渠道", channelOwnerId: 负责人 } })).id;
    expect(await 新数据渠道不行(停主.子id)).toBe("停用");
    expect(await 新数据渠道不行(开主.子id)).toBeNull();
    expect(await 新数据渠道不行(没挂)).toBeNull();
  });

  it("筛渠道 的状态筛选按眼下算不算启用：主停用的进「已停用」、不进「已启用」", () => {
    const 行 = (name: string, active: boolean, 主停用?: boolean) => ({ name, platform: name, attr: null, remark: null, channelOwnerId: "x", active, 主停用 });
    const 们 = [行("自己开主渠道开", true), 行("自己开主渠道停", true, true), 行("自己停", false)];
    const 筛 = (active: string) => 筛渠道(们, { kw: "", attr: "", ownerId: "", active }).map((r) => r.name);
    expect(筛("on")).toEqual(["自己开主渠道开"]);
    expect(筛("off")).toEqual(["自己开主渠道停", "自己停"]);
    expect(筛("")).toHaveLength(3);
  });
});

describe("删主渠道", () => {
  it("同名的单一入口：删子渠道后主渠道还在；主渠道要另删，删完就没了", async () => {
    const { 主id, 子id } = await 单一入口("门店丁", false, false);
    expect(await deleteChannel(子id)).toEqual({ ok: true });
    // 渠道列表删的是子渠道：主渠道是另一条，还在
    expect(await prisma.entChannelMain.findUnique({ where: { id: 主id } })).not.toBeNull();
    expect(await deleteMainChannel(主id)).toEqual({ ok: true });
    expect(await prisma.entChannelMain.findUnique({ where: { id: 主id } })).toBeNull();
    const 留痕 = await prisma.auditLog.findFirst({ where: { entity: "EntChannelMain", entityId: 主id } });
    expect(留痕?.summary).toBe("删除主渠道「门店丁」");
  });

  it("下面还挂着渠道：不删、报数，主渠道和子渠道都不动", async () => {
    const { 主id, 子id } = await 单一入口("门店戊", true, true);
    expect(await deleteMainChannel(主id)).toEqual({ ok: false, error: "下面还挂着 1 个渠道，不能删；不用了就停用" });
    expect(await prisma.entChannelMain.count({ where: { id: 主id } })).toBe(1);
    expect(await prisma.channel.count({ where: { id: 子id, mainId: 主id } })).toBe(1);
  });

  it("不在了、不能管渠道的人、不是企业版：都不删", async () => {
    const m = await prisma.entChannelMain.create({ data: { name: "空主渠道" } });
    expect(await deleteMainChannel("没有这个")).toMatchObject({ ok: false });
    const 销售 = (await prisma.user.create({ data: { email: "s1", name: "小王", title: "", role: "SALES", password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: 销售, bizRole: "sales" } });
    mocks.user = { ...mocks.user, id: 销售, role: "SALES" };
    expect(await deleteMainChannel(m.id)).toMatchObject({ ok: false });
    mocks.user = { ...mocks.user, id: 老板, role: "ADMIN" };
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await deleteMainChannel(m.id)).toEqual({ ok: false, error: "主渠道只在企业版里用" });
    expect(await prisma.entChannelMain.count({ where: { id: m.id } })).toBe(1);
  });
});
