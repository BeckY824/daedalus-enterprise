/**
 * 录音点评 · 转写队列（11-22，录音点评 PR4：腾讯云转写，方案 §4、§4.3、§4.4）。只在跑后台任务的那个进程跑（instrumentation.ts → lib/jobs.ts）。
 *
 * 一条录音点「提交整理」→ 状态 转写中、asrSubmittedAt 空（排队）。这里每 5 秒一轮：
 *   1. 开关关着：什么都不做（转写中的原样放着，开回来接着走）
 *   2. 交（一次一条，规整占 CPU）：ffmpeg 规整（拼段、转封装，见 asr/ffmpeg.ts）→ 读时长（>2 小时、<1 秒的判失败）→ 交给通道：
 *        规整后 ≤ 请求体上限字节 → 请求体；更大的按设置「大文件怎么交」：签名地址（ENT_PUBLIC_URL + 签取文件地址，30 分钟有效）
 *        或 切段（每段 ≤ 请求体上限、各自提交、结果按时间接起来）。没配 ENT_PUBLIC_URL 的签名地址也退到切段
 *      交上了：asrTaskId 记任务号们（JSON：[{t: 任务号, 起: 这段在整条里的起点毫秒}]）、asrSubmittedAt、engine
 *      切段的每交上一段就先落任务号（asrSubmittedAt 还空 = 没交齐），重试、重启后起点对得上的段不再交（防重复计费）
 *      交不上：网络、5xx、限频 → 30 秒 / 2 分钟 / 10 分钟各再试一次，还不行 → 整理失败；密钥不对、参数不对这类 → 当场整理失败
 *   3. 查（交上了的，可以几条一起）：交后 2 分钟内 10 秒一次，之后 30 秒一次；超过 3 小时没结果 → 整理失败
 *      全部成功 → 落库（transcript「(mm:ss) 说话人 N：…」、segments、speakers、durationMs）、状态 → 整理中
 *   4. 整理（PR5，整理一轮，钟上单独一条线）：整理中 → AI 整理 → 待确认 + 通知「整理好了」；模型出错 → 整理失败（转写留着）
 *      有一段失败 → 整理失败（腾讯云原话不给人看，按关键字归成一句白话）
 *   整理失败：error 写一句给人看的话（不带密钥、签名、请求原文），给录的人发一条通知（铃铛 + 飞书，notice-sources.ts 录音没整理成通知）
 * 服务重启：交上了的（asrSubmittedAt 有值）接着轮询——超过 3 小时的那一轮就判失败（腾讯云结果只留 24 小时，3 小时以内都还在）；
 *   排队的（还没交）接着交；重试次数在内存里，重启后从头数（不自动重跑一串，最多多试 3 次）；整理中的（PR5）重启后再整理一次
 * 用量：转写成功记一条 ai_use（功能键 asr，「录音转写」，明细里带秒数），设置页按秒合计
 * 只留一份（PR6）：转写成了就删原始段（seg-NN.*）和片、切段临时件，留规整件 asr.*（audioPath 指着它）；之后再交（重新转写）直接用规整件。
 * 草稿起算（PR6）：进待确认、整理失败时记 endedAt（清掉 remindedAt），7 天没发出由 coach-rec-housekeep.ts 自动删。钟上每小时跑一轮清理
 */
import path from "node:path";
import fsp from "node:fs/promises";
import { prisma, defaultClient } from "@/lib/prisma";
import { 主题写 } from "@/lib/team-scope";
import { recordAudit } from "@/lib/audit";
import { getSetting } from "@/lib/settings";
import { 录音点评开着 } from "./coach-rec-db";
import { 时长上限毫秒 } from "./coach-rec";
import { 录音根, 录音相对目录, 认录音文件, 只留规整件 } from "./coach-rec-store";
import { 签取文件地址 } from "./coach-rec-sign";
import { 站点源 } from "./feishu-jsapi";
import { 录音没整理成通知, 录音整理好了通知 } from "./notice-sources";
import { AI整理, 没听清话 } from "./coach-rec-summary";
import { 选通道, 通道错, 请求体上限字节, type 转写通道, type 转写句, type 交的音频 } from "./asr/channel";
import { 规整, 切段, 采样档, ffmpeg自检, 读时长, type 规整结果 } from "./asr/ffmpeg";
import { 清理一轮, 清理间隔毫秒 } from "./coach-rec-housekeep";

