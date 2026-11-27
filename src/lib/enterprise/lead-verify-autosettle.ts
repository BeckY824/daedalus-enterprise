/**
 * 「重复咨询到期自动落定」独立开关（E-424）：重复咨询线索在验证里等人判，到期提醒仍归「超时未跟进自动转」管，
 * 到期后按上一步判定自动落定这一步归本开关。默认关：库里没有这行 = 关，一直等人来判。
 * 从关拨到开时把那一刻记进 Setting（自动落定生效key）：只对起钟时刻不早于它的落定，关着期间积压的照旧等人判。
 */
import { getSetting } from "../settings";

export const 自动落定开关key = "enterprise.lead_verify_autosettle.on";
export const 自动落定生效key = "enterprise.lead_verify_autosettle.since";

/** 开着没：只有存了 true 才算开（没存过 = 关，和扫库检测相反） */
export async function 自动落定开着(): Promise<boolean> {
  return (await getSetting<boolean>(自动落定开关key)) === true;
}

/** 拨开的时刻；没记过 / 坏了 = null（调用方当「还没生效」，一条都不落定） */
export async function 自动落定生效时刻(): Promise<Date | null> {
  const v = await getSetting<unknown>(自动落定生效key);
  const t = typeof v === "string" ? new Date(v) : null;
  return t && !Number.isNaN(t.getTime()) ? t : null;
}
