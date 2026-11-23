/**
 * 录音点评 · ffmpeg 规整、ffprobe 读时长和采样率、切段（11-22，录音点评 PR4，方案 §4.3）。
 *
 * 规整：所有录音都过一遍（不信扩展名、不信客户端报的时长）——
 *   - 多段（被打断后接着录的）用 concat 接成一个；只转封装（-c:a copy），按编码选腾讯云收的封装：
 *     aac → m4a、mp3 → mp3、opus → ogg（webm 腾讯云不收，转成 ogg）、amr → amr、flac → flac、pcm → wav
 *   - 编码腾讯云不收（vorbis 等）、多声道（16k 引擎只收单声道）、采样率在 8k 和 16k 之间的，才重新编码成 m4a（AAC 单声道）
 *   - 只转封装失败的（分片 mp4、时间戳乱的）退一步重新编码，再失败才算规整不了
 * 时长：规整后的文件 ffprobe 读；读不出（webm 头里常没有时长）就整段解一遍按解到哪算
 * 切段（签名地址取不了时的退路）：-f segment -c copy 切成每段 ≤ 上限字节，按每段实际时长累加出起点
 * ffmpeg / ffprobe 路径：FFMPEG_PATH / FFPROBE_PATH，没设用 PATH 里的。参数只有我们拼的路径（录音编号拼的），不进 shell
 */
import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { 请求体上限字节 } from "./channel";

type 环境 = Record<string, string | undefined>;
const ffmpeg = (env: 环境 = process.env) => env.FFMPEG_PATH?.trim() || "ffmpeg";
const ffprobe = (env: 环境 = process.env) => env.FFPROBE_PATH?.trim() || "ffprobe";

const 规整超时毫秒 = 10 * 60 * 1000;

