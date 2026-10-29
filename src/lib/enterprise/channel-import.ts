/**
 * 企业版渠道批量导入的纯逻辑（2026-10-29）：表格的行 → 要建哪些渠道、跳过哪些、为什么。
 * 读文件、读库、写库在 scripts/import-channels.ts，这里不碰库，单测直接喂行。
 *
 * 认的列（按表头名字认，顺序随意）：渠道属性 / 渠道名称 / 来源名称 / 渠道状态 / 结束日期 / 负责人 / 创建人。
 * 「累计运营天数」是算出来的，表里有也不读；别的认不出的列原样忽略、报一句。
 *
 * 规矩：
 * - 渠道名称、来源名称必填；全称 = 拼全称(渠道名称, 来源名称)，超过 全称上限 拦下。
 * - 全称和库里已有的、或和文件里前面的行重复：跳过并列出来（不覆盖库里的）。
 * - 渠道状态：启用 / 正常 / 有效 / 开启 → 启用；停用 / 关闭 / 无效 / 失效 → 停用；空着算启用；别的写法按启用、报一句。
 * - 结束日期认不出：留空、报一句。
 * - 负责人 / 创建人按员工姓名精确对（先比在职的）；对不上或重名留空、报一句。
 *   负责人在库里是必填，留空的用「兜底负责人」（脚本里 --owner=姓名，不给就第一个在职管理员），并报出来。
 * - 渠道属性不在字典里：照收、报一句（字典里补上就能筛）；空着也照收。
 */
import { 认日期 } from "@/lib/import/plan";
import { 拼全称, 全称上限 } from "./channel-stats";

export type 导入用员工 = { id: string; name: string; active: boolean };

export type 要建的渠道 = {
  行号: number;
  name: string;
  attr: string | null;
  platform: string;
  active: boolean;
  endDate: Date | null;
  channelOwnerId: string;
  createdById: string | null;
};

export type 导入计划 = {
  要建: 要建的渠道[];
  /** 全称重复跳过的：行号 + 全称 + 和谁重复 */
  重复: { 行号: number; 全称: string; 和: "库里已有" | `第 ${number} 行` }[];
  /** 拦下不建的：缺必填、太长 */
  拦下: { 行号: number; 原因: string }[];
  /** 建了但有一格没按原样收的 */
  提示: { 行号: number; 话: string }[];
  /** 表头层面的话：认不出的列、缺了的列 */
  表头提示: string[];
};

const 列名 = {
  属性: ["渠道属性"],
  名称: ["渠道名称"],
  来源: ["来源名称", "来源"],
  状态: ["渠道状态", "状态"],
  结束: ["结束日期"],
  负责人: ["负责人", "渠道负责人"],
  创建人: ["创建人"],
} as const;
type 列键 = keyof typeof 列名;
/** 表里有、但故意不读的列 */
const 不读的列 = ["累计运营天数", "渠道全称"];

const 启用写法 = ["启用", "正常", "有效", "开启", "是"];
const 停用写法 = ["停用", "关闭", "无效", "失效", "否", "已停用"];

const 净 = (s: string | undefined) => (s ?? "").replace(/ /g, " ").trim();

/** 按名字认人：先比在职的，在职里正好一个才算；在职没有再看离职的（同样要唯一） */
export function 认人(名: string, 员工们: 导入用员工[]): { id: string } | { 错: string } {
  const n = 净(名);
  const 在职 = 员工们.filter((u) => u.active && u.name.trim() === n);
  if (在职.length === 1) return { id: 在职[0].id };
  if (在职.length > 1) return { 错: `有 ${在职.length} 个在职员工都叫「${n}」，分不清` };
  const 离职 = 员工们.filter((u) => !u.active && u.name.trim() === n);
  if (离职.length === 1) return { id: 离职[0].id };
  if (离职.length > 1) return { 错: `有 ${离职.length} 个离职员工都叫「${n}」，分不清` };
  return { 错: `员工里没有「${n}」` };
}

export function 认状态(v: string): { active: boolean; 认出来了: boolean } {
  const s = 净(v);
  if (!s) return { active: true, 认出来了: true };
  if (启用写法.includes(s)) return { active: true, 认出来了: true };
  if (停用写法.includes(s)) return { active: false, 认出来了: true };
  return { active: true, 认出来了: false };
}

