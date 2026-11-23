/**
 * 企业版录音点评 · 录音的读写库 + 落盘（11-22，录音点评 PR2：录音存储与上传）。判定全在 coach-rec.ts，文件在 coach-rec-store.ts。
 *
 * - 开关：录音点评开着()——Setting「enterprise.coachRec.on」存 JSON true 才算开，默认关。关着时接口全拒（404）、页面和现在一样。
 *   设置页「语音转文字」那块在 PR4 才有；PR2 合进 main 后随别的修复上 c2，入口也不出。
 * - 写只走 主题写()（lib/team-scope.ts 主题表 含 EntCoachRecording）：销售教练是只读角色，也要能传录音；切换视图照样拦。
 * - 读：项目用 defaultClient 取（不过限定、不滤回收站，冻结要看 deletedAt），每个入口先判（coach-rec.ts）。
 * - 留痕：开始、传完、放弃各一条；文件名里的号码在留痕里一律打码（文件名打码，连号码带日期的长串也认）。
 * - 传完同时只许一个（PR2 审查必修 1）：库里占位（上传中的行 endedAt 记上占位时刻，跨进程）+ 进程内按录音编号的锁；
 *   第二个请求不再拼一遍，直接回现状（拼好了回待提交，别的进程还在拼回 409「正在合成」）。占位期间不收新片。
 * - 不是沟通记录：不碰三态、冷项目、额度、下一步计划、节点（同主题，P-教练-10）。
 * - PR4（11-22）：提交整理 / 重试整理（待提交 / 整理失败 → 转写中，转写钟在 coach-rec-jobs.ts）；录音可用 = 开关 + 密钥 + ffmpeg 自检；
 *   删掉文件以后记 audioPurgedAt；传完占位被别的请求接手时，原来那个请求不再删目录（重读一遍，真放弃了才删）。
 */
import fs from "node:fs";
import path from "node:path";
import { prisma, defaultClient } from "@/lib/prisma";
import { 主题写 } from "@/lib/team-scope";
import { recordAudit } from "@/lib/audit";
import { getSetting } from "@/lib/settings";
import { 企业版 } from "./switch";
import { 读组织 } from "./org";
import { 权限项目选, 是教练, type 谁 } from "./permissions";
import { 文件名打码, 打码还原, 还原超长话 } from "./notice-mask";
import { 正在切换视图 } from "./view-as";
import type { 主题项目 } from "./coach-topic";
import {
  不能开始话, 不能传片话, 能看录音进度, 不能放弃话, 能听原声, 给人看的文件名, 给人看的文字, 规整文件名, 开始输入问题, 片们问题,
  认录音格式, 片上限字节, 文件上限字节, 每人未完成上限, 草稿状态, 格式类型, 是录音格式, 是录音编号, 拼合占位毫秒,
  type 录音状态, type 录音来源,
} from "./coach-rec";
import { 录音目录, 写片, 已收片, 删片, 拼段, 删录音文件, 认录音文件, 文件大小, 片超限, 片读超时, 录音根 } from "./coach-rec-store";
import { consumeUserAiQuota } from "@/lib/ai-quota";
import { 选通道 } from "./asr/channel";
import { 主题标题上限, 主题内容上限 } from "./coach-topic";

/** 存草稿：主题、要点都能空（下次接着写），不超上限 */
function 草稿输入问题(x: { title?: unknown; body?: unknown }): string | null {
  if ((x.title !== undefined && x.title !== null && typeof x.title !== "string") || (x.body !== undefined && x.body !== null && typeof x.body !== "string")) return "主题、要点要是文字";
  if (String(x.title ?? "").trim().length > 主题标题上限) return `主题最多 ${主题标题上限} 字`;
  if (String(x.body ?? "").trim().length > 主题内容上限) return `要点最多 ${主题内容上限} 字`;
  return null;
}
import { ffmpeg自检 } from "./asr/ffmpeg";

/** 开关的 Setting 键（PR4 设置页「语音转文字」拨的就是它；没有这一行 = 关） */
export const 录音点评开关键 = "enterprise.coachRec.on";
export async function 录音点评开着(): Promise<boolean> {
  if (!企业版()) return false;
  return (await getSetting<boolean>(录音点评开关键)) === true;
}
export const 没开放话 = "录音点评还没开放";

