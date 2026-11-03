/**
 * 复盘数据页最下方的客户分布（11-03 客户反馈）：排客户分布 按国家、按业务线数。
 *   - 多的在前，同数按拼音；没填的（空、全空格）：国家单写在 未填国家（榜单下面另起一行），业务线单列、排最后
 *   - 国家超过 国家最多 个：榜单（按国家）前几个照摆，其余并成「其他」；地图用的 全部国家 不截断
 *   - 总数 = 各国家数之和 + 未填国家（业务线是同一批客户，合计一样）
 */
import { describe, expect, it } from "vitest";
import { 排客户分布, 国家最多 } from "@/lib/project/review-extras";

const 组 = <K extends string>(k: K, 们: [string | null, number][]) => 们.map(([v, n]) => ({ [k]: v, _count: { _all: n } }) as { [P in K]: string | null } & { _count: { _all: number } });

describe("排客户分布", () => {
  it("多的在前、没填的最后，空格当没填", () => {
    const r = 排客户分布(组("addrCountry", [["中国", 5], [null, 3], ["印度", 7], ["  ", 1], ["土耳其", 5]]), 组("bizLine", [["外贸", 12], ["内贸", 5], [null, 4]]));
    expect(r.总数).toBe(21);
    expect(r.按国家).toEqual([{ 名: "印度", 数: 7 }, { 名: "土耳其", 数: 5 }, { 名: "中国", 数: 5 }]);
    expect(r.全部国家).toEqual(r.按国家);
    expect(r.未填国家).toBe(4);
    expect(r.按业务线).toEqual([{ 名: "外贸", 数: 12 }, { 名: "内贸", 数: 5 }, { 名: "未填业务线", 数: 4 }]);
  });

  it("国家太多：榜单并成「其他」，地图那份不截断", () => {
    const 国 = Array.from({ length: 国家最多 + 3 }, (_, i) => [`国${String(i).padStart(2, "0")}`, 100 - i] as [string, number]);
    const r = 排客户分布(组("addrCountry", [...国, [null, 2]]), []);
    expect(r.按国家).toHaveLength(国家最多);
    expect(r.按国家.at(-1)).toEqual({ 名: "其他", 数: 国.slice(国家最多 - 1).reduce((s, [, n]) => s + n, 0) });
    expect(r.按国家.reduce((s, x) => s + x.数, 0) + r.未填国家).toBe(r.总数);
    expect(r.全部国家).toHaveLength(国.length);
    expect(r.全部国家.reduce((s, x) => s + x.数, 0) + r.未填国家).toBe(r.总数);
    expect(r.未填国家).toBe(2);
  });

  it("没有客户 = 全空", () => {
    expect(排客户分布([], [])).toEqual({ 总数: 0, 按国家: [], 全部国家: [], 未填国家: 0, 按业务线: [] });
  });
});
