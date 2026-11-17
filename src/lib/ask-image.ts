/**
 * 问一句时带一张图（2026-11-17 员工反馈：「附件不支持截图，包括对话框」）。
 *
 * 模型接口只收文字（lib/llm.ts 的 content 是字符串），所以图不直接给模型看：
 * 先用名片识别那套 OCR 认出图里的字（lib/card-scan/ocr.ts 认图里的字：服务器先认、不行在本机认），
 * 认出来的字当成一份附件文本，和 txt / csv 附件走同一条路（components/AskFiles.tsx → lib/ask-files.ts 拼文件）——
 * 后面的工具、权限、留痕全部照旧。图只在识别时传到自己的服务器，认完就丢，不存。
 *
 * 回形针选图、拖图进框、在框里 Ctrl+V / ⌘V 粘截图都走这一份。
 */
import type { 框 } from "@/lib/card-scan/parse";
import { 文件字数上限 } from "@/lib/ask-files";
import { 附件上限字节 } from "@/lib/attachment-rules";

export const 图片后缀 = [".png", ".jpg", ".jpeg", ".webp", ".bmp"];
const 图片类型 = ["image/png", "image/jpeg", "image/webp", "image/bmp"];
/** 图的大小上限沿用附件的规矩（lib/attachment-rules.ts）：传给识别前会先缩到长边 1600 */
export const 图片上限 = 附件上限字节;

const 后缀 = (名: string) => (名.includes(".") ? 名.slice(名.lastIndexOf(".")).toLowerCase() : "");

export function 是图片文件(f: { name: string; type?: string }): boolean {
  return 图片后缀.includes(后缀(f.name)) || 图片类型.includes((f.type ?? "").toLowerCase());
}

/** 粘进来的截图没有名字（或都叫 image.png）：起一个「截图-YYYYMMDD-HHmmss.png」，和附件区粘截图同一个规则 */
export function 截图名(d = new Date()): string {
  const 两 = (n: number) => String(n).padStart(2, "0");
  return `截图-${d.getFullYear()}${两(d.getMonth() + 1)}${两(d.getDate())}-${两(d.getHours())}${两(d.getMinutes())}${两(d.getSeconds())}.png`;
}

/**
 * 剪贴板里有没有一张要收的图。**有字就不拦**：从 Excel、网页复制的东西常常字和图都有，人要的是字；
 * 只有剪贴板里没有字、只有图（截图工具、微信截图、复制图片）才当图收
 */
export function 粘的图(cd: Pick<DataTransfer, "getData" | "files"> | null | undefined): File | null {
  if (!cd) return null;
  if ((cd.getData("text") ?? "").trim()) return null;
  return Array.from(cd.files ?? []).find((f) => f.type.startsWith("image/") || 是图片文件(f)) ?? null;
}

/**
 * OCR 认出的框 → 一段按读的顺序排好的字：从上到下，同一行（中心高度差不到行高一半）从左到右、空格隔开。
 * 不用名片的 排好的行：那个会按名片的规矩改字（统一、视觉转阅读），截图里的聊天原话不该被改
 */
export function 框们成文字(框们: readonly 框[]): string {
  const 有字 = 框们.filter((b) => b.text.trim()).slice().sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  const 行们: 框[][] = [];
  for (const b of 有字) {
    const 行 = 行们.at(-1);
    const 高 = 行 ? Math.max(...行.map((x) => x.h), b.h) : 0;
    const 中 = 行 ? 行.reduce((s, x) => s + x.cy, 0) / 行.length : 0;
    if (行 && Math.abs(b.cy - 中) < 高 * 0.5) 行.push(b);
    else 行们.push([b]);
  }
  return 行们.map((行) => 行.sort((a, b) => a.cx - b.cx).map((b) => b.text.trim()).join(" ")).join("\n");
}

export const 图里提示 = "（以下是从图片里认出的文字，可能有个别字认错）";
const 截掉了 = "\n（后面的字太多，截掉了）";

/** 认出的字 → 附件文本：前面说一句「这是图里认出来的」，超长按附件文本上限（lib/ask-files.ts 文件字数上限）截 */
export function 图转附件文本(字: string): string {
  const 全 = `${图里提示}\n${字}`;
  return 全.length <= 文件字数上限 ? 全 : 全.slice(0, 文件字数上限 - 截掉了.length) + 截掉了;
}

export const 没认出字的话 = "图里没认出文字。换一张清楚点的截图，或直接把文字粘进框里";
export const 太长的话 = "图太长，只认了前一部分";