/**
 * 录音点评能不能用（PR4，方案 PR4「放开条件 = 开关开 + 密钥在 + 自检过」）：开关开着、转写通道配好（密钥在，或者 3703 的假通道）、
 * ffmpeg 自检过（结果进程里记 10 分钟）。不能用时：客户页不出「传录音文件」、待提交卡的「提交整理」灰着，已有的草稿照样看得到、删得掉
 */
export async function 录音可用(): Promise<boolean> {
  if (!(await 录音点评开着())) return false;
  if (!(await 选通道())) return false;
  return (await ffmpeg自检()).ok;
}
export const 没配好话 = "语音转文字还没配好，请系统管理员到设置 → AI 接入 →「语音转文字」里看";

type 人 = 谁 & { name: string };
type 错 = { ok: false; error: string; 状态: number };
type 结果<T = object> = ({ ok: true } & T) | 错;
const 不行 = (error: string, 状态: number): 错 => ({ ok: false, error, 状态 });

const 项目选 = { id: true, name: true, ...权限项目选 } as const;
type 项目行 = { id: string; name: string; ownerId: string; creatorId: string | null; pooledAt: Date | null; bizLine: string | null; deletedAt: Date | null; result: string | null;
  phase: string; awaitAssignAt: Date | null; scheduledAssignAt: Date | null; members: { userId: string }[] };
async function 读项目(projectId: unknown): Promise<(主题项目 & { id: string; name: string }) | null> {
  if (typeof projectId !== "string" || !/^[\w-]{1,64}$/.test(projectId)) return null;
  const p = (await defaultClient.project.findUnique({ where: { id: projectId }, select: 项目选 })) as 项目行 | null;
  return p ? { ...p, 已加入: p.members.map((m) => m.userId) } : null;
}

const 录音选 = { id: true, projectId: true, authorId: true, status: true, sourceKind: true, fileName: true, format: true, bytes: true, chunks: true, segCount: true, audioPath: true, durationMs: true, error: true, deletedAt: true, audioPurgedAt: true, startedAt: true, endedAt: true, createdAt: true, updatedAt: true,
  transcript: true, draftTitle: true, draftBody: true } as const;
type 录音库行 = { id: string; projectId: string; authorId: string; status: string; sourceKind: string; fileName: string | null; format: string | null; bytes: number | null; chunks: number; segCount: number;
  audioPath: string | null; durationMs: number | null; error: string | null; deletedAt: Date | null; audioPurgedAt: Date | null; startedAt: Date; endedAt: Date | null; createdAt: Date; updatedAt: Date;
  transcript: string | null; draftTitle: string | null; draftBody: string | null };
async function 读录音(id: unknown): Promise<录音库行 | null> {
  if (!是录音编号(id)) return null;
  return defaultClient.entCoachRecording.findUnique({ where: { id }, select: 录音选 });
}

/** 给界面的一条（只给录的人自己） */
export type 录音给界面 = {
  id: string; status: 录音状态; sourceKind: 录音来源; 文件名: string | null; 总字节: number | null; 已收字节: number;
  已收片: { 段: number; 片: number; 字节: number }[]; 格式: string | null; 开始于: string; 更新于: string; 能听: boolean;
  /** 服务端 ffprobe 算的时长（PR4 提交整理以后才有） */
  时长毫秒: number | null;
  /** 整理失败的原因（给人看的话）；待确认时是提示（没听清，请自己写） */
  错: string | null;
  /**
   * 确认框要的（PR5）：待确认、整理失败才有——AI 起草的主题、要点（「稍后再发」改过的也在这里），转写全文（转写失败的没有）。
   * 只给录的人自己；销售教练看到的号码打码（给人看的文字）
   */
  确认?: { 主题: string; 要点: string; 转写: string | null };
};
async function 给界面(me: 谁, r: 录音库行, 判: 主题项目 | null): Promise<录音给界面> {
  const org = await 读组织();
  const 片们 = r.status === "上传中" ? await 已收片(录音目录(r)) : [];
  const 已收字节 = r.status === "上传中" ? 片们.reduce((a, x) => a + x.字节, 0) : r.bytes ?? 0;
  return {
    id: r.id, status: r.status as 录音状态, sourceKind: r.sourceKind as 录音来源, 文件名: 给人看的文件名(r.fileName, me, org), 总字节: r.bytes, 已收字节,
    已收片: 片们, 格式: r.format, 开始于: r.startedAt.toISOString(), 更新于: r.updatedAt.toISOString(),
    能听: !!判 && !!r.audioPath && 能听原声(me, r, 判, org),
    时长毫秒: r.durationMs, 错: r.status === "整理失败" || r.status === "待确认" ? r.error : null,
    ...(r.status === "待确认" || r.status === "整理失败"
      ? { 确认: { 主题: 给人看的文字(r.draftTitle, me, org) ?? "", 要点: 给人看的文字(r.draftBody, me, org) ?? "", 转写: 给人看的文字(r.transcript, me, org) } }
      : {}),
  };
}

