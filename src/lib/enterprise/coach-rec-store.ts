/**
 * 录音点评 · 录音文件放哪、怎么写（11-22，录音点评 PR2）。只管磁盘，不碰库、不判权限（判定在 coach-rec.ts，调用在 coach-rec-db.ts）。
 *
 * 目录：数据目录下 coach-rec/<年月>/<录音编号>/（和 attachments/ 同级，跟着备份走：ent-backup.sh 本机增量拷、异地按文件加密传）
 *   seg-01/0000.part、0001.part……  浏览器一片一片传上来的（每片 ≤5MB，同一片重复传按片号覆盖）
 *   seg-01.<格式>                   传完拼好的一段（拼好就删片；传文件只有这一段）
 *   asr.<格式>                      PR4 规整好交转写的一份（audioPath 指着它）；PR6 起转写成了只留它，原始段、片删掉
 * PR6 清理：只留规整件、删剩下的片目录、目录字节 / 磁盘剩字节（容量闸）、全部录音目录（兜底删没主的），调用在 coach-rec-housekeep.ts
 * 路径只由录音编号、开始年月、段号、片号拼，客户端给的文件名不进路径。
 * 每片先写到 .tmp、fsync、再改名，传一半断了不会留下半片冒充整片；改名后 fsync 目录。
 * 临时文件名带 randomUUID、用 "wx" 独占新建（PR2 审查必修 1）：同一片 / 同一段两个请求同时写，各写各的临时文件，不会写进同一个、拼坏；
 * 谁最后改名谁的算（片内容一样，覆盖无害）。拼段 同时只许一个请求做，由 coach-rec-db.ts 传完 在库里占位 + 进程内锁保证。
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { 附件目录 } from "@/lib/attachments";
import { 是录音编号, 录音月份, 是录音格式, 片上限字节, 片读超时毫秒, 片总时长毫秒, type 录音格式 } from "./coach-rec";

/** 数据目录下的 coach-rec/（和 attachments/ 同级） */
export function 录音根(): string {
  return path.join(path.dirname(附件目录()), "coach-rec");
}

/** 一条录音的目录（相对 录音根 的写法给库里 audioPath 用） */
export function 录音相对目录(r: { id: string; createdAt: Date }): string {
  if (!是录音编号(r.id)) throw new Error("录音编号不对");
  return path.join(录音月份(r.createdAt), r.id);
}
export const 录音目录 = (r: { id: string; createdAt: Date }, 根 = 录音根()): string => path.join(根, 录音相对目录(r));

const 段名 = (段: number) => `seg-${String(段).padStart(2, "0")}`;
const 片名 = (片: number) => `${String(片).padStart(4, "0")}.part`;

/** 库里存的相对路径 → 绝对路径；不在 录音根 下面的（被改过的库值）一律不认 */
export function 认录音文件(相对: string | null | undefined, 根 = 录音根()): string | null {
  if (!相对) return null;
  const 绝 = path.resolve(根, 相对);
  return 绝.startsWith(path.resolve(根) + path.sep) ? 绝 : null;
}

export class 片超限 extends Error {}
/** 收一片时 片读超时毫秒 内一个字节都没来（对方网断了、挂着不发），或者从开始收已经过了 片总时长毫秒：停下，接口回 408 */
export class 片读超时 extends Error {}

/** 读一下请求体，超时就抛 片读超时（计时器读完就清，不留悬着的 setTimeout） */
async function 限时读<T>(p: Promise<T>, 毫秒: number): Promise<T> {
  let 计时: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, 拒) => { 计时 = setTimeout(() => 拒(new 片读超时()), 毫秒); })]);
  } finally {
    clearTimeout(计时);
  }
}

async function 写盘同步目录(dir: string): Promise<void> {
  // 改名落盘：目录也 fsync（Linux 上不做这步，断电时新名字可能丢）。Windows / 部分文件系统不让开目录，忽略
  const h = await fsp.open(dir, "r").catch(() => null);
  if (!h) return;
  await h.sync().catch(() => {});
  await h.close();
}

/**
 * 收一片：边读边写到 .tmp，超过 片上限字节 就停、删临时文件、抛 片超限；超过 片读超时毫秒 没来新字节、或者整片收了超过 片总时长毫秒，
 * 都停、抛 片读超时；读完 fsync、改名成正式片（同号覆盖）。回写了多少字节、开头 16 字节（每段第 0 片拿去认格式）
 */
