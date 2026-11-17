/**
 * 渠道「启用」的派生口径各处一致（P-渠道-13，11-17 复盘第 7 类：列表只看子渠道开关、主渠道框看主渠道，同一个渠道两处说法不一样）。
 * 口径只在 channel-main-core.ts 的 渠道启用 一处算：自己开着、且挂的主渠道没停用（没挂主渠道的只看自己）。
 * 这里拿同一批数据（自己开 / 关 × 没挂 / 主渠道开 / 主渠道关）对拍：
 *   - 库里查询版 启用渠道条件 = 渠道启用
 *   - 渠道页行（主停用 标）走 渠道启用 / 筛渠道 / 渠道状态文字 = 库里读出来带 main 的
 *   - 来源下拉（可选渠道 / 可选渠道们 带「现在选着的」）、客户列表来源筛选的「（已停用）」、服务端 新数据渠道不行 都对得上
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 启用渠道条件, 新数据渠道不行 } from "@/lib/enterprise/channel-main";
import { 渠道启用, 渠道状态文字 } from "@/lib/enterprise/channel-main-core";
import { 筛渠道 } from "@/lib/enterprise/channel-dash";
import { 可选渠道 } from "@/lib/options";
import { 可选渠道们, 渠道筛选选项 } from "@/lib/enterprise/channel-options";

type 例 = { name: string; active: boolean; 主: "无" | "开" | "关" };
const 例们: 例[] = [
  { name: "无主-开", active: true, 主: "无" },
  { name: "无主-关", active: false, 主: "无" },
  { name: "主开|子开", active: true, 主: "开" },
  { name: "主开|子关", active: false, 主: "开" },
  { name: "主关|子开", active: true, 主: "关" },
  { name: "主关|子关", active: false, 主: "关" },
];
/** 期望：自己开着、且主渠道没停 */
const 应启用 = (e: 例) => e.active && e.主 !== "关";

let ids: Record<string, string>;

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  const u = await prisma.user.create({ data: { email: "own", name: "渠道运营", title: "", role: "ADMIN", password: "x" } });
  const 开 = await prisma.entChannelMain.create({ data: { name: "主开", active: true, sort: 1 } });
  const 关 = await prisma.entChannelMain.create({ data: { name: "主关", active: false, sort: 2 } });
  ids = {};
  for (const e of 例们) {
    const mainId = e.主 === "开" ? 开.id : e.主 === "关" ? 关.id : null;
    const c = await prisma.channel.create({ data: { name: e.name, active: e.active, mainId, platform: e.主 === "无" ? null : e.name.split("|")[0], channelOwnerId: u.id } });
    ids[e.name] = c.id;
  }
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => prisma.$disconnect());

const 名们 = (f: (e: 例) => boolean) => 例们.filter(f).map((e) => e.name).sort();

describe("渠道启用 一个口径", () => {
  it("纯函数：两种行（带 main / 带主停用标）同一个结果；状态文字说清是谁停的", () => {
    for (const e of 例们) {
      const 带main = { active: e.active, main: e.主 === "无" ? null : { active: e.主 === "开" } };
      const 带标 = { active: e.active, ...(e.主 === "关" ? { 主停用: true } : {}) };
      expect(渠道启用(带main), e.name).toBe(应启用(e));
      expect(渠道启用(带标), e.name).toBe(应启用(e));
      expect(渠道状态文字(带main), e.name).toBe(渠道状态文字(带标));
    }
    expect(渠道状态文字({ active: true, main: { active: false } })).toBe("停用（主渠道已停用）");
    expect(渠道状态文字({ active: false, main: { active: false } })).toBe("停用");
    expect(渠道状态文字({ active: true, main: null })).toBe("启用");
  });

  it("库里查询 启用渠道条件 = 渠道启用", async () => {
    const 查出 = await prisma.channel.findMany({ where: 启用渠道条件, select: { name: true } });
    expect(查出.map((c) => c.name).sort()).toEqual(名们(应启用));
    const 全 = await prisma.channel.findMany({ select: { name: true, active: true, main: { select: { active: true } } } });
    expect(全.filter(渠道启用).map((c) => c.name).sort()).toEqual(名们(应启用));
  });

  it("渠道页状态筛选（筛渠道 on / off）和 渠道启用 对得上", () => {
    const 行们 = 例们.map((e) => ({ name: e.name, platform: null, attr: null, remark: null, channelOwnerId: "x", active: e.active, ...(e.主 === "关" ? { 主停用: true } : {}) }));
    const 筛 = (active: string) => 筛渠道(行们, { kw: "", attr: "", ownerId: "", active, creator: "" }).map((r) => r.name).sort();
    expect(筛("on")).toEqual(名们(应启用));
    expect(筛("off")).toEqual(名们((e) => !应启用(e)));
  });

  it("来源下拉：可选的只有启用的；带上「现在选着的」主渠道停用的那个标成停用", async () => {
    expect((await 可选渠道()).map((c) => c.name).sort()).toEqual(名们(应启用));
    const 带选着 = await 可选渠道们(ids["主关|子开"]);
    const 那个 = 带选着.find((c) => c.id === ids["主关|子开"]);
    expect(那个?.active).toBe(false);
    expect(带选着.filter((c) => c.active).map((c) => c.name).sort()).toEqual(名们(应启用));
  });

  it("客户列表来源筛选：「（已停用）」标在 渠道启用 为假的那几个上，排在后面", async () => {
    const 选项 = await 渠道筛选选项();
    const 停用的 = 选项.filter((o) => o.label.endsWith("（已停用）")).map((o) => o.label.replace("（已停用）", "")).sort();
    expect(停用的).toEqual(名们((e) => !应启用(e)));
    const 第一个停用 = 选项.findIndex((o) => o.label.endsWith("（已停用）"));
    expect(选项.slice(第一个停用).every((o) => o.label.endsWith("（已停用）"))).toBe(true);
  });

  it("服务端 新数据渠道不行：停用的正好是 渠道启用 为假的那几个", async () => {
    for (const e of 例们) {
      expect(await 新数据渠道不行(ids[e.name]), e.name).toBe(应启用(e) ? null : "停用");
    }
  });
});