export function 排导入(
  表: string[][],
  上下文: {
    员工们: 导入用员工[];
    /** 库里已有的渠道全称 */
    已有全称: Iterable<string>;
    /** 字典里的渠道属性（启用、停用的都算认得） */
    字典属性: readonly string[];
    /** 负责人对不上 / 没填时用谁 */
    兜底负责人: { id: string; name: string };
    /** 每一行在原表里是第几行（解析CSV带行号 / 读xlsx带行号 给的；读的时候空行已经丢了）。不给就按下标 + 1 */
    行号?: number[];
  },
): 导入计划 {
  const 计划: 导入计划 = { 要建: [], 重复: [], 拦下: [], 提示: [], 表头提示: [] };
  // 跳过开头的空行，第一行有字的当表头
  let 头行 = 0;
  while (头行 < 表.length && 表[头行].every((x) => !净(x))) 头行++;
  if (头行 >= 表.length) {
    计划.表头提示.push("表是空的");
    return 计划;
  }
  const 头 = 表[头行].map(净);
  const 位: Partial<Record<列键, number>> = {};
  头.forEach((h, i) => {
    if (!h) return;
    const 键 = (Object.keys(列名) as 列键[]).find((k) => (列名[k] as readonly string[]).includes(h));
    if (键 && 位[键] === undefined) 位[键] = i;
    else if (!键 && !不读的列.includes(h)) 计划.表头提示.push(`「${h}」这列不认识，没读`);
  });
  for (const 必 of ["名称", "来源"] as const) {
    if (位[必] === undefined) 计划.表头提示.push(`缺「${列名[必][0]}」这列，整张表没法导`);
  }
  if (位.名称 === undefined || 位.来源 === undefined) return 计划;

  const 已有 = new Set([...上下文.已有全称].map((x) => x.trim()));
  const 本文件 = new Map<string, number>();
  const 认得的属性 = new Set(上下文.字典属性);
  const 格 = (r: string[], k: 列键) => (位[k] === undefined ? "" : 净(r[位[k]!]));

  for (let i = 头行 + 1; i < 表.length; i++) {
    const r = 表[i];
    // 行号按表格里看到的写（Excel 左边那一列）：读表时丢了空行，所以要原表行号
    const 行号 = 上下文.行号?.[i] ?? i + 1;
    if (r.every((x) => !净(x))) continue;
    const 名称 = 格(r, "名称");
    const 来源 = 格(r, "来源");
    if (!名称 || !来源) {
      计划.拦下.push({ 行号, 原因: !名称 && !来源 ? "渠道名称和来源名称都没填" : !名称 ? "渠道名称没填" : "来源名称没填" });
      continue;
    }
    const 全称 = 拼全称(名称, 来源);
    if (全称.length > 全称上限) {
      计划.拦下.push({ 行号, 原因: `渠道全称「${全称.slice(0, 20)}…」超过 ${全称上限} 个字` });
      continue;
    }
    if (已有.has(全称)) {
      计划.重复.push({ 行号, 全称, 和: "库里已有" });
      continue;
    }
    const 前面 = 本文件.get(全称);
    if (前面 !== undefined) {
      计划.重复.push({ 行号, 全称, 和: `第 ${前面} 行` });
      continue;
    }
    本文件.set(全称, 行号);

    const 属性 = 格(r, "属性");
    if (属性 && !认得的属性.has(属性)) 计划.提示.push({ 行号, 话: `渠道属性「${属性}」不在字典里，照收；到 设置 → 字典 里加上才能筛` });

    const 状态原文 = 格(r, "状态");
    const 状态 = 认状态(状态原文);
    if (!状态.认出来了) 计划.提示.push({ 行号, 话: `渠道状态「${状态原文}」认不出，按启用收` });

    const 结束原文 = 格(r, "结束");
    const 结束 = 结束原文 ? 认日期(结束原文) : null;
    if (结束原文 && !结束) 计划.提示.push({ 行号, 话: `结束日期「${结束原文}」认不出，留空` });

    let 负责人id = 上下文.兜底负责人.id;
    const 负责人名 = 格(r, "负责人");
    if (负责人名) {
      const 认 = 认人(负责人名, 上下文.员工们);
      if ("id" in 认) 负责人id = 认.id;
      else 计划.提示.push({ 行号, 话: `负责人：${认.错}，先挂给 ${上下文.兜底负责人.name}` });
    } else 计划.提示.push({ 行号, 话: `负责人没填，先挂给 ${上下文.兜底负责人.name}` });

    let 创建人id: string | null = null;
    const 创建人名 = 格(r, "创建人");
    if (创建人名) {
      const 认 = 认人(创建人名, 上下文.员工们);
      if ("id" in 认) 创建人id = 认.id;
      else 计划.提示.push({ 行号, 话: `创建人：${认.错}，留空` });
    }

    计划.要建.push({ 行号, name: 全称, attr: 属性 || null, platform: 名称, active: 状态.active, endDate: 结束, channelOwnerId: 负责人id, createdById: 创建人id });
  }
  return 计划;
}

/** 给人看的报告（脚本打印用） */
export function 计划报告(计划: 导入计划, 写了: boolean): string {
  const 行: string[] = [];
  for (const h of 计划.表头提示) 行.push(`[表头] ${h}`);
  行.push(`${写了 ? "已建" : "将建"} ${计划.要建.length} 个渠道；全称重复跳过 ${计划.重复.length} 行；拦下 ${计划.拦下.length} 行。`);
  if (计划.重复.length) {
    行.push("", "全称重复，跳过：");
    for (const d of 计划.重复) 行.push(`  第 ${d.行号} 行  ${d.全称}（${d.和 === "库里已有" ? "库里已有" : `和${d.和}重复`}）`);
  }
  if (计划.拦下.length) {
    行.push("", "拦下：");
    for (const d of 计划.拦下) 行.push(`  第 ${d.行号} 行  ${d.原因}`);
  }
  if (计划.提示.length) {
    行.push("", "提示：");
    for (const d of 计划.提示) 行.push(`  第 ${d.行号} 行  ${d.话}`);
  }
  if (!写了) 行.push("", "这是演练，库没动。确认无误后加 --apply 再跑一次。");
  return 行.join("\n");
}