/** 设置「大文件怎么交」（系统管理员在设置 → AI 接入 → 语音转文字里拨）：签名地址（默认）/ 切段 */
export const 大文件交法键 = "enterprise.coachRec.asrBig";
export const 大文件交法们 = ["签名地址", "切段"] as const;
export type 大文件交法 = (typeof 大文件交法们)[number];
export async function 读大文件交法(): Promise<大文件交法> {
  const v = await getSetting<string>(大文件交法键);
  return v === "切段" ? "切段" : "签名地址";
}

export const 重试间隔毫秒 = [30_000, 2 * 60_000, 10 * 60_000] as const;
export const 前段毫秒 = 2 * 60_000;
export const 前段间隔毫秒 = 10_000;
export const 后段间隔毫秒 = 30_000;
export const 最长转写毫秒 = 3 * 60 * 60_000;
export const 钟间隔毫秒 = 5_000;
/** 短于这个不转（按住说话不到 1 秒的前端就放弃了；传文件传了个空壳的在这里拦） */
export const 最短毫秒 = 1_000;

type 任务 = { t: string; 起: number };
const 选 = { id: true, projectId: true, authorId: true, status: true, format: true, segCount: true, audioPath: true, durationMs: true, sampleRate: true, asrTaskId: true, asrSubmittedAt: true, createdAt: true } as const;
type 行 = { id: string; projectId: string; authorId: string; status: string; format: string | null; segCount: number; audioPath: string | null; durationMs: number | null; sampleRate: number | null;
  asrTaskId: string | null; asrSubmittedAt: Date | null; createdAt: Date };

type 内存 = { 退避: Map<string, { 次: number; 下次: number }>; 上次查: Map<string, number>; 在跑: boolean; 整理在跑: boolean; 钟?: ReturnType<typeof setInterval>;
  /** 整理好了但写库一直失败的（连 整理失败 也写不进）：到这个时刻以前不再拿出来整理（不每 5 秒重调一次模型，PR5 审查） */
  整理别碰?: Map<string, number>;
  /** 清理（PR6）：在跑没有、上次跑的时刻 */
  清理在跑?: boolean; 上次清理?: number };
const g = globalThis as unknown as { __录音转写?: 内存 };
const 存: 内存 = (g.__录音转写 ??= { 退避: new Map(), 上次查: new Map(), 在跑: false, 整理在跑: false });
const 整理别碰 = (): Map<string, number> => (存.整理别碰 ??= new Map());
/** 写库一直失败时隔多久再拿出来整理 */
export const 整理写失败等毫秒 = 10 * 60_000;
/** 测试用：模拟进程重启（内存里的重试次数、上次查的时刻都清掉） */
export function 清转写内存(): void {
  存.整理别碰?.clear();
  存.退避.clear();
  存.上次查.clear();
  存.在跑 = false;
  存.整理在跑 = false;
}

export function 读任务们(x: string | null): 任务[] {
  if (!x) return [];
  try {
    const v = JSON.parse(x) as unknown;
    return Array.isArray(v) ? v.filter((t): t is 任务 => !!t && typeof t.t === "string" && typeof t.起 === "number") : [];
  } catch {
    return [];
  }
}

const 两位 = (n: number) => String(n).padStart(2, "0");
const 时刻 = (毫秒: number) => {
  const 秒 = Math.floor(毫秒 / 1000);
  return 秒 >= 3600 ? `${Math.floor(秒 / 3600)}:${两位(Math.floor((秒 % 3600) / 60))}:${两位(秒 % 60)}` : `${两位(Math.floor(秒 / 60))}:${两位(秒 % 60)}`;
};
/** 转写全文：每句一行「(mm:ss) 说话人 N：文字」（N 从 1 数；没分出说话人的不写说话人） */
export function 拼全文(句们: readonly 转写句[]): string {
  return 句们.map((x) => `(${时刻(x.起)}) ${x.说话人 === null ? "" : `说话人 ${x.说话人 + 1}：`}${x.文字}`).join("\n");
}

