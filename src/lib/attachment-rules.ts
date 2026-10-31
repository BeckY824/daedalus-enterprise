/**
 * 商机 / 订单附件的规矩（2026-10-22 D-24）：上限、哪些算图片、大小怎么写给人看。服务端和界面共用，不碰 node。
 */

/**
 * 单个附件的上限。团队版那边测完存储量后总控会给一个数，**只改这一处**（服务端拒收、界面提示都读它）
 */
export const 附件上限字节 = 20 * 1024 * 1024;

/** 图片在本机压到长边这么多像素再存（用户 10-22：「压到长边约 2000 像素」） */
export const 图片长边 = 2000;

/** 一个商机 / 订单下最多挂几个：防拖进一整个文件夹 */
export const 每条最多 = 100;

/** 浏览器能直接显示、按图片对待（缩略图、点开看大图）。SVG 不算：里面能带脚本 */
const 图片类型 = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp"]);
export function 是图片(mime: string): boolean {
  return 图片类型.has(mime.toLowerCase());
}

/**
 * 这一版只收图片（用户 10-22：商机、订单的产品图片；合同、方案、图纸这类文件先不做）。
 * 通用附件的存取都还在，放开别的类型只要改这里 + 界面上的 accept
 */
export const 只收图片 = true;
export const 收的类型 = [...图片类型].join(",");
/**
 * 企业版项目附件（2026-10-29 P11）什么文件都收：合同、方案、报价单都挂在项目上。
 * 取文件那头非图片一律当下载（octet-stream + sandbox），在本站打开跑不了脚本
 */
export function 收所有文件(挂在: 归属): boolean {
  return "projectId" in 挂在;
}

/**
 * 录音（企业版沟通记录，2026-10-31 F-跟进-07）：MP3 / M4A / WAV / AAC / AMR / OGG。
 * 取文件那头录音按原类型放出去（<audio> 能直接播），照样带 sandbox + nosniff
 */
const 音频类型 = new Set([
  "audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/wav", "audio/x-wav", "audio/wave",
  "audio/vnd.wave", "audio/aac", "audio/x-aac", "audio/amr", "audio/ogg",
]);
export function 是音频(mime: string): boolean {
  return 音频类型.has(mime.toLowerCase());
}
/** 沟通记录上传框的 accept：浏览器对 m4a / amr 给的类型不一，扩展名一起写上 */
export const 收的沟通类型 = [...图片类型, ...音频类型, ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".mp3", ".m4a", ".wav", ".aac", ".amr", ".ogg"].join(",");
/** 按扩展名猜录音类型：有的浏览器传 m4a / amr 时 type 是空或 application/octet-stream */
export function 猜音频类型(名字: string): string | null {
  const 扩 = 名字.toLowerCase().split(".").pop() ?? "";
  return ({ mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", aac: "audio/aac", amr: "audio/amr", ogg: "audio/ogg" } as Record<string, string>)[扩] ?? null;
}

export function 不收说明(名字: string, mime: string, 挂在?: 归属): string | null {
  if (挂在 && "followUpId" in 挂在) {
    if (是图片(mime) || 是音频(mime)) return null;
    return `「${名字}」不是图片或录音，沟通记录只收截图和录音（JPG、PNG、GIF、WebP、BMP，MP3、M4A、WAV、AAC、AMR、OGG）`;
  }
  if (!只收图片 || 是图片(mime) || (挂在 && 收所有文件(挂在))) return null;
  return `「${名字}」不是图片，这里只收 JPG、PNG、GIF、WebP、BMP 图片`;
}

/** 能在本机压的：GIF 不压（动图压了就不动了） */
export function 可以压(mime: string): boolean {
  return 是图片(mime) && mime.toLowerCase() !== "image/gif";
}

/**
 * 这张图要不要在这台电脑上重画一遍：长边超了要缩；JPEG / WebP / BMP 不超也重画——
 * 手机拍的照片 EXIF 里带拍摄地点（GPS）、相机型号，重画以后就没了。PNG 不超就原样（多是截图、图标，重画只会变大）
 */
export function 要重画(mime: string, 宽: number, 高: number): boolean {
  if (!可以压(mime)) return false;
  return Math.max(宽, 高) > 图片长边 || mime.toLowerCase() !== "image/png";
}

/** 1.2 MB / 340 KB / 12 字节 */
export function 读大小(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1).replace(/\.0$/, "")} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} 字节`;
}

/** 超了就说清超了多少；没超 = null */
export function 超限说明(名字: string, 大小: number, 上限 = 附件上限字节): string | null {
  if (大小 <= 上限) return null;
  return `「${名字}」有 ${读大小(大小)}，超了 ${读大小(大小 - 上限)}（单张最多 ${读大小(上限)}）`;
}

/** 文件名收拾一下：去掉路径、控制字符，最长 120 个字 */
export function 规整文件名(名: string): string {
  const 去路径 = 名.split(/[\\/]/).pop() ?? "";
  const 干净 = 去路径.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (干净 || "附件").slice(0, 120);
}

/** 压成 JPEG 以后扩展名跟着换 */
export function 换成jpg(名: string): string {
  const i = 名.lastIndexOf(".");
  return (i > 0 ? 名.slice(0, i) : 名) + ".jpg";
}

/** 附件编号：cuid，只许字母数字（拼文件路径、IPC 都靠它挡 ../） */
export function 是附件编号(id: unknown): id is string {
  return typeof id === "string" && /^[a-z0-9]{8,40}$/i.test(id);
}

export type 附件 = {
  id: string;
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  /** 文件在不在这台电脑上（团队版以后：行同步过来了、文件还没下载） */
  有文件: boolean;
};

/**
 * 挂在哪：商机（D-24）；线索 / 联系人只在企业版（2026-10-28 联系人附件，接口按 企业版() 放行）。订单那种 2026-10-29 随订单表删了。
 * 项目（P11，2026-10-29）只在企业版、项目模式开着时认；沟通记录（2026-10-31 F-跟进-07）同样，只认挂在项目上的沟通
 */
export type 归属 = { opportunityId: string } | { leadId: string } | { contactId: string } | { projectId: string } | { followUpId: string };

/** 归属的那一个键和编号：拼查询串、日志用 */
export type 归属键名 = "opportunityId" | "leadId" | "contactId" | "projectId" | "followUpId";
export function 归属键(挂在: 归属): [归属键名, string] {
  return Object.entries(挂在)[0] as [归属键名, string];
}
