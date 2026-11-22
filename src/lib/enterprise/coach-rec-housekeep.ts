/**
 * 录音点评 · 清理（11-22，录音点评 PR6，方案 PR6 一节）。转写钟（coach-rec-jobs.ts 启动转写钟）每小时调一轮；只在跑后台任务的那个进程跑。
 * 开关关着什么都不做（和转写队列一样原样放着，开回来接着清）。一轮依次：
 *   1. 没发出的草稿（上传中 / 待提交 / 待确认 / 整理失败）：放满 6 天提醒录的人一次（明天到期），满 7 天自动删
 *      起算见 coach-rec.ts 草稿起点（上传中看最后一次动，别的看进这个状态的时刻）；提醒记 remindedAt（裸 SQL，不顶 updatedAt）
 *   2. 没发出的（草稿 + 转写中 + 整理中）项目不在了（进了回收站、连客户删了）或在公海里：自动删
 *      （进公海时 pool-owner.ts 进公海关主题 在事务里已经先放弃了，这里兜底）
 *   3. 没发出的，录的人停用了：自动删（停用时 settings/actions.ts 已经当场删，这里兜底）
 *   4. 已放弃、文件还没删掉的（audioPurgedAt 空）：删文件、记 audioPurgedAt；系统自动删的（error 带 自动删头）给录的人发通知、留痕（录的人停用了不发）
 *   5. 音频 180 天到期（从录的那天算）：删音频文件、记 audioPurgedAt，转写、主题要点留着
 *   6. 兜底：已经拼好的录音还剩的片目录删掉；转写成了的只留规整件（删原始段）；录音根下没主的目录（库里没有、或音频已删）放满 1 天的删掉
 *   7. 这个月转写超过 200 小时：给系统管理员铃铛提醒一次（防密钥被刷）
 * 单条出错只记日志、接着下一条，不挡整轮。
 */
import fsp from "node:fs/promises";
import { prisma, defaultClient } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { 主题写 } from "@/lib/team-scope";
import { recordAudit } from "@/lib/audit";
import { businessDayjs } from "@/lib/business-clock";
import { 系统 } from "@/lib/project/timeout";
import { 录音点评开着 } from "./coach-rec-db";
import { 草稿状态, 草稿起点, 草稿到期, 草稿该提醒, 草稿该删, 音频该删, 自动删头, 自动删话, 每月转写提醒秒 } from "./coach-rec";
import { 录音根, 删录音文件, 只留规整件, 删剩下的片目录, 全部录音目录 } from "./coach-rec-store";
import { 文件名打码 } from "./notice-mask";
import { 录音草稿快到期通知, 录音自动删除通知, 录音转写超量通知 } from "./notice-sources";

export const 清理间隔毫秒 = 60 * 60 * 1000;
/** 录音根下没主的目录放多久才删（刚开始的录音库里一定有行，这只是再保险一点） */
const 没主目录留毫秒 = 24 * 60 * 60 * 1000;
const 没发出 = ["上传中", "待提交", "待确认", "整理失败", "转写中", "整理中"];

export type 清理结果 = { 提醒: number; 到期: number; 项目没了: number; 停用: number; 删文件: number; 音频到期: number; 兜底: number; 没主目录: number; 超量提醒: boolean };

type 行 = { id: string; projectId: string; authorId: string; status: string; fileName: string | null; endedAt: Date | null; updatedAt: Date; createdAt: Date; remindedAt: Date | null; audioPath: string | null; error: string | null };
const 选 = { id: true, projectId: true, authorId: true, status: true, fileName: true, endedAt: true, updatedAt: true, createdAt: true, remindedAt: true, audioPath: true, error: true } as const;

const 记错 = (事: string, id: string, e: unknown) => console.warn(`[录音清理] ${id} ${事}出错：${e instanceof Error ? e.message.slice(0, 200) : e}`);