/** 整理失败：只改还在转写中（或整理中）的；改到了给录的人发通知、清内存 */
async function 失败(r: { id: string; projectId: string; authorId: string }, 话: string, 从: "转写中" | "整理中" = "转写中"): Promise<void> {
  存.退避.delete(r.id);
  存.上次查.delete(r.id);
  const 改 = await 主题写(() => prisma.entCoachRecording.updateMany({ where: { id: r.id, status: 从, deletedAt: null }, data: { status: "整理失败", error: 话.slice(0, 300), endedAt: new Date(), remindedAt: null } }));
  if (改.count !== 1) return;
  console.warn(`[录音转写] ${r.id} 整理失败：${话.slice(0, 120)}`);
  await 录音没整理成通知(r.authorId, { id: r.id, projectId: r.projectId }, 话);
}

/** 交不上（可重试的）：按 30 秒 / 2 分钟 / 10 分钟排下一次；三次都用完 → 整理失败 */
async function 退一步(r: 行, 话: string, 现在: number): Promise<void> {
  const 次 = (存.退避.get(r.id)?.次 ?? 0) + 1;
  if (次 > 重试间隔毫秒.length) return 失败(r, `${话.replace(/，?稍后会自动再试$/, "")}（自动重试了 ${重试间隔毫秒.length} 次都没成）`);
  存.退避.set(r.id, { 次, 下次: 现在 + 重试间隔毫秒[次 - 1] });
}

/** 一条录音的原始各段（seg-01.<格式>…，PR2 传完拼好的），按段号 */
function 原段们(r: 行): string[] | null {
  if (!r.format || r.segCount < 1) return null;
  const 们: string[] = [];
  for (let s = 1; s <= r.segCount; s++) {
    const f = 认录音文件(path.join(录音相对目录(r), `seg-${两位(s)}.${r.format}`));
    if (!f) return null;
    们.push(f);
  }
  return 们;
}