export async function 写片(dir: string, 段: number, 片: number, 体: ReadableStream<Uint8Array> | null, 上限 = 片上限字节, 超时 = 片读超时毫秒, 总时长 = 片总时长毫秒): Promise<{ 字节: number; 头: Uint8Array }> {
  const 截止 = Date.now() + 总时长;
  const 段目录 = path.join(dir, 段名(段));
  await fsp.mkdir(段目录, { recursive: true });
  const 正式 = path.join(段目录, 片名(片));
  const 临时 = `${正式}.${randomUUID()}.tmp`;
  const h = await fsp.open(临时, "wx", 0o600);
  let 字节 = 0;
  const 头 = new Uint8Array(16);
  let 头满 = 0;
  try {
    if (体) {
      const 读 = 体.getReader();
      for (;;) {
        const 剩 = 截止 - Date.now();
        const { done, value } = await (剩 <= 0 ? Promise.reject<ReadableStreamReadResult<Uint8Array>>(new 片读超时()) : 限时读(读.read(), Math.min(超时, 剩))).catch(async (e) => {
          if (e instanceof 片读超时) await 读.cancel().catch(() => {});
          throw e;
        });
        if (done) break;
        if (!value?.byteLength) continue;
        字节 += value.byteLength;
        if (字节 > 上限) {
          await 读.cancel().catch(() => {});
          throw new 片超限();
        }
        if (头满 < 16) {
          const 取 = value.subarray(0, 16 - 头满);
          头.set(取, 头满);
          头满 += 取.byteLength;
        }
        await h.write(value);
      }
    }
    await h.sync();
    await h.close();
  } catch (e) {
    await h.close().catch(() => {});
    await fsp.rm(临时, { force: true });
    throw e;
  }
  await fsp.rename(临时, 正式);
  await 写盘同步目录(段目录);
  return { 字节, 头: 头.subarray(0, 头满) };
}

/** 已经收到的片（续传用）：段号、片号、字节数；没有目录 = 空 */
export async function 已收片(dir: string): Promise<{ 段: number; 片: number; 字节: number }[]> {
  const 出: { 段: number; 片: number; 字节: number }[] = [];
  const 段们 = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const d of 段们) {
    const m = d.isDirectory() && /^seg-(\d{2})$/.exec(d.name);
    if (!m) continue;
    for (const f of await fsp.readdir(path.join(dir, d.name)).catch(() => [] as string[])) {
      const n = /^(\d{4})\.part$/.exec(f);
      if (!n) continue;
      const st = await fsp.stat(path.join(dir, d.name, f)).catch(() => null);
      if (st) 出.push({ 段: Number(m[1]), 片: Number(n[1]), 字节: st.size });
    }
  }
  return 出.sort((a, b) => a.段 - b.段 || a.片 - b.片);
}

/** 删掉某一片（第一片认不出格式时当场删） */
export async function 删片(dir: string, 段: number, 片: number): Promise<void> {
  await fsp.rm(path.join(dir, 段名(段), 片名(片)), { force: true });
}

/** 删一整段还没拼的片（连片目录，PR3 丢段：上滑取消、不到 1 秒） */
export async function 删段片(dir: string, 段: number): Promise<void> {
  await fsp.rm(path.join(dir, 段名(段)), { recursive: true, force: true });
}

/**
 * 把一段的片按片号接起来写成 seg-NN.<格式>（.tmp → fsync → 改名），再删片目录。回相对 录音根 的路径。
 * 只是字节相接：传文件切的片接回去就是原文件；网页录 MediaRecorder 的分片接起来也是一份完整的（PR3）。转封装、多段拼接是 PR4 的 ffmpeg
 */
export async function 拼段(r: { id: string; createdAt: Date }, 段: number, 格式: 录音格式, 根 = 录音根()): Promise<string> {
  if (!是录音格式(格式)) throw new Error("格式不对");
  const dir = 录音目录(r, 根);
  const 段目录 = path.join(dir, 段名(段));
  const 片们 = (await fsp.readdir(段目录)).filter((f) => /^\d{4}\.part$/.test(f)).sort();
  const 相对 = path.join(录音相对目录(r), `${段名(段)}.${格式}`);
  const 正式 = path.join(根, 相对);
  const 临时 = `${正式}.${randomUUID()}.tmp`;
  const h = await fsp.open(临时, "wx", 0o600);
  try {
    for (const f of 片们) await h.write(await fsp.readFile(path.join(段目录, f)));
    await h.sync();
    await h.close();
  } catch (e) {
    await h.close().catch(() => {});
    await fsp.rm(临时, { force: true });
    throw e;
  }
  await fsp.rename(临时, 正式);
  await 写盘同步目录(dir);
  await fsp.rm(段目录, { recursive: true, force: true });
  return 相对;
}

