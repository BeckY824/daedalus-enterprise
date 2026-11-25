/**
 * 「未建线索」待补建记录本身（机制总表 P-公海-15 后半，迁移 165 EntDupeHit.unbuilt；客户 E-223 / E-227）：
 * 存在撞号台账那一行的 unbuilt 列（JSON）：一次没建 = 一个对象；同一人 10 分钟内再交（并在同一行）= 数组，按交的先后。
 * 这里只放记录的样子和读写这一列的小件（不连别的业务模块，owner-log-db.ts 进公海时也调，免得循环引用）：
 *   - 读未建线索：读的地方都走这里（两种写法都认）
 *   - 未建条们 / 改未建条：按「这一行里第几条」读、改一条（补建、不补建、进公海自动关），别的条原样留着
 *   - 待补建进公海关：客户进了公海（换到公海占位账号那次，同挂靠申请进公海关），这位客户还待补建的都标「已关闭」，改走公海领取
 * 状态：待补建 → 已补建（销售管理点「补建」，写上谁 / 几点 / 补成哪条线索）或 已关闭（点「不补建」写原因；客户进公海自动关）
 */
import type { Prisma } from "@/generated/prisma";

/** 一条待补建记录的状态（客户 E-227 三处默认：不补建必须写原因、进公海自动关） */
export type 未建状态 = "待补建" | "已补建" | "已关闭";

/**
 * 处理结果：谁（进公海自动关 = null）、几点；已补建带补成的线索和接手人、落法（负责人名下 / 自动分配 / 销售管理手选）；
 * 已关闭带原因（不补建写的，或「客户已进公海…」）
 */
export type 未建处理 = {
  谁: { id: string; 名: string } | null;
  时间: string;
  线索?: { id: string; 名: string; 接手人: { id: string; 名: string }; 落法: "负责人" | "自动分配" | "手选" };
  原因?: string;
  自动?: "进公海";
};

/**
 * 记录里存的：补建要用的字段（客户编号、渠道、对接人、沟通、原因、线、当时的负责人、通知了谁、交的人和时间）。
 * 不写客户名（客户 id 在台账这一行的 customerId 上）；号码在这一行的 keyValue 上，这里不重复
 */
export type 未建线索记录 = {
  状态: 未建状态;
  /** 没人接 = 交销售挑不到人；到上限 = 主路径客户负责人到持有上限 */
  类: "没人接" | "到上限";
  /** 客户编号（显示用的 NO.xxxxx；没编号的老数据 = 短号或「—」） */
  客户编号: string;
  /** 这次选的渠道（补建时的项目来源） */
  渠道: { id: string; 名: string };
  /** 对接人：挂号码撞上的那位客户联系人（id），或交的人填的新对接人（还没建，补建时再建） */
  对接人: { 撞上的联系人: string } | { 新建: { 名字: string; 职务: string | null } };
  /** 这次的沟通：方式（字典叫法）、类型、发起方、时间（ISO）、内容全文 */
  沟通: { 方式: string | null; 类型: string; 发起方: string | null; 时间: string; 内容: string };
  没建原因: string;
  /** 这次定的线（判不出 = null） */
  线: "内贸" | "外贸" | null;
  /** 当时的客户负责人（主路径到上限时就是他；交销售时是接不了的那位） */
  客户负责人: { id: string; 名: string };
  /** 通知了谁：类别（销售管理 / 系统管理员 / 一个都没有）+ 收件人 */
  通知了: { 类别: "销售管理" | "系统管理员" | null; 人: { id: string; 名: string }[] };
  交的人: { id: string; 名: string };
  /** 交的时刻（ISO） */
  交的时间: string;
  /** 处理了才有（已补建 / 已关闭） */
  处理?: 未建处理;
};

const 是记录 = (x: unknown): x is 未建线索记录 => !!x && typeof x === "object" && !Array.isArray(x) && typeof (x as { 交的时间?: unknown }).交的时间 === "string";

