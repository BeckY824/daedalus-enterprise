"use client";

/**
 * 名片原图暂存（企业版联系人附件，2026-10-28）：首页「名片」键选的那几张照片，按建议卡 id 记在这台电脑的内存里，
 * 卡确认、新线索 / 联系人真建出来以后由建议卡（components/ProposalCard.tsx）取走、逐张传成附件。
 * 不落 localStorage：图片大、又可能是别人的名片，刷新页面就没了——卡也一起没了，不会有「卡还在、图没了」的情况。
 * 一次最多记 名片最多张，多了只认前几张，防一把选进整个相册
 */
export const 名片最多张 = 10;

const 原图 = new Map<string, File[]>();

export function 记下名片原图(卡id: string, 图们: File[]) {
  if (!图们.length) return;
  // 只留最近几张卡的：页面一直开着、认了一下午名片也不至于攒一堆在内存里
  if (原图.size >= 20) 原图.delete(原图.keys().next().value!);
  原图.set(卡id, 图们.slice(0, 名片最多张));
}

/** 取走就删：同一张卡确认两次（服务端会拒）也不会把同几张图传两遍 */
export function 取走名片原图(卡id: string): File[] {
  const 图们 = 原图.get(卡id) ?? [];
  原图.delete(卡id);
  return 图们;
}

/**
 * 这页刚建的那位（2026-11-01，后发的客户照片）：销售先发名片建好，再单发一张客户照片「这个是客户的照片，帮我一起录入」。
 * 照片里认不出名片和微信资料时，问一句要不要存成刚建的那位的附件（components/PhotoSaveCard.tsx），点了才传。
 * 只在内存里、只记最后一位；撤销了就忘掉；隔太久（刚建多久内算 之内）不算「刚建」，免得页面开一晚上第二天的照片挂错人
 */
export type 刚建去处 = { contactId: string } | { leadId: string };
export type 刚建的人 = { 去处: 刚建去处; 名: string; 时刻: number };

export const 刚建多久内算 = 60 * 60 * 1000;

let 刚建: 刚建的人 | null = null;

export function 记下刚建的(去处: 刚建去处, 名: string, 时刻 = Date.now()) {
  刚建 = { 去处, 名: 名.trim() || "刚建的客户", 时刻 };
}

/** 撤销了刚建的那位：同一个去处才忘，别的卡撤销不影响 */
export function 忘掉刚建的(去处: 刚建去处) {
  if (刚建 && JSON.stringify(刚建.去处) === JSON.stringify(去处)) 刚建 = null;
}

export function 刚建的(此刻 = Date.now()): 刚建的人 | null {
  return 刚建 && 此刻 - 刚建.时刻 <= 刚建多久内算 ? 刚建 : null;
}

/**
 * 一次选的图里认出几个人、这页刚建过谁 → 这几张图怎么办：
 * 认出人就出卡（原来的路）；一个都没认出、刚建过人 → 问存不存到他名下；都没有 → 照旧说没认出。
 * 认出姓名、公司却没联系方式的那张（备用）排在「刚建的」后面：单发的照片上挂绳、展板的字常被认成姓名
 */
export function 这几张图(认出几人: number, 有备用: boolean, 刚建: 刚建的人 | null): "出卡" | "存到刚建的" | "备用出卡" | "没认出" {
  if (认出几人 > 0) return "出卡";
  if (刚建) return "存到刚建的";
  return 有备用 ? "备用出卡" : "没认出";
}

/** 逐张传，不并发（和名片原图一样，慢机器上几张大图一起传会卡界面）。传 = 传附件，测试里换掉 */
export async function 逐张存(
  图们: File[],
  传: (f: File) => Promise<{ ok: true } | { ok: false; error: string }>,
): Promise<{ 存了: number; 错: string[] }> {
  const 错: string[] = [];
  for (const f of 图们) {
    const r = await 传(f);
    if (!r.ok) 错.push(r.error);
  }
  return { 存了: 图们.length - 错.length, 错 };
}
