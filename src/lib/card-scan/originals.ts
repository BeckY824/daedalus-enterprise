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