/** 交一条：规整 → 判时长 → 选交法 → 提交（各段）→ 记任务号 */
async function 交一条(r: 行, 通道: 转写通道 | null, 现在: number): Promise<void> {
  if (!通道) return 失败(r, "语音转文字还没配好（服务器没配密钥），请系统管理员到设置 → AI 接入 →「语音转文字」里看");
  const 检 = await ffmpeg自检();
  if (!检.ok) return 失败(r, `服务器上的录音处理工具不可用（${检.话}），请系统管理员处理`);
  // 原始段：第一次交时 format 还是上传时认出的格式；重试时 audioPath 已经指向 asr.*，原始段还在，照样从原始段重做。
  // 转写成过一次、原始段已经删了（PR6 只留规整件）：直接用规整件再交，不再规整
  const 原 = await 原始段们(r);
  const 现成 = 原 ? null : await 现成规整件(r);
  if (!原 && !现成) return 失败(r, "录音文件不在了，删掉这条重新传");
  const 目录 = path.dirname(原 ? 原[0] : 现成!.文件);
  let 规: 规整结果;
  if (现成) 规 = 现成;
  else {
    try {
      规 = await 规整(原!, 目录);
    } catch (e) {
      console.warn(`[录音转写] ${r.id} 规整失败：${e instanceof Error ? e.message.slice(0, 200) : e}`);
      return 失败(r, "录音文件处理不了（可能文件坏了或者不是录音），可以删掉重新传");
    }
  }
  if (规.时长毫秒 === null) return 失败(r, "读不出录音有多长（文件可能坏了），可以删掉重新传");
  if (规.时长毫秒 > 时长上限毫秒) return 失败(r, `录音超过 ${时长上限毫秒 / 3_600_000} 小时，转不了；可以用录音机 App 分成几段再传`);
  if (规.时长毫秒 < 最短毫秒) return 失败(r, "录音太短（不到 1 秒），没有可转的内容");
  // 重试时规整出的格式变了（比如上次 copy 成 ogg、这次重编成 m4a）：旧的 asr.* 删掉，目录里只留这一份（PR4 审查）
  for (const f of await fsp.readdir(目录).catch(() => [] as string[])) {
    if (/^asr\.[a-z0-9]{2,4}$/.test(f) && path.join(目录, f) !== 规.文件) await fsp.rm(path.join(目录, f), { force: true }).catch(() => {});
  }
  const 相对 = path.relative(录音根(), 规.文件);
  await 主题写(() => prisma.entCoachRecording.updateMany({
    where: { id: r.id, status: "转写中" },
    data: { audioPath: 相对, format: 规.格式, durationMs: 规.时长毫秒, sampleRate: 规.采样率 },
  }));
  const 档 = 采样档(规.采样率);
  const 大小 = (await fsp.stat(规.文件)).size;
  const 源 = 站点源(process.env.ENT_PUBLIC_URL);
  // 交法：小的放请求体；大的按设置走签名地址或切段（签名地址要配了 ENT_PUBLIC_URL）。音频到交的时候才读（已交过的段不读）
  const 段们: { 取: () => Promise<交的音频>; 起: number }[] = [];
  try {
    if (大小 <= 请求体上限字节) 段们.push({ 取: async () => ({ 方式: "请求体", 数据: await fsp.readFile(规.文件) }), 起: 0 });
    else if ((await 读大文件交法()) === "签名地址" && 源) 段们.push({ 取: async () => ({ 方式: "地址", url: `${源}${签取文件地址(r.id)}` }), 起: 0 });
    else {
      try {
        for (const x of await 切段(规.文件, 规.时长毫秒, 目录)) 段们.push({ 取: async () => ({ 方式: "请求体", 数据: await fsp.readFile(x.文件) }), 起: x.起毫秒 });
      } catch (e) {
        console.warn(`[录音转写] ${r.id} 切段失败：${e instanceof Error ? e.message.slice(0, 200) : e}`);
        return 失败(r, "录音切段失败，可以删掉重新传，或者请系统管理员把「大文件怎么交」改成签名地址");
      }
    }
    // 防重复计费（PR4 审查）：切段时每交上一段就把任务号落库（asrTaskId，asrSubmittedAt 还空着 = 没交齐）；
    // 退一步重试、进程重启后再进来，起点对得上的段直接用上次的任务号、不再交。整条只有一个任务（请求体 / 签名地址）的，上次的半截不认
    const 多段 = 段们.length > 1;
    const 起们 = new Set(段们.map((x) => x.起));
    const 任务们: 任务[] = 多段 ? 读任务们(r.asrTaskId).filter((t) => 起们.has(t.起)) : [];
    try {
      for (const x of 段们) {
        if (任务们.some((t) => t.起 === x.起)) continue;
        任务们.push({ t: await 通道.提交({ 档, 音频: await x.取() }), 起: x.起 });
        if (!多段) continue;
        const 记 = await 主题写(() => prisma.entCoachRecording.updateMany({
          where: { id: r.id, status: "转写中", asrSubmittedAt: null },
          data: { asrTaskId: JSON.stringify(任务们) },
        }));
        if (记.count !== 1) return; // 这条刚被删 / 放弃了：剩下的段不交了
      }
    } catch (e) {
      if (e instanceof 通道错 && !e.可重试) return 失败(r, e.话);
      const 话 = e instanceof 通道错 ? e.话 : "提交转写时出错了，稍后会自动再试";
      if (!(e instanceof 通道错)) console.warn(`[录音转写] ${r.id} 提交出错：${e instanceof Error ? e.message.slice(0, 200) : e}`);
      return 退一步(r, 话, 现在);
    }
    任务们.sort((x, y) => x.起 - y.起);
    存.退避.delete(r.id);
    存.上次查.set(r.id, 现在);
    await 主题写(() => prisma.entCoachRecording.updateMany({
      where: { id: r.id, status: "转写中", asrSubmittedAt: null },
      data: { asrTaskId: JSON.stringify(任务们), asrSubmittedAt: new Date(现在), engine: `${通道.名}·${通道.引擎(档)}`, error: null },
    }));
  } finally {
    // 切出来的段交完（或中途出错）都删掉，切段本身抛错时留下的半截也一起删（PR4 审查）
    for (const f of await fsp.readdir(目录).catch(() => [] as string[])) if (/^asr-part-\d{3}\./.test(f)) await fsp.rm(path.join(目录, f), { force: true }).catch(() => {});
  }
}