/** 开始一条（传文件：报文件名、大小；录音 PR3 起用）。填写人 = 当前登录的人，不收 authorId */
export async function 开始录音(me: 人, 输入: { projectId?: unknown; sourceKind?: unknown; fileName?: unknown; bytes?: unknown; mime?: unknown }): Promise<结果<{ 录音: 录音给界面 }>> {
  if (!(await 录音点评开着())) return 不行(没开放话, 404);
  const p = await 读项目(输入.projectId);
  if (!p) return 不行("项目不在了，刷新看看", 404);
  const org = await 读组织();
  const 不能 = 不能开始话(me, p, org);
  if (不能) return 不行(不能, 403);
  const 问题 = 开始输入问题(输入);
  if (问题) return 不行(问题, 400);
  const 没完 = await defaultClient.entCoachRecording.count({ where: { authorId: me.id, status: "上传中", deletedAt: null } });
  if (没完 >= 每人未完成上限) return 不行(`你还有 ${没完} 条没传完的录音，先接着传完或删掉几条再开新的`, 429);
  const 上传 = 输入.sourceKind === "上传";
  const fileName = 上传 ? 规整文件名(输入.fileName) : null;
  const mime = typeof 输入.mime === "string" ? 输入.mime.slice(0, 100) : null;
  const r = await 主题写(() => prisma.entCoachRecording.create({
    data: { projectId: p.id, authorId: me.id, status: "上传中", sourceKind: String(输入.sourceKind), fileName, mime, bytes: 上传 ? (输入.bytes as number) : null },
    select: 录音选,
  }));
  await recordAudit({ user: me, action: "create", entity: "EntCoachRecording", entityId: r.id, summary: `开始${上传 ? `传录音文件「${文件名打码(fileName ?? "")}」` : "录音"}（项目「${p.name}」）`, detail: { 来源: 输入.sourceKind, 字节: r.bytes } });
  return { ok: true, 录音: await 给界面(me, r, p) };
}

/** 判一条能不能接着传（传片、传完共用）：回录音行和项目 */
async function 认能传(me: 人, id: unknown): Promise<结果<{ r: 录音库行; p: 主题项目 & { id: string; name: string } }>> {
  if (!(await 录音点评开着())) return 不行(没开放话, 404);
  const r = await 读录音(id);
  if (!r || r.authorId !== me.id) return 不行("找不到这条录音", 404); // 别人的录音：和不存在一个说法，不露编号是否存在
  const p = await 读项目(r.projectId);
  if (!p) return 不行("项目不在了，刷新看看", 404);
  const 不能 = 不能传片话(me, r, p, await 读组织());
  if (不能) return 不行(不能, r.status === "上传中" && !r.deletedAt ? 403 : 409);
  return { ok: true, r, p };
}

/** 这条正在被某个请求拼合（库里占位还没过期） */
const 拼合占着 = (r: { status: string; endedAt: Date | null }, 现在 = Date.now()) =>
  r.status === "上传中" && !!r.endedAt && r.endedAt.getTime() > 现在 - 拼合占位毫秒;
const 正在合成话 = "正在合成录音文件，稍等几秒再看";

/**
 * 收一片（PUT chunk/:seg/:seq）。每片都重判权限（开始以后丢了权限的就停）；同一片重复传按片号覆盖；正在拼合的不收。
 * 总量不超过 200MB（传文件另不超过开始时报的大小）；每段第 0 片都认文件头，认不出（或和前面的段格式不一样）的当场删、拒收；
 * 一片都还没收就被拒的（第一片就不是录音），这一条直接放弃，不留空的「上传中」占着每人 5 条的名额
 */
