/**
 * 录音实测页的上传回显（11-21，录音点评 PR1，/api/mic-test/echo）：认格式、数字节，什么都不留。
 * 只看前 16 字节认格式，够分出手机上常见的几种录音。
 */

/** 一次最多收 20MB（按住说话单次 ≤10 分钟，安卓 wav 16k 单声道约 19MB） */
export const 回显上限字节 = 20 * 1024 * 1024;

export type 认出的格式 = "m4a" | "mp4" | "wav" | "webm" | "ogg" | "mp3" | "aac" | "amr" | "caf" | "未知";

export function 认格式(头: Uint8Array): 认出的格式 {
  const 字 = (from: number, to: number) => String.fromCharCode(...头.subarray(from, to));
  if (头.length >= 12 && 字(4, 8) === "ftyp") {
    const 牌 = 字(8, 12);
    return 牌 === "M4A " || 牌 === "M4B " ? "m4a" : "mp4";
  }
  if (头.length >= 12 && 字(0, 4) === "RIFF" && 字(8, 12) === "WAVE") return "wav";
  if (头.length >= 4 && 头[0] === 0x1a && 头[1] === 0x45 && 头[2] === 0xdf && 头[3] === 0xa3) return "webm";
  if (头.length >= 4 && 字(0, 4) === "OggS") return "ogg";
  if (头.length >= 5 && 字(0, 5) === "#!AMR") return "amr";
  if (头.length >= 4 && 字(0, 4) === "caff") return "caf";
  if (头.length >= 3 && 字(0, 3) === "ID3") return "mp3";
  // ADTS（裸 AAC）：12 位同步字 + layer 恒为 00；MPEG 音频帧（mp3）：11 位同步字 + layer 不为 00
  if (头.length >= 2 && 头[0] === 0xff && (头[1] & 0xf6) === 0xf0) return "aac";
  if (头.length >= 2 && 头[0] === 0xff && (头[1] & 0xe0) === 0xe0 && (头[1] & 0x06) !== 0) return "mp3";
  return "未知";
}

/**
 * 进程内同时最多处理几个回显：每个最多 20MB 整份在内存里，不设上限几个并发就能把进程内存顶上去。
 * 超了接口回 429；占到的位不管成功、出错、413 都在 finally 里还。
 */
export const 回显并发上限 = 2;
let 处理中 = 0;

/** 占一个位，占到返回 true（用完必须 还回显位()），满了返回 false */
export function 占回显位(): boolean {
  if (处理中 >= 回显并发上限) return false;
  处理中 += 1;
  return true;
}

export function 还回显位(): void {
  if (处理中 > 0) 处理中 -= 1;
}

/** 测试用：现在占着几个位 */
export function 回显处理中(): number {
  return 处理中;
}

/** 切文件段最多切出几段（回显只回这么多） */
export const 文件段上限 = 20;

export type 文件段 = { field: string; name: string; type: string; 字节: Uint8Array };

/**
 * 就地切 multipart/form-data：只在已读进来的那一份字节上找分隔线，文件那一段用 subarray 指回原数组、不复制
 * （不用 Response.formData()：那条路要把整份请求体再复制两三份）。
 * 只要带 filename 的段（和 formData() 认文件的规则一样），普通字段跳过；切满 文件段上限 就停；格式不对返回 null。
 */
export function 切文件段(体: Uint8Array, contentType: string): 文件段[] | null {
  const m = /;\s*boundary=(?:"([^"]{1,70})"|([^;\s"]{1,70}))/i.exec(contentType);
  const 界 = m?.[1] ?? m?.[2];
  if (!界) return null;
  const 全 = Buffer.from(体.buffer, 体.byteOffset, 体.byteLength);
  const 首分隔 = Buffer.from(`--${界}`, "latin1");
  const 分隔 = Buffer.from(`\r\n--${界}`, "latin1");
  // 第一条分隔线要么在开头，要么前面有一段序言、以换行结尾
  let 位: number;
  if (全.subarray(0, 首分隔.length).equals(首分隔)) 位 = 首分隔.length;
  else {
    const 序言止 = 全.indexOf(分隔);
    if (序言止 < 0) return null;
    位 = 序言止 + 分隔.length;
  }
  const 段们: 文件段[] = [];
  for (;;) {
    if (全[位] === 0x2d && 全[位 + 1] === 0x2d) return 段们; // --界-- 结尾
    const 行尾 = 全.indexOf("\r\n", 位, "latin1");
    if (行尾 < 0) return null;
    const 头起 = 行尾 + 2;
    const 头尾 = 全.indexOf("\r\n\r\n", 头起, "latin1");
    if (头尾 < 0) return null;
    const 段起 = 头尾 + 4;
    const 段止 = 全.indexOf(分隔, 段起);
    if (段止 < 0) return null;
    const 头 = 全.toString("utf8", 头起, 头尾);
    const 处置 = /^content-disposition:(.*)$/im.exec(头)?.[1] ?? "";
    const 文件名 = /;\s*filename="([^"]*)"/i.exec(处置)?.[1];
    if (文件名 !== undefined) {
      段们.push({
        field: /;\s*name="([^"]*)"/i.exec(处置)?.[1] ?? "",
        name: 文件名,
        type: /^content-type:\s*(.*)$/im.exec(头)?.[1].trim() ?? "",
        字节: 全.subarray(段起, 段止),
      });
      // 回显只回前 20 段：够了就停，不把后面的都切出来（20MB 里塞几十万个空文件段也只切 20 个）
      if (段们.length >= 文件段上限) return 段们;
    }
    位 = 段止 + 分隔.length;
  }
}

export class 超限 extends Error {}

/** 读完请求体（只在内存里），超过上限就停下抛 超限；没有请求体返回空数组 */
export async function 读请求体(body: ReadableStream<Uint8Array> | null, 上限 = 回显上限字节): Promise<Uint8Array> {
  if (!body) return new Uint8Array(0);
  const 块们: Uint8Array[] = [];
  let 共 = 0;
  const r = body.getReader();
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    共 += value.byteLength;
    if (共 > 上限) {
      await r.cancel().catch(() => {});
      throw new 超限();
    }
    块们.push(value);
  }
  const 全 = new Uint8Array(共);
  let 位 = 0;
  for (const b of 块们) {
    全.set(b, 位);
    位 += b.byteLength;
  }
  return 全;
}