/** 已经规整好的 asr.*（audioPath 指着、文件在）：原始段删了以后重新转写用 */
async function 现成规整件(r: 行): Promise<规整结果 | null> {
  const f = 认录音文件(r.audioPath);
  if (!f || !/^asr\.[a-z0-9]{2,4}$/.test(path.basename(f)) || !r.format) return null;
  if (!(await fsp.stat(f).then((x) => x.isFile() && x.size > 0, () => false))) return null;
  const 时长毫秒 = r.durationMs ?? (await 读时长(f).catch(() => null));
  return { 文件: f, 格式: r.format as 规整结果["格式"], 采样率: r.sampleRate, 时长毫秒, 重编码: false };
}

/** 原始段的路径：按 segCount 和上传时认出的格式（format 列被规整改过时，从目录里找 seg-NN.*） */
async function 原始段们(r: 行): Promise<string[] | null> {
  const 直接 = 原段们(r);
  if (直接 && (await Promise.all(直接.map((f) => fsp.stat(f).then(() => true, () => false)))).every(Boolean)) return 直接;
  if (r.segCount < 1) return null;
  const 目录 = path.join(录音根(), 录音相对目录(r));
  const 名们 = await fsp.readdir(目录).catch(() => [] as string[]);
  const 们: string[] = [];
  for (let s = 1; s <= r.segCount; s++) {
    const 名 = 名们.find((n) => new RegExp(`^seg-${两位(s)}\\.[a-z0-9]{2,4}$`).test(n));
    if (!名) return null;
    们.push(path.join(目录, 名));
  }
  return 们;
}

/** 查一条：到点了才查；全成功落库进整理中，有失败的判失败，超 3 小时判失败 */
async function 查一条(r: 行, 通道: 转写通道 | null, 现在: number): Promise<void> {
  const 交于 = r.asrSubmittedAt!.getTime();
  if (现在 - 交于 > 最长转写毫秒) return 失败(r, "转写超过 3 小时没出结果，可以点「重试整理」再交一次");
  const 上次 = 存.上次查.get(r.id) ?? 交于;
  if (现在 - 上次 < (现在 - 交于 < 前段毫秒 ? 前段间隔毫秒 : 后段间隔毫秒)) return;
  if (!通道) return; // 密钥被撤了：等 3 小时判失败（不在这里猜是不是临时的）
  存.上次查.set(r.id, 现在);
  const 任务们 = 读任务们(r.asrTaskId);
  if (!任务们.length) return 失败(r, "转写任务号丢了，可以点「重试整理」再交一次");
  const 句们: 转写句[] = [];
  let 时长 = 0;
  for (const 任 of 任务们) {
    let 果;
    try {
      果 = await 通道.查(任.t);
    } catch (e) {
      if (e instanceof 通道错 && !e.可重试) return 失败(r, e.话);
      return; // 网络、5xx：下一轮再查
    }
    if (果.状态 === "失败") return 失败(r, 果.话);
    if (果.状态 !== "成功") return;
    for (const x of 果.句们) 句们.push({ ...x, 起: x.起 + 任.起, 止: x.止 + 任.起 });
    时长 = Math.max(时长, 任.起 + (果.时长毫秒 ?? 0));
  }
  const 人们 = new Set(句们.map((x) => x.说话人).filter((x): x is number => x !== null));
  const 改 = await 主题写(() => prisma.entCoachRecording.updateMany({
    where: { id: r.id, status: "转写中", asrTaskId: r.asrTaskId },
    data: {
      status: "整理中", transcript: 拼全文(句们), segments: JSON.stringify(句们), speakers: 人们.size || null, error: null,
      ...(r.durationMs ? {} : 时长 ? { durationMs: 时长 } : {}),
    },
  }));
  存.上次查.delete(r.id);
  if (改.count !== 1) return;
  // 只留一份（PR6）：转写成了，原始段和片删掉，留规整件（删不掉的清理一轮兜底再删）
  await 只留规整件(r).catch((e) => console.warn(`[录音转写] ${r.id} 删原始段出错：${e instanceof Error ? e.message.slice(0, 200) : e}`));
  const 秒 = Math.round((r.durationMs ?? 时长) / 1000);
  const 作者 = await defaultClient.user.findUnique({ where: { id: r.authorId }, select: { id: true, name: true } });
  if (作者) await recordAudit({ user: 作者, action: "ai_use", entity: "Ai", entityId: "asr", summary: `录音转写 ${秒} 秒`, detail: { 对象: r.id, 秒 } });
  // 整理中 → AI 整理（整理一轮，钟上另一条线，不挡这边轮询）
}

