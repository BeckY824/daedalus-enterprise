/**
 * 项目上的痛点标注、合同状态（企业版，迁移 101）的纯规矩：选项、默认值、编辑项目交上来的值怎么认。
 * 不碰库，界面、db.ts 改项目、必填判定共用。项目方案是附件（tag「方案」），规矩见 enterprise/customer-v2.ts 项目附件分类们。
 *
 * 合同状态默认「起草中」：新建项目写进去；老项目库里是空的，界面上按「起草中」显示（只是显示兜底，不改老数据）
 */

/** 合同状态七项，顺序固定（界面下拉就按这个排） */
export const 合同状态们 = ["起草中", "待对方确认", "待我方确认", "对方修改中", "我方修改中", "已生效", "已终止"] as const;
export type 合同状态 = (typeof 合同状态们)[number];
export const 默认合同状态: 合同状态 = "起草中";
/** 必填里「合同已生效」认的那一项 */
export const 生效的合同状态: 合同状态 = "已生效";

export function 是合同状态(v: unknown): v is 合同状态 {
  return typeof v === "string" && (合同状态们 as readonly string[]).includes(v);
}

/** 新建项目时写进去的：企业版合同状态落「起草中」；别的版本不写（列留空，也不显示） */
export function 新项目默认值(企业: boolean): { contractStatus?: 合同状态 } {
  return 企业 ? { contractStatus: 默认合同状态 } : {};
}

/** 显示用：库里空的（老项目）、认不出的都按默认「起草中」 */
export function 合同状态显示(存的: string | null | undefined): 合同状态 {
  return 是合同状态(存的) ? 存的 : 默认合同状态;
}

/** 痛点标注最多几个字：多行自由文本，比备注宽一些 */
export const 痛点标注上限 = 2000;

export type 项目新字段 = { painPoints: string | null; contractStatus: string | null };
export const 新字段键 = ["painPoints", "contractStatus"] as const;

/**
 * 编辑项目交上来的痛点标注、合同状态 → 要存的值（改项目 合进 新 里比变没变）。
 *   痛点标注：没传 = 原样；只去首尾空白（中间换行留着），空 = 清掉；超长报错（不悄悄截断）
 *   合同状态：没传 = 原样；空 = 回到默认「起草中」（这格不让空着）；不在七项里报错；
 *             和现在显示的一样（含老项目空着显示「起草中」）= 原样
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
    const v = patch.contractStatus === null || patch.contractStatus === "" ? 默认合同状态 : patch.contractStatus;
    if (!是合同状态(v)) return { ok: false, error: `合同状态「${String(v)}」认不出来，从下拉里选一个` };
    // 和现在显示的一样就不动：老项目库里是空、界面显示「起草中」原样交回来，不算改（不写库、不过字段权限）
    if (v !== 合同状态显示(原.contractStatus)) contractStatus = v;
  }
  return { ok: true, 值: { painPoints, contractStatus } };
}
