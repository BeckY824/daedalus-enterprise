"use client";

/**
 * 把一张图片（企业版项目附件什么文件都行）传成附件（浏览器里用）：先在这台电脑上压、去 EXIF，超了上限当场说，再 POST /api/attachments。
 * 附件区（components/AttachmentsPanel.tsx）和名片建档（首页名片识别，企业版联系人附件）共用这一份，压法、说法一样
 */
import { 图片长边, 可以压, 要重画, 换成jpg, 规整文件名, 超限说明, 不收说明, 归属键, type 附件, type 归属 } from "./attachment-rules";

export function 归属查询(挂在: 归属): string {
  const [k, v] = 归属键(挂在);
  return `${k}=${encodeURIComponent(v)}`;
}

/** 分类：企业版联系人附件的 名片 / 相册（api/attachments 只在挂联系人时认） */
export async function 传附件(挂在: 归属, f: File, 分类?: string | null): Promise<{ ok: true; 附件?: 附件 } | { ok: false; error: string }> {
  const 名 = 规整文件名(f.name);
  const 不收 = 不收说明(名, f.type, 挂在);
  if (不收) return { ok: false, error: 不收 };
  try {
    const 好 = await 准备(f, 名);
    const 超 = 超限说明(好.名, 好.体.size);
    if (超) return { ok: false, error: 超 };
    const q = new URLSearchParams({ name: 好.名 });
    if (好.w && 好.h) { q.set("w", String(好.w)); q.set("h", String(好.h)); }
    if (分类) q.set("tag", 分类);
    const r = await fetch(`/api/attachments?${归属查询(挂在)}&${q}`, {
      method: "POST",
      body: 好.体,
      headers: { "Content-Type": 好.体.type || "application/octet-stream" },
    });
    const j = (await r.json().catch(() => ({}))) as { error?: string; 附件?: 附件 };
    if (!r.ok) return { ok: false, error: j.error ?? `「${名}」没传上去（${r.status}）` };
    return { ok: true, 附件: j.附件 };
  } catch (e) {
    return { ok: false, error: `「${名}」没传上去：${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * 能压的图片长边超过 图片长边 就在这台电脑上缩：JPEG / WebP / BMP 出 JPEG（白底，0.85），PNG 还是 PNG（可能是带透明的图标）。
 * JPEG / WebP / BMP 不超也重画一遍，去掉 EXIF（拍摄地点、相机型号）；按 EXIF 里的方向先转正，竖拍的不会躺倒。
 * GIF、别的文件原样；读不出来的图也原样传
 */
async function 准备(f: File, 名: string): Promise<{ 体: Blob; 名: string; w?: number; h?: number }> {
  if (!可以压(f.type) || typeof createImageBitmap !== "function") return { 体: f, 名 };
  let 图: ImageBitmap;
  try { 图 = await createImageBitmap(f, { imageOrientation: "from-image" }); } catch { return { 体: f, 名 }; }
  try {
    if (!要重画(f.type, 图.width, 图.height)) return { 体: f, 名, w: 图.width, h: 图.height };
    const 比 = Math.min(1, 图片长边 / Math.max(图.width, 图.height));
    const w = Math.round(图.width * 比);
    const h = Math.round(图.height * 比);
    const 画布 = document.createElement("canvas");
    画布.width = w;
    画布.height = h;
    const g = 画布.getContext("2d");
    if (!g) return { 体: f, 名, w: 图.width, h: 图.height };
    const png = f.type === "image/png";
    // JPEG 没有透明，透明处垫白（和界面主题无关，所以不走 token）
    if (!png) { g.fillStyle = "white"; g.fillRect(0, 0, w, h); }
    g.imageSmoothingQuality = "high";
    g.drawImage(图, 0, 0, w, h);
    const 体 = await new Promise<Blob | null>((ok) => 画布.toBlob(ok, png ? "image/png" : "image/jpeg", 0.85));
    if (!体) return { 体: f, 名, w: 图.width, h: 图.height };
    return { 体, 名: png || f.type === "image/jpeg" ? 名 : 换成jpg(名), w, h };
  } finally {
    图.close();
  }
}
