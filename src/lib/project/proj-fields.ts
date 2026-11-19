/**
 * 项目上的痛点标注、合同状态（企业版，迁移 101）、备货状态、物流单号（迁移 154）的纯规矩：选项、默认值、编辑项目交上来的值怎么认。
 * 不碰库，界面、db.ts 改项目、必填判定共用。项目方案是附件（tag「方案」），规矩见 enterprise/customer-v2.ts 项目附件分类们。
 *
 * 合同状态默认「起草中」：新建项目写进去；库里空的（老项目、或用户选了「—」）界面显示「—」（11-04 用户：空值统一「—」、下拉能回到「—」）
 */

import { 不填值 } from "@/lib/enterprise/dict-kinds";

/** 合同状态七项，顺序固定（界面下拉就按这个排） */
export const 合同状态们 = ["起草中", "待对方确认", "待我方确认", "对方修改中", "我方修改中", "已生效", "已终止"] as const;
export type 合同状态 = (typeof 合同状态们)[number];
export const 默认合同状态: 合同状态 = "起草中";
/** 必填里「合同已生效」认的那一项 */
export const 生效的合同状态: 合同状态 = "已生效";

export function 是合同状态(v: unknown): v is 合同状态 {
  return typeof v === "string" && (合同状态们 as readonly string[]).includes(v);
}

/**
 * 备货状态（企业版，迁移 154，客户 11-19：「生产备货」新增「备货状态」字段，枚举值为未生产、生产中、已备货）。
 * 三项固定、顺序固定（客户给的就是这三个，不进字典）；没填 = 空，界面写「—」。新建项目不写默认
 */
export const 备货状态们 = ["未生产", "生产中", "已备货"] as const;
export type 备货状态 = (typeof 备货状态们)[number];
export function 是备货状态(v: unknown): v is 备货状态 {
  return typeof v === "string" && (备货状态们 as readonly string[]).includes(v);
}
/** 显示用：库里空的、认不出的都当没填（null，界面写「—」） */
export function 备货状态显示(存的: string | null | undefined): 备货状态 | null {
  return 是备货状态(存的) ? 存的 : null;
}
/** 物流单号最多几个字：一行，够放好几个单号用逗号隔开 */
export const 物流单号上限 = 100;

export type 备货单号 = { stockStatus: string | null; trackingNo: string | null };
/**
 * 编辑项目交上来的备货状态、物流单号 → 要存的值（改项目 合进 新 里比变没变）。物流状态对字典要读库，在 db.ts 物流状态改成。
 *   备货状态：没传 = 原样；空 / 「—」= 清掉；不在三项里报错；和现在显示的一样 = 原样
 *   物流单号：没传 = 原样；去首尾空白，空 = 清掉；只写一行（换行报错）；超长报错（不悄悄截断）
 */
export function 备货单号改成(
  patch: Partial<Record<keyof 备货单号, unknown>>,
  原: 备货单号,
): { ok: true; 值: 备货单号 } | { ok: false; error: string } {
  let stockStatus = 原.stockStatus;
  if (patch.stockStatus !== undefined) {
    const v = patch.stockStatus === null || patch.stockStatus === "" || patch.stockStatus === 不填值 ? null : patch.stockStatus;
    if (v !== null && !是备货状态(v)) return { ok: false, error: `备货状态「${String(v)}」认不出来，从下拉里选一个` };
    if (v !== 备货状态显示(原.stockStatus)) stockStatus = v;
  }
  let trackingNo = 原.trackingNo;
  if (patch.trackingNo !== undefined) {
    if (patch.trackingNo !== null && typeof patch.trackingNo !== "string") return { ok: false, error: "物流单号要写文字" };
    const t = (patch.trackingNo ?? "").trim();
    if (/[\r\n]/.test(t)) return { ok: false, error: "物流单号只写一行，几个单号用逗号隔开" };
    if ([...t].length > 物流单号上限) return { ok: false, error: `物流单号最多 ${物流单号上限} 个字` };
    trackingNo = t || null;
  }
  return { ok: true, 值: { stockStatus, trackingNo } };
}

/**
 * 系统替人定分配方式时写的叫法（V-分配方式 默认五项里的这几项，同 lib/enterprise/dict.ts 分配方式默认项、market-transfer.ts 客户层分配方式）。
 * 人在弹窗里选的照存选的那一项的名字，不走这里
 */
