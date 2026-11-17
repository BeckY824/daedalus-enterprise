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

/**
 * 认一张图里的字，回附件文本或给人看的一句话。识别那一大套（ocr.ts，几百 KB）点了才去拿。
 * 进：识别中的进度话（「正在认图里的字…」「排队中…」「第一次要下载…」）
 */
export async function 认图成文本(f: File, 进: (话: string) => void): Promise<{ text: string } | { 错: string }> {
  if (f.size > 图片上限) return { 错: `图太大（${Math.round(f.size / 1024 / 1024)} MB），上限 ${图片上限 / 1024 / 1024} MB` };
  try {
    const [{ 走网页登录, 服务器预热 }, { 认图里的字 }] = await Promise.all([import("@/lib/card-scan/cloud"), import("@/lib/card-scan/ocr")]);
    走网页登录();
    void 服务器预热();
    const 框们 = await 认图里的字(f, (话, 百分) => 进(百分 != null ? `${话} ${Math.round(百分)}%` : 话));
    const 字 = 框们成文字(框们);
    if (!字.trim()) return { 错: 没认出字的话 };
    return { text: 图转附件文本(字) };
  } catch (e) {
    const { 错的话 } = await import("@/lib/card-scan/download").catch(() => ({ 错的话: null }));
    const 话 = 错的话?.(e);
    // 网络断了、识别文件没下下来：照原话说（能再试一次）；别的（图坏了、解不开）给一句能懂的
    return { 错: 话?.能重试 ? 话.话 : "这张图没认出来，换一张清楚点的截图再试，或直接把文字粘进框里" };
  }
}