export async function 收一片(me: 人, id: unknown, 段: number, 片: number, 体: ReadableStream<Uint8Array> | null, 声明字节: number | null): Promise<结果<{ 字节: number; 已收字节: number }>> {
  const 认 = await 认能传(me, id);
  if (!认.ok) return 认;
  const { r } = 认;
  if (拼合占着(r)) return 不行(正在合成话, 409);
  if (r.sourceKind === "上传" && 段 !== 1) return 不行("传文件只有一段", 400);
  const dir = 录音目录(r);
  const 别的片 = (await 已收片(dir)).filter((x) => !(x.段 === 段 && x.片 === 片));
  const 别的字节 = 别的片.reduce((a, x) => a + x.字节, 0);
  const 总上限 = r.sourceKind === "上传" && r.bytes ? Math.min(r.bytes, 文件上限字节) : 文件上限字节;
  const 本片上限 = Math.min(片上限字节, 总上限 - 别的字节);
  if (声明字节 !== null && 声明字节 > 片上限字节) return 不行(`一片最多 ${片上限字节 / 1024 / 1024}MB`, 413);
  if (本片上限 <= 0 || (声明字节 !== null && 声明字节 > 本片上限)) return 不行(r.sourceKind === "上传" ? "传的比文件本身还多，请重新选文件" : `录音超过 ${文件上限字节 / 1024 / 1024}MB`, 413);
  let 写: { 字节: number; 头: Uint8Array };
  try {
    写 = await 写片(dir, 段, 片, 体, 本片上限);
  } catch (e) {
    if (e instanceof 片超限) return 不行(本片上限 < 片上限字节 ? "传的比文件本身还多，请重新选文件" : `一片最多 ${片上限字节 / 1024 / 1024}MB`, 413);
    if (e instanceof 片读超时) return 不行("网络断了，这一片没传完", 408);
    throw e;
  }
  if (写.字节 === 0) {
    await 删片(dir, 段, 片);
    return 不行("这一片是空的", 400);
  }
  let 格式 = r.format;
  if (片 === 0) {
    const 认出 = 认录音格式(写.头);
    if (!认出 || (r.format && 认出 !== r.format)) {
      await 删片(dir, 段, 片);
      if (!别的片.length) await 弃掉空的(me, r);
      return 不行(认出 ? "这一段和前面录的格式不一样" : "认不出这个文件的格式：只收 m4a、mp3、wav、aac、amr、ogg、flac、mp4、3gp、webm 录音", 415);
    }
    格式 ??= 认出;
  }
  const 片数 = 别的片.length + 1;
  await 主题写(() => prisma.entCoachRecording.update({ where: { id: r.id }, data: { chunks: 片数, ...(格式 !== r.format ? { format: 格式 } : {}) } }));
  return { ok: true, 字节: 写.字节, 已收字节: 别的字节 + 写.字节 };
}

/** 第一片就不是录音、一片都没收：这一条直接放弃（同 放弃录音，留痕写明为什么） */
async function 弃掉空的(me: 人, r: 录音库行): Promise<void> {
  const 改 = await 主题写(() => prisma.entCoachRecording.updateMany({
    where: { id: r.id, status: "上传中", deletedAt: null },
    data: { status: "已放弃", deletedAt: new Date() },
  }));
  if (改.count !== 1) return;
  await 删录音文件(r);
  await 记音频已删(r.id);
  await recordAudit({ user: me, action: "delete", entity: "EntCoachRecording", entityId: r.id, summary: `${r.fileName ? `录音文件「${文件名打码(r.fileName)}」` : "录音"}认不出格式，没收、已放弃` });
}

/** 文件删掉以后记上 audioPurgedAt（PR4 修 PR2 审查遗留）：删成功才记；已经记过的不改 */
async function 记音频已删(id: string): Promise<void> {
  await 主题写(() => prisma.entCoachRecording.updateMany({ where: { id, audioPurgedAt: null }, data: { audioPurgedAt: new Date() } }));
}

/** 传完的第二个请求回现状：拼好了 = 待提交（当成功）；别的进程还在拼 = 409；已放弃 = 409 */
async function 传完现状(me: 人, id: string): Promise<结果<{ 录音: 录音给界面 }>> {
  const r = await 读录音(id);
  if (!r || r.authorId !== me.id) return 不行("找不到这条录音", 404);
  if (r.deletedAt || r.status === "已放弃") return 不行("这条录音已经放弃了", 409);
  if (r.status === "上传中") return 不行(拼合占着(r) ? 正在合成话 : "还没传完", 409);
  return { ok: true, 录音: await 给界面(me, r, await 读项目(r.projectId)) };
}