export const 系统分配方式 = { 指定分配: "指定分配", 自动分配: "自动分配", 公海捞取: "公海捞取", 个人自持: "个人自持" } as const;

/**
 * 没人选分配方式、系统建项目时按「谁建给谁」定（11-18 复盘第 5 类：补潜客培育、线索转化不写分配方式）：
 * 建给自己 = 个人自持（P-转-15 销售自建走自持）；建给别人 = 指定分配（同 客户层分配方式）。
 * 纯函数、不分角色；系统建项目一律走 self-assign-mode.ts 系统建项目分配方式（市场成员建给自己 = 暂不分配，11-18 总控追加）
 */
export function 建给谁的分配方式(负责人: string, 建的人: string): string {
  return 负责人 && 负责人 === 建的人 ? 系统分配方式.个人自持 : 系统分配方式.指定分配;
}

/**
 * 导入建的项目的分配方式（M-导入-01）：原表整行任一格含「自拓」或「展会」→ 个人自持；都不含 → 自动分配。
 * 原始行 = 原系统那一行（键值都看，值是对象 / 数组的展开看）
 */
export function 导入分配方式(原始行: unknown): string {
  const 文字 = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "object" ? Object.values(v as object).map(文字).join(" ") : String(v));
  return /自拓|展会/.test(文字(原始行)) ? 系统分配方式.个人自持 : 系统分配方式.自动分配;
}

/**
 * 新建项目时写进去的默认值（企业版；别的版本什么都不写，列留空，也不显示）：
 *   - 合同状态落「起草中」（V-合同状态 默认值）；
 *   - 分配方式（F-项目-15）、项目来源（渠道 id，「新建项目时默认带客户来源」）每条建项目的路都要说清：给 null = 这条路不写，在调用处写明为什么。
 * 建项目的路都得经过这里（tests/project-create-guard.test.ts 扫源码守着，11-18 复盘第 5 类：几条路默认值各缺一样）
 */
export function 新项目默认值(
  企业: boolean,
  来: { 分配方式: string | null; 项目来源: string | null },
): { contractStatus?: 合同状态; assignMode?: string; channelId?: string } {
  if (!企业) return {};
  return {
    contractStatus: 默认合同状态,
    ...(来.分配方式 ? { assignMode: 来.分配方式 } : {}),
    ...(来.项目来源 ? { channelId: 来.项目来源 } : {}),
  };
}

/** 显示用：库里空的、认不出的都当没填（null，界面写「—」） */
export function 合同状态显示(存的: string | null | undefined): 合同状态 | null {
  return 是合同状态(存的) ? 存的 : null;
}

/** 痛点标注最多几个字：多行自由文本，比备注宽一些 */
export const 痛点标注上限 = 2000;

export type 项目新字段 = { painPoints: string | null; contractStatus: string | null };

/**
 * 编辑项目交上来的痛点标注、合同状态 → 要存的值（改项目 合进 新 里比变没变）。
 *   痛点标注：没传 = 原样；只去首尾空白（中间换行留着），空 = 清掉；超长报错（不悄悄截断）
 *   合同状态：没传 = 原样；空 = 清掉（显示「—」）；不在七项里报错；
 *             和现在显示的一样 = 原样
 */
export function 项目新字段改成(
  patch: Partial<Record<keyof 项目新字段, unknown>>,
  原: 项目新字段,
): { ok: true; 值: 项目新字段 } | { ok: false; error: string } {
  let painPoints = 原.painPoints;
  if (patch.painPoints !== undefined) {
    if (patch.painPoints !== null && typeof patch.painPoints !== "string") return { ok: false, error: "痛点标注要写文字" };
    const t = (patch.painPoints ?? "").trim();
    if ([...t].length > 痛点标注上限) return { ok: false, error: `痛点标注最多 ${痛点标注上限} 个字` };
    painPoints = t || null;
  }
  let contractStatus = 原.contractStatus;
  if (patch.contractStatus !== undefined) {
    const v = patch.contractStatus === null || patch.contractStatus === "" ? null : patch.contractStatus;
    if (v !== null && !是合同状态(v)) return { ok: false, error: `合同状态「${String(v)}」认不出来，从下拉里选一个` };
    // 和现在显示的一样就不动（不写库、不过字段权限）：空着又交「—」、选了原来那项都算没改
    if (v !== 合同状态显示(原.contractStatus)) contractStatus = v;
  }
  return { ok: true, 值: { painPoints, contractStatus } };
}