/**
 * AI 整理一条（PR5，改版方案 §4.3–4.4）：整理中 → 待确认（draftTitle、draftBody；没听清的草稿空着、error 写一句提示），通知录的人「整理好了」。
 * 模型出错 → 整理失败（转写留着：确认框照开、自己写主题要点也能发；「重试整理」直接再整理，不再转写）。
 * 调了模型就记一笔 ai_use（coachSum「录音点评整理」，不扣个人 AI 提问次数）；字数不够没调模型的不记。
 * 一次一条（模型一次最多两分钟，单独一条线，不挡转写轮询）。服务重启时还在整理中的：重启后这里接着再整理一次（不另判失败）
 */
export async function 整理一轮(opt: { 整理?: typeof AI整理; 现在?: number } = {}): Promise<number> {
  if (!(await 录音点评开着())) return 0;
  const 现在 = opt.现在 ?? Date.now();
  const 别碰 = [...整理别碰()].filter(([, 到]) => 到 > 现在).map(([id]) => id);
  const r = await defaultClient.entCoachRecording.findFirst({
    where: { status: "整理中", deletedAt: null, ...(别碰.length ? { id: { notIn: 别碰 } } : {}) },
    orderBy: { updatedAt: "asc" },
    select: { id: true, projectId: true, authorId: true, transcript: true, speakers: true, asrTaskId: true },
  });
  if (!r) return 0;
  if (!r.transcript) {
    await 失败(r, "转写结果不在了，点「重试整理」重新转写", "整理中");
    return 1;
  }
  let 果: Awaited<ReturnType<typeof AI整理>>;
  try {
    果 = await (opt.整理 ?? AI整理)(r.transcript, r.speakers, 读任务们(r.asrTaskId).length > 1);
  } catch (e) {
    const 原话 = e instanceof Error && /[\u4e00-\u9fa5]/.test(e.message) ? e.message.replace(/[，。]?请?稍后(再)?重试。?$/, "").slice(0, 80) : "AI 没回话";
    await 失败(r, `AI 没整理成（${原话}），可以点「重试整理」，或者打开确认框自己写主题和要点发出`, "整理中");
    return 1;
  }
  // 调了模型就先记用量（后面写库失败也算调过一次）
  const 作者 = await defaultClient.user.findUnique({ where: { id: r.authorId }, select: { id: true, name: true } });
  if (果.调了 && 作者) await recordAudit({ user: 作者, action: "ai_use", entity: "Ai", entityId: "coachSum", summary: "录音点评整理", detail: { 对象: r.id } }).catch(() => {});
  let 改: { count: number };
  try {
    改 = await 主题写(() => prisma.entCoachRecording.updateMany({
      where: { id: r.id, status: "整理中", deletedAt: null },
      // endedAt：草稿 7 天从这一刻算（PR6），提醒过的重新算
      data: 果.可总结
        ? { status: "待确认", draftTitle: 果.主题, draftBody: 果.要点, error: null, endedAt: new Date(现在), remindedAt: null }
        : { status: "待确认", draftTitle: null, draftBody: null, error: 没听清话, endedAt: new Date(现在), remindedAt: null },
    }));
  } catch (e) {
    // 写库失败（锁住、磁盘问题）：算一次失败，不留在整理中让下一轮再调模型（PR5 审查）；连失败也写不进的，这条 10 分钟内不再拿出来
    console.warn(`[录音整理] ${r.id} 写结果出错：${e instanceof Error ? e.message.slice(0, 200) : e}`);
    整理别碰().set(r.id, 现在 + 整理写失败等毫秒);
    await 失败(r, "AI 整理好了，但存的时候出错了，可以点「重试整理」", "整理中").catch(() => {});
    return 1;
  }
  整理别碰().delete(r.id);
  if (改.count === 1) await 录音整理好了通知(r.authorId, { id: r.id, projectId: r.projectId });
  return 1;
}

