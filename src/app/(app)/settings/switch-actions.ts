"use server";
/**
 * 设置 →「开关总览」的两个只读动作（设置开关 N4 / N5，11-23）。不新增开关、不写库：
 *   开关现状()   —— 17 项开关的现值和卡上要的依赖（包一层现有读函数），一次读齐
 *   读开关改动() —— 每个开关最近一次真变了是谁、几点、打开还是关掉（读操作日志）
 * **服务端各自先判「能进设置」**（P-全局-02：只有系统管理员；勾了「不管设置」的不算）：别的身份直接调也拿不到，回 403。
 * 拨开关不在这里：总览调的是原卡片用的那几个 action（设规则、设不设配额、改组织规则、设飞书推送、设通讯录同步、设录音点评开关）
 */
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { 企业版 } from "@/lib/enterprise/switch";
import { 权限组织 } from "@/lib/enterprise/org";
import { 能进设置 } from "@/lib/enterprise/permissions";
import { 规则, 规则名们, type 规则名 } from "@/lib/enterprise/rules-table";
import { 规则开着 } from "@/lib/enterprise/rules";
import { 不设配额开着 } from "@/lib/enterprise/assign-eta";
import { 不设配额key } from "@/lib/enterprise/lead-assign";
import { 读组织规则 } from "@/lib/project/org-rules-store";
import { 规整组织规则, 到上限的人数, type 组织规则 } from "@/lib/project/org-rules";
import { 组织规则改动 } from "@/lib/project/org-rules-diff";
import { 字典of } from "@/lib/project/stage-dict";
import { 能进公海的阶段 } from "@/lib/project/db";
import { getSetting } from "@/lib/settings";
import { 规整字段配置, 字段权限key } from "@/lib/enterprise/field-perm";
import { 飞书推送开关键 } from "@/lib/enterprise/feishu-push";
import { 录音点评开关键 } from "@/lib/enterprise/coach-rec-db";
import { 读转写设置 } from "@/lib/enterprise/coach-rec-asr-settings";
import { 读飞书推送 } from "../notice-actions";
import { 通讯录概况 } from "./org-actions";
import type { 开关键 } from "@/lib/enterprise/switch-table";

type 拒 = { ok: false; status: 403 | 404; error: string };
const 不给 = (): 拒 => ({ ok: false, status: 403, error: "只有总管理能进设置看开关" });

/** 先认人：企业版、能进设置（系统管理员、没勾不管设置）；不然回拒绝 */
async function 认人(): Promise<{ me: Awaited<ReturnType<typeof requireUser>> } | 拒> {
  const me = await requireUser();
  if (!企业版()) return { ok: false, status: 404, error: "开关总览是企业版的功能" };
  if (!能进设置(me, await 权限组织())) return 不给();
  return { me };
}

/** 组织规则开关键 ↔ 总览开关 */
const 规则开关: Record<规则名, 开关键> = {
  按组织看客户: "org_scope", 字段权限: "field_perm", 线索分配: "lead_assign", 市场复核: "market_review", 超时自动转: "reply_overdue", 主动放弃: "lead_giveup",
};

export type 开关现状 = {
  ok: true;
  /** 每个开关的值：开关是 true / false（子开关读的是存着的值，父开关关着也照实给）；往前推权限是那一项 */
  值: Record<开关键, boolean | string>;
  /** 在职人数（影响谁那句） */
  全员: number;
  /** 整份组织规则：持有上限先数、超时回收先数要它 */
  组织规则: 组织规则;
  持有上限: { 默认上限: number; 单设人数: number; 到上限: number };
  节点推进: { 范围: "全部" | "新建"; 必填进程数: number };
  超时回收: { 内贸进程数: number; 外贸进程数: number; 起算日: string | null };
  /** 字段权限表有没有改过一格（没改过 = 开着也不限） */
  字段权限表改过: boolean;
  飞书: { 推送凭据齐了: boolean; 通讯录凭据齐了: boolean; 通讯录间隔分钟: number };
  录音: { 能打开: boolean; 测过: boolean; 密钥: string };
};

