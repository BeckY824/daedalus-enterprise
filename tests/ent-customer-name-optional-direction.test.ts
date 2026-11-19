/**
 * 企业版客户名称选填（11-19 审查第 8 条）：市场成员按方向指定分配、接手人不在这条线的候选里时，报错里叫这位客户不出「」。
 * 判定那几步（是不是市场成员、客户在不在市场手里、规则开没开、候选表）都桩成「要按方向、候选里没有这个人」，只看报错怎么叫客户。
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/enterprise/switch", async (原) => ({ ...(await 原<object>()), 企业版: () => true }));
vi.mock("@/lib/enterprise/customer-region", async (原) => ({ ...(await 原<object>()), 按区域分配of: () => true }));
vi.mock("@/lib/enterprise/org-core", async (原) => ({ ...(await 原<object>()), 管理指定不限of: () => false }));
vi.mock("@/lib/enterprise/market-transfer", async (原) => ({ ...(await 原<object>()), 客户在市场手里: () => true }));
vi.mock("@/lib/enterprise/rules", async (原) => ({ ...(await 原<object>()), 规则开着: async () => true }));
vi.mock("@/lib/enterprise/dict", async (原) => ({ ...(await 原<object>()), 挡分配方式: async () => null }));
vi.mock("@/lib/enterprise/cust-auto-assign", async (原) => ({ ...(await 原<object>()), 暂不分配项目of: () => "p1" }));
vi.mock("@/lib/enterprise/assign-eta", async (原) => ({ ...(await 原<object>()), 读线部门: async () => ({}), 不参与名单: async () => [] }));
vi.mock("@/lib/enterprise/assign-line", async (原) => ({ ...(await 原<object>()), 按部门候选: () => [], 自动可接: () => [] }));

import { 市场指定方向挡 } from "@/lib/enterprise/assign-direction-pick";

const 客户 = (补: Record<string, unknown>) => ({ id: "c1", name: "", shortName: null, customerNo: 12, salesOwnerId: "m1", bizLine: null, pool: null, ...补 });

describe("市场指定方向挡：报错里叫客户显名", () => {
  it("没全称叫客户编号、有简称叫简称，不出「」", async () => {
    const me = { id: "m1", role: "SALES" };
    const org = { 成员: new Map() } as never;
    const 话 = await 市场指定方向挡(me, org, [客户({})], "s9", "内贸");
    expect(话).toContain("「NO.00012」");
    expect(话).not.toContain("「」");
    expect(await 市场指定方向挡(me, org, [客户({ shortName: "编的简称" })], "s9", "内贸")).toContain("「编的简称」");
  });
});
