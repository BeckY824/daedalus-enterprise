/**
 * 渠道看板线索榜「展开全部」（员工反馈 #5：选了时间段只看到 Top5）：
 *   - 看板给的 榜 = 这一档里有新线索的全部渠道（不止 5 个），按线索数从多到少；没新线索的渠道不列
 *   - 跟选的档走：本月只数本月建的，全部数全部
 *   - 跟看的人的范围走（和 TOP5、渠道列表同一套「按组织看客户」）：销售只数自己看得见的项目
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "a@x", role: "ADMIN", title: "", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 读看板底数 } from "@/lib/enterprise/channel-dash-db";
import { 算看板, 榜最多, type 周期 } from "@/lib/enterprise/channel-dash";

const 今 = new Date("2026-11-16T04:00:00Z"); // 北京 11-16 中午
const 本月建 = new Date("2026-11-05T04:00:00Z");
const 上月建 = new Date("2026-10-05T04:00:00Z");
let 老板: string, 销售: string, 销售乙: string;
let 渠道们: { id: string; name: string; attr: null; channelOwnerName: string }[];

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  const 建人 = async (email: string, name: string, role: string, bizRole: string) => {
    const id = (await prisma.user.create({ data: { email, name, title: "", role, password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: id, bizRole } });
    return id;
  };
  老板 = await 建人("boss", "老板", "ADMIN", "director");
  销售 = await 建人("s1", "销售甲", "SALES", "sales");
  销售乙 = await 建人("s2", "销售乙", "SALES", "sales");
  await setSetting("business", { projectMode: true });
  await setSetting(规则.按组织看客户.key, true);
  invalidateSettingsCache();
  忘掉企业版范围();
  // 8 个渠道（名字很长）：第 i 个渠道本月 i+1 条线索（销售甲名下），第 0 个另有一条上月的；第 7 个只有销售乙的；第 8 个一条没有
  渠道们 = [];
  for (let i = 0; i < 9; i++) {
    const c = await prisma.channel.create({ data: { name: `超长渠道名${"很".repeat(40)}${i}`, channelOwnerId: 老板 } });
    渠道们.push({ id: c.id, name: c.name, attr: null, channelOwnerName: "—" });
  }
  let 号 = 0;
  const 建 = async (渠道: string, ownerId: string, createdAt: Date) => {
    const customerId = (await prisma.customer.create({ data: { name: `客户${号}`, phone: `1380000${String(号++).padStart(4, "0")}`, salesOwnerId: ownerId, channelId: 渠道 } })).id;
    await prisma.project.create({ data: { name: `p${号}`, customerId, ownerId, creatorId: ownerId, phase: "线索", currency: "CNY", createdAt } });
  };
  for (let i = 0; i < 7; i++) for (let n = 0; n <= i; n++) await 建(渠道们[i].id, 销售, 本月建);
  await 建(渠道们[0].id, 销售, 上月建);
  await 建(渠道们[7].id, 销售乙, 本月建);
  mocks.user = { ...mocks.user, id: 老板, role: "ADMIN" };
});
afterEach(() => {
  vi.unstubAllEnvs();
  忘掉企业版范围();
});

const 榜of = async (谁: string, 期: 周期) => {
  const 底 = await 以谁的身份(谁, () => 读看板底数(渠道们.map((c) => c.id), 今));
  return 算看板(渠道们, 底[期], false).榜.map((x) => [渠道们.findIndex((c) => c.id === x.id), x.线索]);
};

describe("线索榜展开全部", () => {
  it("老板本月：8 个有线索的渠道全给（超过 TOP5），按线索数排，没线索的不列", async () => {
    const 榜 = await 榜of(老板, "本月");
    expect(榜.length).toBeGreaterThan(榜最多);
    expect(榜).toEqual([[6, 7], [5, 6], [4, 5], [3, 4], [2, 3], [1, 2], [0, 1], [7, 1]]);
  });

  it("跟档走：全部把上月那条也数进来", async () => {
    expect(await 榜of(老板, "全部")).toEqual([[6, 7], [5, 6], [4, 5], [3, 4], [2, 3], [0, 2], [1, 2], [7, 1]]);
  });

  it("跟范围走：销售甲看不到销售乙那个渠道的项目，展开也只有自己的 7 个；销售乙只有 1 个", async () => {
    expect(await 榜of(销售, "本月")).toEqual([[6, 7], [5, 6], [4, 5], [3, 4], [2, 3], [1, 2], [0, 1]]);
    expect(await 榜of(销售乙, "本月")).toEqual([[7, 1]]);
  });
});