/** 系统放弃一条：还在原状态、没删的才改；回改到没有 */
async function 自动放弃(r: { id: string; status: string }, 话: string, 现在: Date): Promise<boolean> {
  const 改 = await 主题写(() => prisma.entCoachRecording.updateMany({
    where: { id: r.id, status: r.status, deletedAt: null },
    data: { status: "已放弃", deletedAt: 现在, error: `${自动删头}${话}` },
  }));
  return 改.count === 1;
}

export async function 清理一轮(opt: { 现在?: number } = {}): Promise<清理结果> {
  const 果: 清理结果 = { 提醒: 0, 到期: 0, 项目没了: 0, 停用: 0, 删文件: 0, 音频到期: 0, 兜底: 0, 没主目录: 0, 超量提醒: false };
  if (!(await 录音点评开着())) return 果;
  const 现在 = opt.现在 ?? Date.now();
  const 此刻 = new Date(现在);

  // 1. 草稿到期：满 7 天删，满 6 天提醒一次
  const 草稿们 = (await defaultClient.entCoachRecording.findMany({ where: { status: { in: [...草稿状态] }, deletedAt: null }, select: 选 })) as 行[];
  for (const r of 草稿们) {
    try {
      if (草稿该删(r, 现在)) {
        if (await 自动放弃(r, 自动删话.到期, 此刻)) 果.到期 += 1;
      } else if (草稿该提醒(r, 现在) && !r.remindedAt) {
        // 裸 SQL：只记 remindedAt，不顶 updatedAt（上传中的草稿按 updatedAt 算到期）
        await defaultClient.$executeRaw(Prisma.sql`UPDATE "EntCoachRecording" SET "remindedAt" = ${现在} WHERE "id" = ${r.id} AND "remindedAt" IS NULL`);
        await 录音草稿快到期通知(r.authorId, r, 草稿到期(r), 草稿起点(r));
        果.提醒 += 1;
      }
    } catch (e) {
      记错("草稿到期", r.id, e);
    }
  }

  // 2、3. 没发出的：项目不在了 / 在公海里；录的人停用了
  const 没发出们 = (await defaultClient.entCoachRecording.findMany({ where: { status: { in: 没发出 }, deletedAt: null }, select: 选 })) as 行[];
  if (没发出们.length) {
    const 项目们 = new Map((await defaultClient.project.findMany({ where: { id: { in: [...new Set(没发出们.map((r) => r.projectId))] } }, select: { id: true, pooledAt: true, deletedAt: true } })).map((p) => [p.id, p]));
    const 在职 = new Set((await defaultClient.user.findMany({ where: { id: { in: [...new Set(没发出们.map((r) => r.authorId))] }, active: true }, select: { id: true } })).map((u) => u.id));
    for (const r of 没发出们) {
      try {
        const p = 项目们.get(r.projectId);
        if (!在职.has(r.authorId)) {
          if (await 自动放弃(r, 自动删话.停用, 此刻)) 果.停用 += 1;
        } else if (!p || p.pooledAt || p.deletedAt) {
          if (await 自动放弃(r, 自动删话.项目没了, 此刻)) 果.项目没了 += 1;
        }
      } catch (e) {
        记错("项目 / 成员检查", r.id, e);
      }
    }
  }

  // 4. 已放弃、文件还没删的：删文件；系统自动删的发通知、留痕
  const 待删们 = (await defaultClient.entCoachRecording.findMany({ where: { deletedAt: { not: null }, audioPurgedAt: null }, select: 选 })) as 行[];
  const 待删在职 = new Set((await defaultClient.user.findMany({ where: { id: { in: [...new Set(待删们.map((r) => r.authorId))] }, active: true }, select: { id: true } })).map((u) => u.id));
  for (const r of 待删们) {
    try {
      await 删录音文件(r);
      const 记 = await 主题写(() => prisma.entCoachRecording.updateMany({ where: { id: r.id, audioPurgedAt: null }, data: { audioPurgedAt: 此刻 } }));
      if (记.count !== 1) continue;
      果.删文件 += 1;
      if (!r.error?.startsWith(自动删头)) continue;
      const 话 = r.error.slice(自动删头.length);
      await recordAudit({ user: 系统, action: "delete", entity: "EntCoachRecording", entityId: r.id, summary: `${r.fileName ? `录音文件「${文件名打码(r.fileName)}」` : "录音"}${话}` });
      if (待删在职.has(r.authorId)) await 录音自动删除通知(r.authorId, r, 话);
    } catch (e) {
      记错("删文件", r.id, e);
    }
  }

  // 5. 音频 180 天到期：删音频，转写、要点留着
  const 到期界 = new Date(现在 - 180 * 24 * 60 * 60 * 1000);
  const 老的 = (await defaultClient.entCoachRecording.findMany({ where: { deletedAt: null, audioPurgedAt: null, createdAt: { lte: 到期界 } }, select: 选 })) as 行[];
  for (const r of 老的) {
    if (!音频该删(r, 现在)) continue;
    try {
      await 删录音文件(r);
      const 记 = await 主题写(() => prisma.entCoachRecording.updateMany({ where: { id: r.id, audioPurgedAt: null }, data: { audioPurgedAt: 此刻 } }));
      if (记.count === 1) 果.音频到期 += 1;
    } catch (e) {
      记错("音频到期", r.id, e);
    }
  }

  // 6. 兜底：剩下的片目录、转写成了的原始段、没主的目录
  const 在用 = (await defaultClient.entCoachRecording.findMany({
    where: { deletedAt: null, audioPurgedAt: null },
    select: { id: true, status: true, createdAt: true, audioPath: true, transcript: true },
  }));
  const 在用id = new Set(在用.map((r) => r.id));
  for (const r of 在用) {
    try {
      if (r.status !== "上传中") 果.兜底 += await 删剩下的片目录(r);
      // 转写成了（有转写、不在转写中）：只留规整件。转写中的不动（交的时候还要原始段）
      if (r.transcript && r.status !== "转写中") 果.兜底 += await 只留规整件(r);
    } catch (e) {
      记错("兜底", r.id, e);
    }
  }
  for (const d of await 全部录音目录(录音根())) {
    if (在用id.has(d.id)) continue;
    try {
      const st = await fsp.stat(d.dir);
      if (现在 - st.mtimeMs < 没主目录留毫秒) continue;
      await fsp.rm(d.dir, { recursive: true, force: true });
      果.没主目录 += 1;
    } catch (e) {
      记错("没主目录", d.id, e);
    }
  }

  // 7. 这个月转写超过 200 小时：提醒系统管理员（键带年月，一个月一次）
  try {
    const 月初 = businessDayjs(此刻).startOf("month").toDate();
    let 秒 = 0;
    for (const x of await defaultClient.auditLog.findMany({ where: { action: "ai_use", entityId: "asr", at: { gte: 月初 } }, select: { detail: true } })) {
      try {
        const n = Number((JSON.parse(x.detail ?? "{}") as { 秒?: unknown }).秒);
        if (Number.isFinite(n) && n > 0) 秒 += n;
      } catch {
        /* 明细坏了的不算 */
      }
    }
    if (秒 > 每月转写提醒秒) {
      await 录音转写超量通知(秒, businessDayjs(此刻).format("YYYYMM"));
      果.超量提醒 = true;
    }
  } catch (e) {
    记错("转写时长", "-", e);
  }

  const 动了 = 果.提醒 + 果.到期 + 果.项目没了 + 果.停用 + 果.删文件 + 果.音频到期 + 果.兜底 + 果.没主目录;
  if (动了) console.log(`[录音清理] 提醒 ${果.提醒}、到期删 ${果.到期}、项目没了 ${果.项目没了}、停用 ${果.停用}、删文件 ${果.删文件}、音频到期 ${果.音频到期}、兜底 ${果.兜底}、没主目录 ${果.没主目录}`);
  return 果;
}