/** 进程内：正在拼合的录音编号 → 那次传完（同一进程里第二个请求等它做完再回现状，不再拼一遍） */
const 拼合中 = new Map<string, Promise<unknown>>();

/**
 * 传完（POST finish）：片齐了（传文件另核总字节），每段拼成一个文件、删片，进「待提交」。
 * 同时只许一个：先过进程内锁，再在库里占位（上传中、endedAt 空或占位已过期 → 记上占位时刻）；占不到 / 已经传完的回现状，不再拼
 */
export async function 传完(me: 人, id: unknown): Promise<结果<{ 录音: 录音给界面 }>> {
  if (!(await 录音点评开着())) return 不行(没开放话, 404);
  const 在拼 = 是录音编号(id) ? 拼合中.get(id) : undefined;
  if (在拼) {
    await 在拼.catch(() => {});
    return 传完现状(me, id as string);
  }
  const 先看 = await 读录音(id);
  if (先看 && 先看.authorId === me.id && !先看.deletedAt && 先看.status === "待提交") return 传完现状(me, 先看.id);
  const 认 = await 认能传(me, id);
  if (!认.ok) return 认;
  const { r, p } = 认;
  if (拼合中.has(r.id)) return 传完(me, id);
  const 做 = 拼合一条(me, r, p);
  拼合中.set(r.id, 做);
  try {
    return await 做;
  } finally {
    拼合中.delete(r.id);
  }
}

async function 拼合一条(me: 人, r: 录音库行, p: { name: string }): Promise<结果<{ 录音: 录音给界面 }>> {
  const 占位 = new Date();
  const 占 = await 主题写(() => prisma.entCoachRecording.updateMany({
    where: { id: r.id, status: "上传中", deletedAt: null, OR: [{ endedAt: null }, { endedAt: { lt: new Date(占位.getTime() - 拼合占位毫秒) } }] },
    data: { endedAt: 占位 },
  }));
  if (占.count !== 1) return 传完现状(me, r.id);
  // 没拼成（片不齐、出错）：把占位还回去，好让人接着传、再点传完
  const 还位 = () => 主题写(() => prisma.entCoachRecording.updateMany({ where: { id: r.id, status: "上传中", endedAt: 占位 }, data: { endedAt: null } }));
  try {
    const 新行 = (await 读录音(r.id))!;
    const 片们 = await 已收片(录音目录(r));
    const 问题 = 片们问题(片们, r.sourceKind, r.bytes);
    if (问题) {
      await 还位();
      return 不行(问题, 409);
    }
    if (!是录音格式(新行.format)) {
      await 还位();
      return 不行("认不出这个文件的格式", 415);
    }
    const 段们 = [...new Set(片们.map((x) => x.段))];
    const 路径们: string[] = [];
    for (const s of 段们) 路径们.push(await 拼段(r, s, 新行.format));
    const 总 = 片们.reduce((a, x) => a + x.字节, 0);
    const 改 = await 主题写(() => prisma.entCoachRecording.updateMany({
      where: { id: r.id, status: "上传中", deletedAt: null, endedAt: 占位 },
      data: { status: "待提交", format: 新行.format, chunks: 片们.length, segCount: 段们.length, bytes: 总, audioPath: 路径们[0], endedAt: new Date() },
    }));
    if (改.count !== 1) {
      // 没改到：重读一遍再定（PR4 修 PR2 审查遗留）。真被放弃了（放弃删目录在先、拼好的文件可能在后落下）才再删一遍；
      // 占位过期被别的请求接手、已经拼好进了待提交的，那份文件是接手的请求写的，这里不能删，回现状
      const 现在 = await 读录音(r.id);
      if (!现在 || 现在.deletedAt || 现在.status === "已放弃") {
        await 删录音文件(r);
        if (现在) await 记音频已删(r.id);
        return 不行("这条录音刚被放弃了", 409);
      }
      return 传完现状(me, r.id);
    }
    await recordAudit({ user: me, action: "update", entity: "EntCoachRecording", entityId: r.id, summary: `传完${r.fileName ? `录音文件「${文件名打码(r.fileName)}」` : "录音"}（项目「${p.name}」，${Math.round(总 / 1024)}KB）`, detail: { 片: 片们.length, 段: 段们.length, 格式: 新行.format } });
    return 传完现状(me, r.id);
  } catch (e) {
    await 还位().catch(() => {});
    const 现在 = await 读录音(r.id);
    if (现在 && (现在.deletedAt || 现在.status === "已放弃")) {
      if (await 删录音文件(r).then(() => true, () => false)) await 记音频已删(r.id).catch(() => {});
      return 不行("这条录音刚被放弃了", 409);
    }
    throw e;
  }
}