export async function 开关现状(): Promise<开关现状 | 拒> {
  const 人 = await 认人();
  if ("ok" in 人) return 人;
  const org = await 权限组织();
  const 在职 = org ? [...org.成员.keys()] : [];
  const [开们, 不设, 组织规则, 字段表, 推送, 通讯录, 录音, 持有] = await Promise.all([
    Promise.all(规则名们.map(async (n) => [n, await 规则开着(n)] as const)),
    不设配额开着(),
    读组织规则(),
    getSetting<unknown>(字段权限key).then(规整字段配置),
    读飞书推送(),
    通讯录概况(),
    读转写设置(人.me),
    prisma.project.groupBy({ by: ["ownerId"], where: { pooledAt: null, result: null, phase: { in: [...能进公海的阶段] } }, _count: { _all: true } }),
  ]);
  const 飞书源 = 通讯录.ok ? 通讯录.来源们.find((s) => s.源 === "feishu") : undefined;
  const 录音概况 = 录音 && "密钥" in 录音 ? 录音 : null;
  const 值 = {
    ...Object.fromEntries(开们.map(([n, v]) => [规则开关[n], v])),
    no_quota: 不设,
    node_advance: 组织规则.节点推进.开,
    first_two: 组织规则.阶段.前两节点要沟通,
    fill_period: 组织规则.阶段.需求补全期,
    push_perm: 组织规则.阶段.推进权限,
    hold_cap: 组织规则.公海.持有上限开,
    node_timeout: 组织规则.超时回收.开,
    tri_state: 组织规则.三态.开,
    feishu_push: !!推送?.开,
    sync_feishu: !!飞书源?.开,
    coach_rec: !!录音概况?.开,
  } as Record<开关键, boolean | string>;
  const 持有表 = Object.fromEntries(持有.map((x) => [x.ownerId, x._count._all]));
  return {
    ok: true,
    值,
    全员: 在职.length,
    组织规则,
    持有上限: {
      默认上限: 组织规则.公海.默认上限,
      单设人数: Object.keys(组织规则.公海.每人上限).length,
      到上限: 到上限的人数(组织规则.公海, 持有表, 在职),
    },
    节点推进: { 范围: 组织规则.节点推进.范围 === "新建" ? "新建" : "全部", 必填进程数: Object.keys(组织规则.节点推进.必填).length },
    超时回收: { 内贸进程数: Object.keys(组织规则.超时回收.节点天数).length, 外贸进程数: Object.keys(组织规则.超时回收.外贸节点天数 ?? {}).length, 起算日: 组织规则.超时回收.起算日 },
    字段权限表改过: Object.values(字段表).some((行) => Object.keys(行 ?? {}).length > 0),
    飞书: { 推送凭据齐了: !!推送?.配了应用, 通讯录凭据齐了: !!飞书源?.凭据.齐了, 通讯录间隔分钟: 飞书源?.间隔分钟 ?? 60 },
    录音: {
      能打开: !!录音概况 && (录音概况.密钥 === "已配置" || 录音概况.密钥 === "假通道") && 录音概况.ffmpeg.ok,
      测过: !!录音概况?.上次测试,
      密钥: 录音概况?.密钥 ?? "未配置",
    },
  };
}

export type 一次改动 = { 谁: string; at: string; 动作: string };
export type 开关改动 = { ok: true; 上次: Partial<Record<开关键, 一次改动>> };

/** 单键开关的设置键 → 总览开关；摘要都是「打开 / 关掉」打头（不设配额是「改成不设配额 / 改回按配额」） */
const 单键开关: Record<string, 开关键> = {
  ...Object.fromEntries(规则名们.map((n) => [规则[n].key, 规则开关[n]])),
  [不设配额key]: "no_quota",
  [飞书推送开关键]: "feishu_push",
  [录音点评开关键]: "coach_rec",
};
const 单键动作 = (summary: string): string | null =>
  /^打开|改成不设配额/.test(summary) ? "打开" : /^关掉|改回按配额/.test(summary) ? "关掉" : null;

/** 组织规则一行的 detail（改后整份）：读不出来 = null。
 *  只认四大块都是对象的整份规则；脚本写的 {来源, 备份文件, 改动} 之类别的形状不交给规整（会被补成整份默认，比出假改动） */
function 读规则(detail: string | null): 组织规则 | null {
  if (!detail) return null;
  try {
    const raw: unknown = JSON.parse(detail);
    const 是对象 = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);
    if (!是对象(raw)) return null;
    const o = raw as Record<string, unknown>;
    if (!["公海", "超时回收", "节点推进", "阶段"].every((k) => 是对象(o[k]))) return null;
    return 规整组织规则(raw, 字典of(true));
  } catch {
    return null;
  }
}

/** 一次最多往回看几行：卡上只要最近一次，够用；老日志比不出的写「改了项目规则」 */
const 往回看 = 400;

export async function 读开关改动(): Promise<开关改动 | 拒> {
  const 人 = await 认人();
  if ("ok" in 人) return 人;
  const 行们 = await prisma.auditLog.findMany({
    where: {
      OR: [
        { entity: "Setting", entityId: { in: [...Object.keys(单键开关), "orgRules"] } },
        { entity: "EntOrgSync", entityId: "feishu" },
      ],
    },
    // 同一毫秒的两行按 id 排（cuid 按时间递增），相邻两行才比得对
    orderBy: [{ at: "desc" }, { id: "desc" }],
    take: 往回看,
    select: { entity: true, entityId: true, userName: true, at: true, summary: true, detail: true },
  });
  const 上次: Partial<Record<开关键, 一次改动>> = {};
  const 记 = (k: 开关键, 行: (typeof 行们)[number], 动作: string) => {
    if (!上次[k]) 上次[k] = { 谁: 行.userName || "系统", at: 行.at.toISOString(), 动作 };
  };
  const 规则行们 = 行们.filter((r) => r.entityId === "orgRules");
  const 规则开关们: 开关键[] = ["hold_cap", "node_timeout", "node_advance", "first_two", "fill_period", "push_perm", "tri_state"];
  for (const r of 行们) {
    if (r.entity === "EntOrgSync") {
      const 动作 = 单键动作(r.summary);
      if (动作) 记("sync_feishu", r, 动作);
      continue;
    }
    const k = 单键开关[r.entityId ?? ""];
    if (k) {
      const 动作 = 单键动作(r.summary);
      if (动作) 记(k, r, 动作);
    }
  }
  // orgRules：detail 只存改后整份，和上一行（更早那行）比，找出每个开关最近一次真变了的那行
  for (let i = 0; i < 规则行们.length; i++) {
    const 后 = 读规则(规则行们[i].detail), 前 = 规则行们[i + 1] ? 读规则(规则行们[i + 1].detail) : null;
    if (后 && 前) {
      for (const x of 组织规则改动(前, 后)) if (x.开关) 记(x.开关, 规则行们[i], x.动作);
    } else {
      // 比不出（老日志没存 detail、最早那一行没有上一行）：还没找到的开关都可能是这一行改的
      for (const k of 规则开关们) 记(k, 规则行们[i], "改了项目规则");
    }
  }
  return { ok: true, 上次 };
}
