/**
 * 客户详情最左那条客户名单可以拖宽（11-12 用户：「这一栏要可调节宽度，以及默认的宽度要比现在宽一点」）。
 *
 * 宽度落在 <html> 的 CSS 变量 --roster-cust-w 上：首帧前由 外观预设脚本 从 localStorage 读出来挂上（不闪），
 * 拖的时候 CustomerRoster 实时改它，松手才存。只管客户名单（.pane-roster-cust），项目名单还是 --roster-w。
 *
 *   默认 280：原来 220，加 60 ≈ 13px 字多露 4–5 个字（国家 + 客户名 + 相对时间、摘要那两行）
 *   最小 220：原来的默认，不比它窄
 *   最大 420，再按窗口收紧：右边正文不小于名单刚露出来那一档（1214 门槛）时的正文宽 = 1214 − 56（客户详情的图标窄栏）− 220 = 938
 */
export const 名单宽键 = "daedalus.roster.w";
export const 名单默认宽 = 280;
export const 名单最窄 = 220;
export const 名单最宽 = 420;
export const 正文最窄 = 938;
export const 名单宽变量 = "--roster-cust-w";

/** 按当前窗口能给到的最宽（窗口窄了收紧，不低于最窄） */
export function 名单可到(窗宽: number, 左栏宽: number): number {
  return Math.max(名单最窄, Math.min(名单最宽, Math.floor(窗宽 - 左栏宽 - 正文最窄)));
}

export function 夹名单宽(w: number, 上限 = 名单最宽): number {
  return Math.round(Math.max(名单最窄, Math.min(上限, w)));
}

export function 读名单宽(): number {
  try {
    const v = Number(localStorage.getItem(名单宽键));
    return Number.isFinite(v) && v >= 名单最窄 && v <= 名单最宽 ? v : 名单默认宽;
  } catch {
    return 名单默认宽;
  }
}

export function 存名单宽(w: number) {
  try {
    if (w === 名单默认宽) localStorage.removeItem(名单宽键);
    else localStorage.setItem(名单宽键, String(w));
  } catch {
    /* 存不了（无痕、禁用）就只这一次有效 */
  }
}

/** 拼进 外观预设脚本（layout.tsx 的 <head>）：首帧前把记住的宽度挂到 <html> 上 */
export const 名单宽预设段 = `try{var rw=+localStorage.getItem(${JSON.stringify(名单宽键)});if(rw>=${名单最窄}&&rw<=${名单最宽})e.style.setProperty(${JSON.stringify(名单宽变量)},rw+"px");}catch(_){}`;