/** 放弃 / 删掉（POST abandon）：只有录的人；文件当场删、行打记号。已经放弃的当成功 */
export async function 放弃录音(me: 人, id: unknown): Promise<结果> {
  if (!(await 录音点评开着())) return 不行(没开放话, 404);
  const r = await 读录音(id);
  if (!r || r.authorId !== me.id) return 不行("找不到这条录音", 404);
  if (r.deletedAt || r.status === "已放弃") return { ok: true };
  const 不能 = 不能放弃话(me, r);
  if (不能) return 不行(不能, 409);
  const 改 = await 主题写(() => prisma.entCoachRecording.updateMany({
    where: { id: r.id, status: { in: [...草稿状态] }, deletedAt: null },
    data: { status: "已放弃", deletedAt: new Date() },
  }));
  if (改.count !== 1) return { ok: true };
  await 删录音文件(r);
  await 记音频已删(r.id);
  const p = await 读项目(r.projectId);
  await recordAudit({ user: me, action: "delete", entity: "EntCoachRecording", entityId: r.id, summary: `删掉${r.fileName ? `录音文件「${文件名打码(r.fileName)}」` : "录音"}${p ? `（项目「${p.name}」）` : ""}` });
  return { ok: true };
}

/** 看进度（GET :id/status，续传用）：只有录的人 */
export async function 录音进度(me: 人, id: unknown): Promise<结果<{ 录音: 录音给界面 }>> {
  if (!(await 录音点评开着())) return 不行(没开放话, 404);
  const r = await 读录音(id);
  if (!r || !能看录音进度(me, r)) return 不行("找不到这条录音", 404);
  return { ok: true, 录音: await 给界面(me, r, await 读项目(r.projectId)) };
}

/**
 * 提交整理（POST :id/submit，PR4）：只有录的人；待提交 → 转写中（排队，转写钟 coach-rec-jobs.ts 接着做）。
 * 还要录音点评能用（开关 + 密钥 + ffmpeg），而且现在仍能对这个项目发主题（开始以后丢了权限、项目进了公海的不能交）。
 * 已经交过（转写中、整理中）的当成功回现状（两个窗口、连点）
 */
export async function 提交整理(me: 人, id: unknown): Promise<结果<{ 录音: 录音给界面 }>> {
  if (!(await 录音点评开着())) return 不行(没开放话, 404);
  const r = await 读录音(id);
  if (!r || r.authorId !== me.id || r.deletedAt) return 不行("找不到这条录音", 404);
  if (r.status === "转写中" || r.status === "整理中") return { ok: true, 录音: await 给界面(me, r, await 读项目(r.projectId)) };
  if (r.status !== "待提交") return 不行(r.status === "已放弃" ? "这条录音已经放弃了" : r.status === "上传中" ? "还没传完" : r.status === "整理失败" ? "这条没整理成，点「重试整理」" : "这条录音已经交过了", 409);
  return 交去转写(me, r, "待提交");
}

/**
 * 重试整理（POST :id/retry，PR4；PR5 起也是确认框里的「按转写重新整理」）：只有录的人。
 *   - 整理失败、没有转写（转写那步没成）→ 转写中，从头再交一次（任务号、提交时刻清掉）
 *   - 整理失败但转写在（AI 那步没成）、待确认（按转写重新整理）→ 整理中，只再整理一次，不再转写（草稿会被新的盖掉）
 * 记 AI 用量限频（lib/ai-quota.ts，5 分钟 30 次，和别的 AI 动作同一个桶）
 */
