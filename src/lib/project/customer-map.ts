/**
 * 复盘页「客户分布 · 按国家」的世界地图（11-03 客户反馈：客户分布「要是像地图那种的呈现」）：纯函数，不碰 echarts、不碰库。
 *
 * 地图要素来自 public/geo/world-chn.json（scripts/make-world-map.py 从 Natural Earth 中国视角版转出来），
 * 要素名是 NAME_ZH，多是全称（「阿拉伯联合酋长国」「大韩民国」）；库里存的是 国家候选 的日常叫法（「阿联酋」「韩国」），
 * 所以要一张对照表。香港、澳门、台湾都落在中国那一个要素上，提示框里再分开写。
 * 库里有、地图上找不到的名字（手填的「欧洲」「迪拜自贸区」之类）不报错，只进榜单。
 */
import { 认国家 } from "@/lib/customer-extra";
import type { 分布条 } from "./review-extras";

/** 地图要素的最小形状：world-chn.json 每个 feature 的 properties */
export type 地图要素 = { name: string; iso?: string };

/**
 * 日常叫法（认国家 统一过的）→ 地图要素名。只写对不上的；国家候选 里其余的名字和 NAME_ZH 一字不差。
 * tests/ent-review-customer-map.test.ts 逐个核对 国家候选 都能落到图上。
 */
export const 地图别名: Readonly<Record<string, string>> = {
  中国: "中华人民共和国",
  中国大陆: "中华人民共和国",
  中国香港: "中华人民共和国",
  中国澳门: "中华人民共和国",
  中国台湾: "中华人民共和国",
  阿联酋: "阿拉伯联合酋长国",
  韩国: "大韩民国",
  南韩: "大韩民国",
  朝鲜: "朝鲜民主主义人民共和国",
  蒙古: "蒙古国",
  "刚果（金）": "刚果民主共和国",
  "刚果(金)": "刚果民主共和国",
  "刚果（布）": "刚果共和国",
  "刚果(布)": "刚果共和国",
  象牙海岸: "科特迪瓦",
  波黑: "波斯尼亚和黑塞哥维那",
  马其顿: "北马其顿",
  中非: "中非共和国",
  埃斯瓦蒂尼: "斯威士兰",
  捷克共和国: "捷克",
  俄罗斯联邦: "俄罗斯",
  美利坚合众国: "美国",
  多米尼加共和国: "多米尼加",
};

/** 地图要素名 → 提示框里写的名字（全称换回日常叫法） */
const 显示名表: Readonly<Record<string, string>> = {
  中华人民共和国: "中国",
  阿拉伯联合酋长国: "阿联酋",
  大韩民国: "韩国",
  朝鲜民主主义人民共和国: "朝鲜",
  蒙古国: "蒙古",
  刚果民主共和国: "刚果（金）",
  刚果共和国: "刚果（布）",
};
export const 显示名 = (要素名: string) => 显示名表[要素名] ?? 要素名;

/** 库里的一个国家名 → 它在图上的要素名；图上没有的给 null。也认两位 ISO 代码（「US」「ae」） */
export function 地图名(国家: string, 要素们: readonly 地图要素[]): string | null {
  const 名们 = new Set(要素们.map((f) => f.name));
  const 统一 = 认国家(国家);
  if (!统一) return null;
  const 名 = 地图别名[统一] ?? 统一;
  if (名们.has(名)) return 名;
  if (/^[a-z]{2}$/i.test(统一)) return 要素们.find((f) => f.iso === 统一.toUpperCase())?.name ?? null;
  return null;
}

export type 地图区 = { name: string; value: number; 含: 分布条[] };

/**
 * 全部国家（不截断）→ 地图上每个要素一格（没客户的给 0，好让 0 走中性灰而不是没数据的默认色），
 * 同一个要素收到多个名字的（中国 + 中国香港 + 中国台湾）加在一起，含 里留着各自的数。
 */
export function 地图数据(全部国家: readonly 分布条[], 要素们: readonly 地图要素[]): { 区: 地图区[]; 不在图上: 分布条[] } {
  const 区 = new Map<string, 地图区>(要素们.map((f) => [f.name, { name: f.name, value: 0, 含: [] }]));
  const 不在图上: 分布条[] = [];
  for (const x of 全部国家) {
    const 名 = 地图名(x.名, 要素们);
    const 格 = 名 ? 区.get(名) : undefined;
    if (!格) {
      不在图上.push(x);
      continue;
    }
    格.value += x.数;
    格.含.push(x);
  }
  return { 区: [...区.values()], 不在图上 };
}

const 转义 = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * 提示框：「国家名：N 个客户」；一个要素合了几个名字的，下一行写其中各几个。
 * echarts 的提示框按 HTML 塞进页面，名字是人填的，转义了再拼
 */
export function 地图提示(格: Pick<地图区, "name" | "value" | "含">): string {
  const 主 = `${转义(显示名(格.name))}：${格.value} 个客户`;
  if (格.含.length < 2) return 主;
  return `${主}<br/>其中 ${格.含.map((x) => `${转义(x.名)} ${x.数}`).join("、")}`;
}

export type 色档 = { min: number; max?: number; label: string };

/**
 * 分档色阶的档：按 1、3、10、30、100、300… 切（对数刻度上大致等距），切到盖住最多的那个国家为止。
 * 头部几百、尾部个位数的分布，线性色阶会让除了头一个之外全挤在最浅那档。最后一档不封顶。
 * 0 不在这里：没客户的国家另给中性色。
 */
export function 色档们(最多: number): 色档[] {
  const 界: number[] = [1];
  for (let i = 0; 界[界.length - 1] <= 最多; i++) 界.push(i % 2 === 0 ? 界[界.length - 1] * 3 : (界[界.length - 1] / 3) * 10);
  // 界 = [1, 3, 10, 30, 100, …]，最后一个已经超过 最多
  const 档们: 色档[] = [];
  for (let i = 0; i < 界.length - 1; i++) {
    const lo = 界[i];
    const hi = 界[i + 1] - 1;
    const 末 = i === 界.length - 2;
    档们.push(末 ? { min: lo, label: lo === hi ? `${lo}` : `${lo}+` } : { min: lo, max: hi, label: lo === hi ? `${lo}` : `${lo}–${hi}` });
  }
  return 档们;
}