/** 放弃 / 删掉：整条录音的目录连片带文件删掉 */
export async function 删录音文件(r: { id: string; createdAt: Date }, 根 = 录音根()): Promise<void> {
  await fsp.rm(录音目录(r, 根), { recursive: true, force: true });
}

export function 文件大小(绝: string): number | null {
  try {
    return fs.statSync(绝).size;
  } catch {
    return null;
  }
}

/* ── PR6 清理 ── */

/** 原始段、片目录、规整 / 切段的临时件：转写成了以后不再要（规整件 asr.* 留一份） */
const 原始件 = (名: string) => /^seg-\d{2}(\.[a-z0-9]{2,4})?$/.test(名) || /^asr-part-\d{3}\./.test(名) || 名 === "asr-concat.txt" || 名.endsWith(".tmp");

/**
 * 规整件和原始段只留一份（PR6）：转写成了，留规整件（audioPath 指着的 asr.*，回放、重新整理、到期删都只认它），删原始段 seg-NN.*、片目录 seg-NN/、切段临时件。
 * 规整件不在（读不到、不在这个目录、不是 asr.*）就什么都不删。回删了几个
 */
export async function 只留规整件(r: { id: string; createdAt: Date; audioPath: string | null }, 根 = 录音根()): Promise<number> {
  const 留 = 认录音文件(r.audioPath, 根);
  const dir = 录音目录(r, 根);
  if (!留 || path.dirname(留) !== dir || !/^asr\.[a-z0-9]{2,4}$/.test(path.basename(留))) return 0;
  if (!(await fsp.stat(留).then((x) => x.isFile() && x.size > 0, () => false))) return 0;
  let 删 = 0;
  for (const 名 of await fsp.readdir(dir).catch(() => [] as string[])) {
    if (!原始件(名)) continue;
    await fsp.rm(path.join(dir, 名), { recursive: true, force: true });
    删 += 1;
  }
  return 删;
}

/**
 * 已经拼好的录音（不是上传中）还剩着的片目录 seg-NN/（拼完删片中途出错留下的）：兜底删。回删了几个。
 * 最近 留毫秒 内改过的片目录不动（清理这一轮里用户刚「再录一段」、正在往里写片，PR6 二审）
 */
export async function 删剩下的片目录(r: { id: string; createdAt: Date }, 根 = 录音根(), 留毫秒 = 60 * 60 * 1000, 现在 = Date.now()): Promise<number> {
  const dir = 录音目录(r, 根);
  let 删 = 0;
  for (const d of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (!d.isDirectory() || !/^seg-\d{2}$/.test(d.name)) continue;
    const 改于 = await fsp.stat(path.join(dir, d.name)).then((x) => x.mtimeMs, () => 现在);
    if (现在 - 改于 < 留毫秒) continue;
    await fsp.rm(path.join(dir, d.name), { recursive: true, force: true });
    删 += 1;
  }
  return 删;
}

/** 目录一共多少字节（往下走，链接不跟）；没有目录 = 0 */
export async function 目录字节(dir: string): Promise<number> {
  let 合 = 0;
  for (const d of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const 全 = path.join(dir, d.name);
    if (d.isDirectory()) 合 += await 目录字节(全);
    else if (d.isFile()) 合 += await fsp.stat(全).then((x) => x.size, () => 0);
  }
  return 合;
}

/** 录音根所在磁盘还剩多少字节（根还没建就看上一级）；读不出 = null（不拦） */
export async function 磁盘剩字节(根 = 录音根()): Promise<number | null> {
  for (let d = 根; ; d = path.dirname(d)) {
    const st = await fsp.statfs(d).catch(() => null);
    if (st) return Number(st.bavail) * Number(st.bsize);
    if (path.dirname(d) === d) return null;
  }
}

/** 录音根下面按月的目录里，一条条录音的目录（编号 + 绝对路径）：兜底删没主的目录用。_asrtest 这类不是年月的不看 */
export async function 全部录音目录(根 = 录音根()): Promise<{ id: string; dir: string }[]> {
  const 出: { id: string; dir: string }[] = [];
  for (const 月 of await fsp.readdir(根, { withFileTypes: true }).catch(() => [])) {
    if (!月.isDirectory() || !/^\d{6}$/.test(月.name)) continue;
    for (const d of await fsp.readdir(path.join(根, 月.name), { withFileTypes: true }).catch(() => [])) {
      if (d.isDirectory() && 是录音编号(d.name)) 出.push({ id: d.name, dir: path.join(根, 月.name, d.name) });
    }
  }
  return 出;
}