export async function 重试整理(me: 人, id: unknown): Promise<结果<{ 录音: 录音给界面 }>> {
  if (!(await 录音点评开着())) return 不行(没开放话, 404);
  const r = await 读录音(id);
  if (!r || r.authorId !== me.id || r.deletedAt) return 不行("找不到这条录音", 404);
  if (r.status === "转写中" || r.status === "整理中") return { ok: true, 录音: await 给界面(me, r, await 读项目(r.projectId)) };
  const 再整理 = !!r.transcript && (r.status === "整理失败" || r.status === "待确认");
  if (r.status !== "整理失败" && !再整理) return 不行(r.status === "待提交" ? "这条还没交，点「提交整理」" : r.status === "待确认" ? "这条没有转写，不能重新整理" : "这条录音不用重试", 409);
  const 等 = consumeUserAiQuota(me);
  if (等 !== null) return 不行(`操作太频繁，${等} 秒后再试`, 429);
  return 再整理 ? 交去整理(me, r, r.status as "整理失败" | "待确认") : 交去转写(me, r, "整理失败");
}

/** 转写在、只再整理一次：整理失败 / 待确认 → 整理中（转写留着；整理一轮 接着做） */
async function 交去整理(me: 人, r: 录音库行, 从: "整理失败" | "待确认"): Promise<结果<{ 录音: 录音给界面 }>> {
  if (!(await 录音可用())) return 不行(没配好话, 409);
  const p = await 读项目(r.projectId);
  if (!p) return 不行("项目不在了，刷新看看", 404);
  const 不能 = 不能开始话(me, p, await 读组织());
  if (不能) return 不行(不能, 403);
  const 改 = await 主题写(() => prisma.entCoachRecording.updateMany({
    where: { id: r.id, status: 从, deletedAt: null },
    data: { status: "整理中", error: null },
  }));
  const 新 = (await 读录音(r.id))!;
  if (改.count === 1) {
    await recordAudit({ user: me, action: "update", entity: "EntCoachRecording", entityId: r.id, summary: `${从 === "待确认" ? "按转写重新整理" : "重试整理"}${r.fileName ? `录音文件「${文件名打码(r.fileName)}」` : "录音"}（项目「${p.name}」）` });
  } else if (新.status !== "整理中") {
    return 不行("这条录音刚变了，刷新看看", 409);
  }
  return { ok: true, 录音: await 给界面(me, 新, p) };
}

/**
 * 稍后再发（POST :id/draft，PR5）：只有录的人；待确认、整理失败的存下确认框里改过的主题、要点（空也行，下次接着写）。
 * 销售教练看到的是打过码的草稿：库里要存原文（PR5 审查），提交上来没改动的打码段按原文换回原号码（打码还原），教练自己改的照他写的存
 */
export async function 存录音草稿(me: 人, id: unknown, 输入: { title?: unknown; body?: unknown }): Promise<结果<{ 录音: 录音给界面 }>> {
  if (!(await 录音点评开着())) return 不行(没开放话, 404);
  const r = await 读录音(id);
  if (!r || r.authorId !== me.id || r.deletedAt) return 不行("找不到这条录音", 404);
  if (r.status !== "待确认" && r.status !== "整理失败") return 不行(r.status === "已发出" ? "这条已经发出了" : "这条还没整理好", 409);
  const 问题 = 草稿输入问题(输入);
  if (问题) return 不行(问题, 400);
  const 原文们 = [r.draftTitle, r.draftBody, r.transcript];
  const 教练 = 是教练(me, await 读组织());
  const title = 教练 ? 打码还原(String(输入.title ?? "").trim(), 原文们) : String(输入.title ?? "").trim();
  const body = 教练 ? 打码还原(String(输入.body ?? "").trim(), 原文们) : String(输入.body ?? "").trim();
  const 超 = 还原超长话(输入.title ?? "", title, 主题标题上限, "主题") ?? 还原超长话(输入.body ?? "", body, 主题内容上限, "要点");
  if (超) return 不行(超, 400);
  await 主题写(() => prisma.entCoachRecording.updateMany({
    where: { id: r.id, status: r.status, deletedAt: null },
    data: { draftTitle: title || null, draftBody: body || null },
  }));
  return { ok: true, 录音: await 给界面(me, (await 读录音(r.id))!, await 读项目(r.projectId)) };
}