function 跑(命令: string, 参数: string[], 超时 = 规整超时毫秒): Promise<{ 出: string; 错: string }> {
  return new Promise((ok, 不) => {
    execFile(命令, 参数, { timeout: 超时, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (e, 出, 错) => {
      if (e) 不(Object.assign(new Error(`${path.basename(命令)} 出错：${String(错 || e.message).split("\n").filter(Boolean).slice(-2).join(" / ").slice(0, 300)}`), { 码: (e as { code?: unknown }).code }));
      else ok({ 出: String(出), 错: String(错) });
    });
  });
}

export type 自检结果 = { ok: true; 版本: string } | { ok: false; 话: string };
const 自检缓存: { at: number; 值: 自检结果 | null; 键: string } = { at: 0, 值: null, 键: "" };
const 自检有效毫秒 = 10 * 60 * 1000;

/**
 * 启动自检（方案 §4.3「自检不过 = 录音点评不放开」）：ffmpeg、ffprobe 都在，ffmpeg 带 aac 编码器（重新编码要用）。
 * 结果在进程里记 10 分钟（每次开客户页都要判，不每次起子进程）
 */
export async function ffmpeg自检(env: 环境 = process.env, 现在 = Date.now()): Promise<自检结果> {
  const 键 = `${ffmpeg(env)}|${ffprobe(env)}`;
  if (自检缓存.值 && 自检缓存.键 === 键 && 现在 - 自检缓存.at < 自检有效毫秒) return 自检缓存.值;
  let 值: 自检结果;
  try {
    const v = await 跑(ffmpeg(env), ["-hide_banner", "-version"], 15_000);
    await 跑(ffprobe(env), ["-hide_banner", "-version"], 15_000);
    const 编码器 = await 跑(ffmpeg(env), ["-hide_banner", "-encoders"], 15_000);
    值 = /\baac\b/.test(编码器.出) ? { ok: true, 版本: (/ffmpeg version (\S+)/.exec(v.出)?.[1] ?? "?").slice(0, 40) } : { ok: false, 话: "ffmpeg 没有 aac 编码器" };
  } catch (e) {
    值 = { ok: false, 话: (e as { 码?: unknown }).码 === "ENOENT" ? "服务器上没装 ffmpeg / ffprobe" : "ffmpeg / ffprobe 跑不起来" };
  }
  Object.assign(自检缓存, { at: 现在, 值, 键 });
  return 值;
}
/** 测试用：清掉自检缓存 */
export const 清自检缓存 = () => Object.assign(自检缓存, { at: 0, 值: null, 键: "" });

export type 探到 = { 编码: string | null; 采样率: number | null; 声道: number | null; 时长毫秒: number | null };

/** ffprobe 读第一条音轨的编码、采样率、声道和整个文件的时长；读不出的项 = null */
export async function 探(文件: string, env: 环境 = process.env): Promise<探到> {
  const { 出 } = await 跑(ffprobe(env), ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name,sample_rate,channels:format=duration", "-of", "json", 文件], 60_000);
  const j = JSON.parse(出) as { streams?: { codec_name?: string; sample_rate?: string; channels?: number }[]; format?: { duration?: string } };
  const s = j.streams?.[0];
  const 秒 = Number(j.format?.duration);
  const 率 = Number(s?.sample_rate);
  return {
    编码: s?.codec_name ?? null,
    采样率: Number.isFinite(率) && 率 > 0 ? 率 : null,
    声道: typeof s?.channels === "number" ? s.channels : null,
    时长毫秒: Number.isFinite(秒) && 秒 > 0 ? Math.round(秒 * 1000) : null,
  };
}

/** 读不出时长的：整段解一遍（-f null），按最后一个 time= 算 */
async function 解出时长(文件: string, env: 环境): Promise<number | null> {
  const { 错 } = await 跑(ffmpeg(env), ["-hide_banner", "-nostdin", "-i", 文件, "-vn", "-f", "null", "-"]);
  const 全 = [...错.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].pop();
  if (!全) return null;
  const 毫秒 = Math.round((Number(全[1]) * 3600 + Number(全[2]) * 60 + Number(全[3])) * 1000);
  return 毫秒 > 0 ? 毫秒 : null;
}

/** 一个文件有多长（PR3 传完时给待提交卡写时长）：先读头，读不出（网页录的 webm、分片 mp4 常没写时长）再整段解一遍；都不行 = null */
export async function 读时长(文件: string, env: 环境 = process.env): Promise<number | null> {
  return (await 探(文件, env)).时长毫秒 ?? (await 解出时长(文件, env));
}

/** 腾讯云收、能直接转封装的编码 → 封装（扩展名就是库里 format 列的值） */
const 转封装 = (编码: string | null): { 格式: "m4a" | "mp3" | "ogg" | "amr" | "flac" | "wav"; 封装: string } | null => {
  if (!编码) return null;
  if (编码 === "aac") return { 格式: "m4a", 封装: "mp4" };
  if (编码 === "mp3") return { 格式: "mp3", 封装: "mp3" };
  if (编码 === "opus") return { 格式: "ogg", 封装: "ogg" };
  if (编码 === "amr_nb" || 编码 === "amr_wb") return { 格式: "amr", 封装: "amr" };
  if (编码 === "flac") return { 格式: "flac", 封装: "flac" };
  if (/^pcm_s16le$/.test(编码)) return { 格式: "wav", 封装: "wav" };
  return null;
};

export type 规整结果 = { 文件: string; 格式: "m4a" | "mp3" | "ogg" | "amr" | "flac" | "wav"; 采样率: number | null; 时长毫秒: number | null; 重编码: boolean };

/**
 * 把一条录音的几段（按顺序）规整成 出目录/asr.<格式> 一个文件。已经有这个文件的先删（重试时重做，不认半截）。
 * 出错抛 Error（话给日志，不带业务内容；给人看的话由调用方写「录音文件处理不了」）
 */
export async function 规整(段们: readonly string[], 出目录: string, env: 环境 = process.env): Promise<规整结果> {
  if (!段们.length) throw new Error("没有录音文件");
  const 头 = await 探(段们[0], env);
  const 封 = 转封装(头.编码);
  const 要重编 = !封 || (头.声道 ?? 1) > 1 || (头.采样率 !== null && 头.采样率 > 8000 && 头.采样率 < 16000);
  const 输入参数: string[] = [];
  let 列表: string | null = null;
  if (段们.length === 1) 输入参数.push("-i", 段们[0]);
  else {
    // concat 分离器：文件列表里只有我们自己拼的绝对路径（录音编号、段号），单引号转义照 ffmpeg 规矩
    列表 = path.join(出目录, "asr-concat.txt");
    await fsp.writeFile(列表, 段们.map((f) => `file '${path.resolve(f).replace(/'/g, "'\\''")}'`).join("\n") + "\n", { mode: 0o600 });
    输入参数.push("-f", "concat", "-safe", "0", "-i", 列表);
  }
  const 做 = async (重编: boolean): Promise<规整结果> => {
    const 格式 = 重编 ? "m4a" : 封!.格式;
    const 出 = path.join(出目录, `asr.${格式}`);
    await fsp.rm(出, { force: true });
    const 编码参数 = 重编
      ? ["-ac", "1", ...(头.采样率 !== null && 头.采样率 > 8000 && 头.采样率 < 16000 ? ["-ar", "16000"] : []), "-c:a", "aac", "-b:a", "48k", "-f", "mp4", "-movflags", "+faststart"]
      : ["-c:a", "copy", "-f", 封!.封装, ...(封!.封装 === "mp4" ? ["-movflags", "+faststart"] : [])];
    try {
      await 跑(ffmpeg(env), ["-hide_banner", "-nostdin", "-y", "-fflags", "+genpts", ...输入参数, "-vn", "-map_metadata", "-1", ...编码参数, 出]);
    } catch (e) {
      await fsp.rm(出, { force: true });
      throw e;
    }
    const 后 = await 探(出, env);
    const 时长毫秒 = 后.时长毫秒 ?? (await 解出时长(出, env));
    return { 文件: 出, 格式, 采样率: 后.采样率 ?? 头.采样率, 时长毫秒, 重编码: 重编 };
  };
  try {
    if (要重编) return await 做(true);
    try {
      return await 做(false);
    } catch {
      return await 做(true);
    }
  } finally {
    if (列表) await fsp.rm(列表, { force: true });
  }
}

/** 采样率 ≤8000 的走 8k 引擎（电话录音、amr），其余 16k */
export const 采样档 = (采样率: number | null): "8k" | "16k" => (采样率 !== null && 采样率 <= 8000 ? "8k" : "16k");

export type 切出的段 = { 文件: string; 起毫秒: number; 字节: number };

/**
 * 切段（签名地址取不了时的退路，方案 §4.3）：按 时长 × 上限 / 大小 估每段秒数（打九折），-f segment -c copy 切；
 * 有一段还超上限就缩到七成再切，最多切 4 次。每段的起点按前面各段 ffprobe 出的实际时长累加（切点落在帧边界上，不是整秒）
 */
export async function 切段(文件: string, 时长毫秒: number, 出目录: string, 上限字节 = 请求体上限字节, env: 环境 = process.env): Promise<切出的段[]> {
  const 大小 = (await fsp.stat(文件)).size;
  const 格式 = path.extname(文件).slice(1);
  const 封装 = 格式 === "m4a" ? "mp4" : 格式;
  let 秒 = Math.max(5, Math.floor(((时长毫秒 / 1000) * 上限字节 * 0.9) / Math.max(1, 大小)));
  for (let 次 = 0; 次 < 4; 次++) {
    for (const f of await fsp.readdir(出目录)) if (/^asr-part-\d{3}\./.test(f)) await fsp.rm(path.join(出目录, f), { force: true });
    await 跑(ffmpeg(env), ["-hide_banner", "-nostdin", "-y", "-i", 文件, "-vn", "-c", "copy", "-f", "segment", "-segment_time", String(秒), "-segment_format", 封装, "-reset_timestamps", "1", path.join(出目录, `asr-part-%03d.${格式}`)]);
    const 名们 = (await fsp.readdir(出目录)).filter((f) => /^asr-part-\d{3}\./.test(f)).sort();
    const 们: 切出的段[] = [];
    let 起 = 0;
    let 超 = false;
    for (const 名 of 名们) {
      const f = path.join(出目录, 名);
      const 字节 = (await fsp.stat(f)).size;
      if (字节 > 上限字节) 超 = true;
      们.push({ 文件: f, 起毫秒: 起, 字节 });
      起 += (await 探(f, env)).时长毫秒 ?? 秒 * 1000;
    }
    if (!超 && 们.length) return 们;
    秒 = Math.max(5, Math.floor(秒 * 0.7));
  }
  throw new Error("切不到每段 5MB 以下");
}

/** 测试连接用的样例音频（3 秒 440Hz 单声道 16k m4a，ffmpeg 现生成，不用业务数据） */
export async function 生成样例(出: string, env: 环境 = process.env): Promise<void> {
  await 跑(ffmpeg(env), ["-hide_banner", "-nostdin", "-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000:duration=3", "-ac", "1", "-c:a", "aac", "-b:a", "32k", "-f", "mp4", 出], 60_000);
}
