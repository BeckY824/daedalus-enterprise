/**
 * 复盘页「客户分布 · 按国家」世界地图（11-03 客户反馈：「要是像地图那种的呈现」）：customer-map.ts 的对照和分档。
 *   - 国家候选 里的每个国家都能在 public/geo/world-chn.json 上找到要素（对不上的靠 地图别名）
 *   - 中国香港 / 中国澳门 / 中国台湾 落在中国那一个要素上；地图上没有单独的台湾、香港、澳门要素
 *   - 库里出现、地图上没有的名字不报错，只进榜单（不在图上）
 *   - 色阶按 1、3、10、30、100、300… 分档
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { 国家候选 } from "@/lib/customer-extra";
import { 地图名, 地图数据, 地图提示, 色档们, type 地图要素 } from "@/lib/project/customer-map";

const 图 = JSON.parse(readFileSync(join(__dirname, "..", "public", "geo", "world-chn.json"), "utf8")) as { features: { properties: 地图要素 & { a3: string } }[] };
const 要素们 = 图.features.map((f) => f.properties);

describe("世界地图数据", () => {
  it("要素名不重复，没有南极洲，台湾、香港、澳门不是单独的要素", () => {
    const 名们 = 要素们.map((f) => f.name);
    expect(new Set(名们).size).toBe(名们.length);
    const a3 = new Set(图.features.map((f) => f.properties.a3));
    for (const k of ["ATA", "TWN", "HKG", "MAC"]) expect(a3.has(k)).toBe(false);
    expect(a3.has("CHN")).toBe(true);
  });

  it("国家候选 里每个国家都在图上", () => {
    const 找不到 = 国家候选.flatMap((g) => g.国家).filter((n) => !地图名(n, 要素们));
    expect(找不到).toEqual([]);
  });

  it("港澳台和中国合在一个要素上，提示框分开写", () => {
    for (const n of ["中国", "中国香港", "中国澳门", "中国台湾"]) expect(地图名(n, 要素们)).toBe("中华人民共和国");
    const { 区 } = 地图数据([{ 名: "中国", 数: 20 }, { 名: "中国香港", 数: 3 }, { 名: "中国台湾", 数: 2 }], 要素们);
    const 中 = 区.find((x) => x.name === "中华人民共和国")!;
    expect(中.value).toBe(25);
    expect(地图提示(中)).toBe("中国：25 个客户<br/>其中 中国 20、中国香港 3、中国台湾 2");
    expect(地图提示(区.find((x) => x.name === "阿拉伯联合酋长国")!)).toBe("阿联酋：0 个客户");
  });

  it("英文、ISO 代码、前后空格也认得", () => {
    expect(地图名("UAE", 要素们)).toBe("阿拉伯联合酋长国");
    expect(地图名(" USA ", 要素们)).toBe("美国");
    expect(地图名("de", 要素们)).toBe("德国");
  });

  it("库里有、地图上没有的名字不报错，只进榜单", () => {
    const 全部 = [{ 名: "美国", 数: 490 }, { 名: "欧洲", 数: 7 }, { 名: "迪拜自贸区", 数: 2 }, { 名: "其他", 数: 1 }];
    const r = 地图数据(全部, 要素们);
    expect(r.不在图上).toEqual([{ 名: "欧洲", 数: 7 }, { 名: "迪拜自贸区", 数: 2 }, { 名: "其他", 数: 1 }]);
    expect(r.区).toHaveLength(要素们.length);
    expect(r.区.reduce((s, x) => s + x.value, 0)).toBe(490);
    expect(地图数据([], 要素们).区.every((x) => x.value === 0)).toBe(true);
    expect(地图数据([{ 名: "美国", 数: 1 }], []).不在图上).toEqual([{ 名: "美国", 数: 1 }]);
  });

  it("色阶分档：1、3、10、30、100、300…，最后一档不封顶", () => {
    expect(色档们(490).map((x) => x.label)).toEqual(["1–2", "3–9", "10–29", "30–99", "100–299", "300+"]);
    expect(色档们(490).at(-1)).toEqual({ min: 300, label: "300+" });
    expect(色档们(30).map((x) => x.label)).toEqual(["1–2", "3–9", "10–29", "30+"]);
    expect(色档们(1).map((x) => x.label)).toEqual(["1+"]);
    expect(色档们(0)).toEqual([]);
  });
});
