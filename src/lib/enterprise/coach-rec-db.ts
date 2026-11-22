/**
 * 企业版录音点评 · 录音的读写库 + 落盘（11-22，录音点评 PR2：录音存储与上传）。判定全在 coach-rec.ts，文件在 coach-rec-store.ts。
 *
 * - 开关：录音点评开着()——Setting「enterprise.coachRec.on」存 JSON true 才算开，默认关。关着时接口全拒（404）、页面和现在一样。
 *   设置页「语音转文字」那块在 PR4 才有；PR2 合进 main 后随别的修复上 c2，入口也不出。
 * - 写只走 主题写()（lib/team-scope.ts 主题表 含 EntCoachRecording）：销售教练是只读角色，也要能传录音；切换视图照样拦。
 * - 读：项目用 defaultClient 取（不过限定、不滤回收站，冻结要看 deletedAt），每个入口先判（coach-rec.ts）。
 * - 留痕：开始、传完、放弃各一条；文件名里的号码在留痕里一律打码。
 * - 不是沟通记录：不碰三态、冷项目、额度、下一步计划、节点（同主题，P-教练-10）。
 */
import { prisma, defaultClient } from "@/lib/prisma";
import { 主题写 } from "@/lib/team-scope";
import { recordAudit } from "@/lib/audit";
import { getSetting } from "@/lib/settings";
import { 企业版 } from "./switch";
import { 读组织 } from "./org";
import { 权限项目选, type 谁 } from "./permissions";
import { 通知文字打码 } from "./notice-mask";
import type { 主题项目 } from "./coach-topic";
import {
  不能开始话, 不能传片话, 能看录音进度, 不能放弃话, 能听原声, 给人看的文件名, 规整文件名, 开始输入问题, 片们问题,
  认录音格式, 片上限字节, 文件上限字节, 每人未完成上限, 草稿状态, 格式类型, 是录音格式, 是录音编号,
  type 录音状态, type 录音来源,
} from "./coach-rec";
import { 录音目录, 写片, 已收片, 删片, 拼段, 删录音文件, 认录音文件, 文件大小, 片超限 } from "./coach-rec-store";

/** 开关的 Setting 键（PR4 设置页「语音转文字」拨的就是它；没有这一行 = 关） */
export const 录音点评开关键 = "enterprise.coachRec.on";
export async function 录音点评开着(): Promise<boolean> {
  if (!企业版()) return false;
  return (await getSetting<boolean>(录音点评开关键)) === true;
}
export const 没开放话 = "录音点评还没开放";

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

const 录音选 = { id: true, projectId: true, authorId: true, status: true, sourceKind: true, fileName: true, format: true, bytes: true, chunks: true, segCount: true, audioPath: true, deletedAt: true, audioPurgedAt: true, startedAt: true, endedAt: true, createdAt: true, updatedAt: true } as const;
type 录音库行 = { id: string; projectId: string; authorId: string; status: string; sourceKind: string; fileName: string | null; format: string | null; bytes: number | null; chunks: number; segCount: number;
  audioPath: string | null; deletedAt: Date | null; audioPurgedAt: Date | null; startedAt: Date; endedAt: Date | null; createdAt: Date; updatedAt: Date };
async function 读录音(id: unknown): Promise<录音库行 | null> {
  if (!是录音编号(id)) return null;
  return defaultClient.entCoachRecording.findUnique({ where: { id }, select: 录音选 });
}