async function 交去转写(me: 人, r: 录音库行, 从: "待提交" | "整理失败"): Promise<结果<{ 录音: 录音给界面 }>> {
  if (!(await 录音可用())) return 不行(没配好话, 409);
  const p = await 读项目(r.projectId);
  if (!p) return 不行("项目不在了，刷新看看", 404);
  const 不能 = 不能开始话(me, p, await 读组织());
  if (不能) return 不行(不能, 403);
  const 改 = await 主题写(() => prisma.entCoachRecording.updateMany({
    where: { id: r.id, status: 从, deletedAt: null },
    data: { status: "转写中", asrTaskId: null, asrSubmittedAt: null, error: null, transcript: null, segments: null, speakers: null },
  }));
  const 新 = (await 读录音(r.id))!;
  if (改.count === 1) {
    await recordAudit({ user: me, action: "update", entity: "EntCoachRecording", entityId: r.id, summary: `${从 === "待提交" ? "提交整理" : "重试整理"}${r.fileName ? `录音文件「${文件名打码(r.fileName)}」` : "录音"}（项目「${p.name}」）` });
  } else if (新.status !== "转写中" && 新.status !== "整理中") {
    return 不行("这条录音刚变了，刷新看看", 409);
  }
  return { ok: true, 录音: await 给界面(me, 新, p) };
}

/**
 * 我在这个项目上的录音草稿（上传中 / 待提交……）：客户页、项目页的草稿条和待提交卡用。开关关着、不是企业版 = 空。
 * 切换视图（系统管理员看别人视角）时也是空：草稿只给录的人自己，旁人借视角也看不到对方的草稿和待提交卡（PR2 审查）
 */
export async function 我的录音草稿(me: 谁, projectId: string): Promise<录音给界面[]> {
  if (!(await 录音点评开着())) return [];
  if (await 正在切换视图()) return [];
  const 行们 = await defaultClient.entCoachRecording.findMany({
    where: { projectId, authorId: me.id, status: { in: [...草稿状态, "转写中", "整理中"] }, deletedAt: null },
    select: 录音选, orderBy: { startedAt: "desc" }, take: 20,
  });
  if (!行们.length) return [];
  const p = await 读项目(projectId);
  return Promise.all(行们.map((r) => 给界面(me, r, p)));
}

/** 听原声（GET :id/audio）：回文件绝对路径、类型；判定在 coach-rec.ts 能听原声 */
export async function 取原声(me: 人, id: unknown): Promise<结果<{ 文件: string; 类型: string; 大小: number; 名: string }>> {
  if (!(await 录音点评开着())) return 不行(没开放话, 404);
  const r = await 读录音(id);
  if (!r) return 不行("找不到这条录音", 404);
  const p = await 读项目(r.projectId);
  if (!p || !能听原声(me, r, p, await 读组织())) return 不行("原声只有发起人和项目负责人能听", 403);
  const 文件 = 认录音文件(r.audioPath);
  const 大小 = 文件 ? 文件大小(文件) : null;
  if (!文件 || 大小 === null || !是录音格式(r.format)) return 不行(r.status === "上传中" ? "还没传完" : "录音文件不在了", 404);
  return { ok: true, 文件, 类型: 格式类型[r.format], 大小, 名: `录音-${r.id.slice(-6)}.${r.format}` };
}

/** 设置页「测试连接」的样例音频（ffmpeg 现生成的 3 秒正弦音，不是业务数据）：编号前缀、放哪、多久以后不给取 */
export const 样例编号头 = "zasrtest";
export const 样例目录 = () => path.join(录音根(), "_asrtest");
const 样例有效毫秒 = 30 * 60 * 1000;

/**
 * 腾讯云取文件（GET fetch/:id，只认签名，签名在路由里验）：只给正在转写的（PR4 起才有）。开关关着照样拒。
 * 设置页「测试连接」走签名地址那条路时取的是样例音频（编号 zasrtest…，cuid 不会这样开头）：开关关着也给（开开关之前先测通），30 分钟后不给
 */
export async function 取给转写(id: string): Promise<{ 文件: string; 类型: string; 大小: number } | null> {
  if (id.startsWith(样例编号头) && 是录音编号(id)) {
    const 文件 = path.join(样例目录(), `${id}.m4a`);
    try {
      const st = fs.statSync(文件);
      return Date.now() - st.mtimeMs < 样例有效毫秒 ? { 文件, 类型: "audio/mp4", 大小: st.size } : null;
    } catch {
      return null;
    }
  }
  if (!(await 录音点评开着())) return null;
  const r = await 读录音(id);
  if (!r || r.deletedAt || r.audioPurgedAt || r.status !== "转写中" || !是录音格式(r.format)) return null;
  const 文件 = 认录音文件(r.audioPath);
  const 大小 = 文件 ? 文件大小(文件) : null;
  return 文件 && 大小 !== null ? { 文件, 类型: 格式类型[r.format], 大小 } : null;
}