/**
 * 读台账一行的待补建记录：一次没建 = 一个对象（迁移 165 起的写法）；同一人 10 分钟内再交（并在同一行）= 数组，按交的先后。
 * 读的地方都走这里（两种都认）；空 / 解析不了 = []
 */
export function 读未建线索(unbuilt: string | null | undefined): 未建线索记录[] {
  if (!unbuilt) return [];
  try {
    const v = JSON.parse(unbuilt) as unknown;
    if (Array.isArray(v)) return v.filter((x): x is 未建线索记录 => !!x && typeof x === "object");
    return v && typeof v === "object" ? [v as 未建线索记录] : [];
  } catch {
    return [];
  }
}

/** 这一行里的每一条和它在这一行里的位置（数组里的下标；一个对象 = 0）。解析不了的条不出现，位置照原样算 */
export function 未建条们(unbuilt: string | null | undefined): { 位: number; 记录: 未建线索记录 }[] {
  if (!unbuilt) return [];
  let v: unknown;
  try { v = JSON.parse(unbuilt); } catch { return []; }
  const 们 = Array.isArray(v) ? v : [v];
  return 们.flatMap((x, 位) => (是记录(x) ? [{ 位, 记录: x }] : []));
}

/** 改这一行里第 位 条（别的条原样留着，连读不出的也不丢）；那一条不在了 = null */
export function 改未建条(unbuilt: string | null | undefined, 位: number, 改: (r: 未建线索记录) => 未建线索记录): string | null {
  if (!unbuilt) return null;
  let v: unknown;
  try { v = JSON.parse(unbuilt); } catch { return null; }
  if (!Array.isArray(v)) return 位 === 0 && 是记录(v) ? JSON.stringify(改(v)) : null;
  if (!是记录(v[位])) return null;
  const 新 = [...v];
  新[位] = 改(v[位] as 未建线索记录);
  return JSON.stringify(新);
}

/** 这一条在页面、动作里的键：台账行 id + 位置（冒号隔开） */
export const 未建键 = (行id: string, 位: number) => `${行id}:${位}`;
export function 拆未建键(键: unknown): { 行id: string; 位: number } | null {
  const m = typeof 键 === "string" ? /^([A-Za-z0-9_-]{1,64}):(\d{1,3})$/.exec(键) : null;
  return m ? { 行id: m[1], 位: Number(m[2]) } : null;
}

/** 客户进公海自动关的原因（客户 E-227 三处默认 ③） */
export const 进公海关原因 = "客户已进公海，这条自动关闭，改走公海领取";

/**
 * 客户进公海（换到公海占位账号那次，owner-log-db.ts 记换负责人 pool-release）：这几位客户还「待补建」的记录都标「已关闭」（处理人空、原因 进公海关原因）。
 * 在调用方的事务里写，和换负责人一起提交 / 回滚；撤销放进公海时不复活（同挂靠申请），要补建由领到的人在公海领取时记沟通
 */
export async function 待补建进公海关(tx: Pick<Prisma.TransactionClient, "entDupeHit">, customerIds: readonly string[]): Promise<void> {
  const 时间 = new Date().toISOString();
  for (let i = 0; i < customerIds.length; i += 500) {
    const 行们 = await tx.entDupeHit.findMany({ where: { customerId: { in: customerIds.slice(i, i + 500) }, unbuilt: { not: null } }, select: { id: true, unbuilt: true } });
    for (const 行 of 行们) {
      let 文 = 行.unbuilt;
      for (const { 位, 记录 } of 未建条们(文)) {
        if (记录.状态 !== "待补建") continue;
        文 = 改未建条(文, 位, (r) => ({ ...r, 状态: "已关闭", 处理: { 谁: null, 时间, 原因: 进公海关原因, 自动: "进公海" } })) ?? 文;
      }
      if (文 !== 行.unbuilt) await tx.entDupeHit.update({ where: { id: 行.id }, data: { unbuilt: 文 } });
    }
  }
}
