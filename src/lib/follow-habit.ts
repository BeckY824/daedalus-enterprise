/**
 * 「记一条沟通」默认选哪种沟通方式（11-17 客户答复：「建议记录个人使用习惯」，没有按业务线写死 WhatsApp）：
 * 看这个人自己最近记的 20 条沟通（哪个客户、哪个项目都算，只算他自己记的），用得最多的那种；
 * 一样多的，取其中最近用过的那种；一条都没有 → null（表单照原来的默认走）。
 *
 * 只管「沟通方式」，不管发起主体。人照样能改，改了不另存——下一次记下来的那条自然进了这 20 条。
 * 读库在 app/(app)/follow-method-actions.ts 我常用的沟通方式；这里是纯函数，单测直接引（tests/follow-habit.test.ts）
 */

/** 往回看几条 */
export const 看最近几条 = 20;

/** 任务、提醒不是沟通 */
const 不算 = new Set(["TASK", "REMIND"]);

export type 一条方式 = { type: string; method: string | null };

/**
 * 记录按「记的时间」从新到旧给。能选 = 现在还能选的（企业字典停用了的方式不再默认），不给 = 都算。
 * 认「方式」（企业字典的名字）；老记录没有方式的按类型认
 */
export function 挑常用方式(记录们: readonly 一条方式[], 能选?: (x: 一条方式) => boolean): 一条方式 | null {
  const 计 = new Map<string, { 次: number; 最近: number; x: 一条方式 }>();
  记录们.slice(0, 看最近几条).forEach((x, i) => {
    if (不算.has(x.type) || (能选 && !能选(x))) return;
    const 键 = x.method ? `m:${x.method}` : `t:${x.type}`;
    const 有 = 计.get(键);
    if (有) 有.次++;
    else 计.set(键, { 次: 1, 最近: i, x: { type: x.type, method: x.method ?? null } });
  });
  let 选: { 次: number; 最近: number; x: 一条方式 } | null = null;
  for (const c of 计.values()) if (!选 || c.次 > 选.次 || (c.次 === 选.次 && c.最近 < 选.最近)) 选 = c;
  return 选?.x ?? null;
}
