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