/** 给界面的一条（只给录的人自己） */
export type 录音给界面 = {
  id: string; status: 录音状态; sourceKind: 录音来源; 文件名: string | null; 总字节: number | null; 已收字节: number;
  已收片: { 段: number; 片: number; 字节: number }[]; 格式: string | null; 开始于: string; 更新于: string; 能听: boolean;
};
async function 给界面(me: 谁, r: 录音库行, 判: 主题项目 | null): Promise<录音给界面> {
  const org = await 读组织();
  const 片们 = r.status === "上传中" ? await 已收片(录音目录(r)) : [];
  const 已收字节 = r.status === "上传中" ? 片们.reduce((a, x) => a + x.字节, 0) : r.bytes ?? 0;
  return {
    id: r.id, status: r.status as 录音状态, sourceKind: r.sourceKind as 录音来源, 文件名: 给人看的文件名(r.fileName, me, org), 总字节: r.bytes, 已收字节,
    已收片: 片们, 格式: r.format, 开始于: r.startedAt.toISOString(), 更新于: r.updatedAt.toISOString(),
    能听: !!判 && !!r.audioPath && 能听原声(me, r, 判, org),
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
  await recordAudit({ user: me, action: "create", entity: "EntCoachRecording", entityId: r.id, summary: `开始${上传 ? `传录音文件「${通知文字打码(fileName ?? "")}」` : "录音"}（项目「${p.name}」）`, detail: { 来源: 输入.sourceKind, 字节: r.bytes } });
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

/**
 * 收一片（PUT chunk/:seg/:seq）。每片都重判权限（开始以后丢了权限的就停）；同一片重复传按片号覆盖。
 * 总量不超过 200MB（传文件另不超过开始时报的大小）；第一段第 0 片认文件头，认不出的当场删、拒收
 */
export async function 收一片(me: 人, id: unknown, 段: number, 片: number, 体: ReadableStream<Uint8Array> | null, 声明字节: number | null): Promise<结果<{ 字节: number; 已收字节: number }>> {
  const 认 = await 认能传(me, id);
  if (!认.ok) return 认;
  const { r } = 认;
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
    throw e;
  }
  if (写.字节 === 0) {
    await 删片(dir, 段, 片);
    return 不行("这一片是空的", 400);
  }
  let 格式 = r.format;
  if (段 === 1 && 片 === 0) {
    const 认出 = 认录音格式(写.头);
    if (!认出) {
      await 删片(dir, 段, 片);
      return 不行("认不出这个文件的格式：只收 m4a、mp3、wav、aac、amr、ogg、flac、mp4、3gp、webm 录音", 415);
    }
    格式 = 认出;
  }
  const 片数 = 别的片.length + 1;
  await 主题写(() => prisma.entCoachRecording.update({ where: { id: r.id }, data: { chunks: 片数, ...(格式 !== r.format ? { format: 格式 } : {}) } }));
  return { ok: true, 字节: 写.字节, 已收字节: 别的字节 + 写.字节 };
}

/** 传完（POST finish）：片齐了（传文件另核总字节），每段拼成一个文件、删片，进「待提交」 */
export async function 传完(me: 人, id: unknown): Promise<结果<{ 录音: 录音给界面 }>> {
  const 认 = await 认能传(me, id);
  if (!认.ok) return 认;
  const { r, p } = 认;
  const 片们 = await 已收片(录音目录(r));
  const 问题 = 片们问题(片们, r.sourceKind, r.bytes);
  if (问题) return 不行(问题, 409);
  if (!是录音格式(r.format)) return 不行("认不出这个文件的格式", 415);
  const 段们 = [...new Set(片们.map((x) => x.段))];
  const 路径们: string[] = [];
  for (const s of 段们) 路径们.push(await 拼段(r, s, r.format));
  const 总 = 片们.reduce((a, x) => a + x.字节, 0);
  const 改 = await 主题写(() => prisma.entCoachRecording.updateMany({
    where: { id: r.id, status: "上传中", deletedAt: null },
    data: { status: "待提交", chunks: 片们.length, segCount: 段们.length, bytes: 总, audioPath: 路径们[0], endedAt: new Date() },
  }));
  if (改.count !== 1) return 不行("这条录音刚被放弃了", 409);
  await recordAudit({ user: me, action: "update", entity: "EntCoachRecording", entityId: r.id, summary: `传完${r.fileName ? `录音文件「${通知文字打码(r.fileName)}」` : "录音"}（项目「${p.name}」，${Math.round(总 / 1024)}KB）`, detail: { 片: 片们.length, 段: 段们.length, 格式: r.format } });
  const 新 = (await 读录音(r.id))!;
  return { ok: true, 录音: await 给界面(me, 新, p) };
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
  const p = await 读项目(r.projectId);
  await recordAudit({ user: me, action: "delete", entity: "EntCoachRecording", entityId: r.id, summary: `删掉${r.fileName ? `录音文件「${通知文字打码(r.fileName)}」` : "录音"}${p ? `（项目「${p.name}」）` : ""}` });
  return { ok: true };
}

/** 看进度（GET :id/status，续传用）：只有录的人 */
export async function 录音进度(me: 人, id: unknown): Promise<结果<{ 录音: 录音给界面 }>> {
  if (!(await 录音点评开着())) return 不行(没开放话, 404);
  const r = await 读录音(id);
  if (!r || !能看录音进度(me, r)) return 不行("找不到这条录音", 404);
  return { ok: true, 录音: await 给界面(me, r, await 读项目(r.projectId)) };
}

/** 我在这个项目上的录音草稿（上传中 / 待提交……）：客户页、项目页的草稿条和待提交卡用。开关关着、不是企业版 = 空 */
export async function 我的录音草稿(me: 谁, projectId: string): Promise<录音给界面[]> {
  if (!(await 录音点评开着())) return [];
  const 行们 = await defaultClient.entCoachRecording.findMany({
    where: { projectId, authorId: me.id, status: { in: [...草稿状态] }, deletedAt: null },
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

/** 腾讯云取文件（GET fetch/:id，只认签名，签名在路由里验）：只给正在转写的（PR4 起才有）。开关关着照样拒 */
export async function 取给转写(id: string): Promise<{ 文件: string; 类型: string; 大小: number } | null> {
  if (!(await 录音点评开着())) return null;
  const r = await 读录音(id);
  if (!r || r.deletedAt || r.audioPurgedAt || r.status !== "转写中" || !是录音格式(r.format)) return null;
  const 文件 = 认录音文件(r.audioPath);
  const 大小 = 文件 ? 文件大小(文件) : null;
  return 文件 && 大小 !== null ? { 文件, 类型: 格式类型[r.format], 大小 } : null;
}