/**
 * 跑一轮（钟每 5 秒调一次；测试直接调）。通道不传 = 按环境现选。回这一轮交了几条、查了几条
 */
export async function 转写一轮(opt: { 现在?: number; 通道?: 转写通道 | null } = {}): Promise<{ 交: number; 查: number }> {
  const 数 = { 交: 0, 查: 0 };
  if (!(await 录音点评开着())) return 数;
  const 行们 = (await defaultClient.entCoachRecording.findMany({ where: { status: "转写中", deletedAt: null }, select: 选, orderBy: { updatedAt: "asc" }, take: 200 })) as 行[];
  if (!行们.length) return 数;
  const 现在 = opt.现在 ?? Date.now();
  const 通道 = opt.通道 !== undefined ? opt.通道 : await 选通道();
  for (const r of 行们.filter((x) => x.asrSubmittedAt)) {
    数.查 += 1;
    await 查一条(r, 通道, 现在).catch((e) => console.warn(`[录音转写] ${r.id} 查结果出错：${e instanceof Error ? e.message.slice(0, 200) : e}`));
  }
  const 待交 = 行们.find((x) => !x.asrSubmittedAt && (存.退避.get(x.id)?.下次 ?? 0) <= 现在);
  if (待交) {
    数.交 += 1;
    await 交一条(待交, 通道, 现在).catch(async (e) => {
      console.warn(`[录音转写] ${待交.id} 交的时候出错：${e instanceof Error ? e.message.slice(0, 200) : e}`);
      await 退一步(待交, "提交转写时出错了，稍后会自动再试", 现在).catch(() => {});
    });
  }
  return 数;
}

/** 起钟（instrumentation.ts 跑后台任务时调）：每 5 秒一轮，转写、整理两条线各自跑，上一轮没跑完就跳过这一轮；清理（PR6）每小时一轮 */
export function 启动转写钟(间隔 = 钟间隔毫秒): void {
  if (存.钟) return;
  存.钟 = setInterval(() => {
    if (!存.清理在跑 && Date.now() - (存.上次清理 ?? 0) >= 清理间隔毫秒) {
      存.清理在跑 = true;
      存.上次清理 = Date.now();
      清理一轮()
        .catch((e) => console.warn(`[录音清理] 这一轮出错：${e instanceof Error ? e.message.slice(0, 200) : e}`))
        .finally(() => { 存.清理在跑 = false; });
    }
    if (!存.在跑) {
      存.在跑 = true;
      转写一轮()
        .catch((e) => console.warn(`[录音转写] 这一轮出错：${e instanceof Error ? e.message.slice(0, 200) : e}`))
        .finally(() => { 存.在跑 = false; });
    }
    if (!存.整理在跑) {
      存.整理在跑 = true;
      整理一轮()
        .catch((e) => console.warn(`[录音整理] 这一轮出错：${e instanceof Error ? e.message.slice(0, 200) : e}`))
        .finally(() => { 存.整理在跑 = false; });
    }
  }, 间隔);
  存.钟.unref?.();
}
