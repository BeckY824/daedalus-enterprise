/**
 * 主渠道停用和子渠道对得上（11-17 客户报）：
 * - 列表里写启用、「主渠道」里写已停用：主渠道停用后，下面的子渠道一律算停用（P-渠道-13）。
 *   服务端：主渠道停着时不让单开子渠道；新数据渠道不行 把「子渠道自己开着、主渠道停了」也认作停用
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
import { toggleChannel, toggleMainChannel } from "@/app/(app)/channels/actions";
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