/*
  ── 长图切块（2026-11-17：员工最常传手机聊天截图和长截图）──────────
  识别那头检测边长只有 960（ocr.ts / server/worker.ts），一张 1080×6000 的长截图整张认，字缩到看不清。
  高/宽 > 2 的切成几块逐块认：宽先等比缩到 ≤ 1600，块高约 1.5×宽，相邻块重叠约 10%（一行字被切成两半时，另一块里还有整行）。
  逐块**串行**认：服务器识别是几核共享的，别一下子并发打过去。最多 12 块，再长只认前 12 块，输入框下面说一句
*/
export const 最多块 = 12;
const 最宽 = 1600;

export type 切块 = { y: number; h: number };
/** 宽、高是原图像素；回的 宽 和块的 y / h 都是缩到 ≤ 1600 宽之后的像素（k = 缩比） */
export function 切块方案(宽: number, 高: number): { 宽: number; k: number; 块们: 切块[]; 截了: boolean } {
  const k = Math.min(1, 最宽 / 宽);
  const w = Math.round(宽 * k), H = Math.round(高 * k);
  if (高 / 宽 <= 2) return { 宽: w, k, 块们: [{ y: 0, h: H }], 截了: false };
  const 块高 = Math.round(w * 1.5);
  const 步 = Math.round(块高 * 0.9);
  const 块们: 切块[] = [];
  for (let y = 0; ; y += 步) {
    块们.push({ y, h: Math.min(块高, H - y) });
    if (y + 块高 >= H) break;
  }
  return { 宽: w, k, 块们: 块们.slice(0, 最多块), 截了: 块们.length > 最多块 };
}

/** 逐块认出的字按顺序拼起来；相邻两块首尾完全相同的那几行（重叠处认了两遍）去一份，不做别的对齐 */
export function 拼块文字(块们: readonly string[]): string {
  const 行们: string[] = [];
  for (const 块 of 块们) {
    const 新 = 块.split("\n").filter((l) => l.trim());
    let 重 = 0;
    for (let n = Math.min(行们.length, 新.length); n > 0; n--) {
      if (行们.slice(行们.length - n).every((l, j) => l === 新[j])) { 重 = n; break; }
    }
    行们.push(...新.slice(重));
  }
  return 行们.join("\n");
}

/**
 * 认一张图里的字，回附件文本或给人看的一句话。识别那一大套（ocr.ts，几百 KB）点了才去拿。
 * 进：识别中的进度话（「正在认图里的字…」「识别中 2/5」「排队中…」「第一次要下载…」）；
 * 提示：认成了但要说一句的（长图只认了前 12 块）
 */
export async function 认图成文本(f: File, 进: (话: string) => void): Promise<{ text: string; 提示?: string } | { 错: string }> {
  if (f.size > 图片上限) return { 错: `图太大（${Math.round(f.size / 1024 / 1024)} MB），上限 ${图片上限 / 1024 / 1024} MB` };
  try {
    const [{ 走网页登录, 服务器预热 }, { 认图里的字, 切成块 }] = await Promise.all([import("@/lib/card-scan/cloud"), import("@/lib/card-scan/ocr")]);
    走网页登录();
    void 服务器预热();
    const { 块们, 截了 } = await 切成块(f);
    const 文字们: string[] = [];
    for (const [i, 块] of 块们.entries()) {
      const 第几 = 块们.length > 1 ? `识别中 ${i + 1}/${块们.length}` : "";
      if (第几) 进(第几);
      // 一块一块地等：服务器识别是共享的，不并发
      const 框们 = await 认图里的字(块, (话, 百分) => {
        const 句 = 百分 != null ? `${话} ${Math.round(百分)}%` : 话;
        进(!第几 ? 句 : 话 === "正在认图里的字…" ? 第几 : `${第几}（${句}）`);
      });
      文字们.push(框们成文字(框们));
    }
    const 字 = 拼块文字(文字们);
    if (!字.trim()) return { 错: 没认出字的话 };
    return 截了 ? { text: 图转附件文本(`${字}\n（${太长的话}）`), 提示: 太长的话 } : { text: 图转附件文本(字) };
  } catch (e) {
    const { 错的话 } = await import("@/lib/card-scan/download").catch(() => ({ 错的话: null }));
    const 话 = 错的话?.(e);
    // 网络断了、识别文件没下下来：照原话说（能再试一次）；别的（图坏了、解不开）给一句能懂的
    return { 错: 话?.能重试 ? 话.话 : "这张图没认出来，换一张清楚点的截图再试，或直接把文字粘进框里" };
  }
}
