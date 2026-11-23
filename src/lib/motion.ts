/**
 * 动效的 JS 镜像。motion 认不了 CSS 变量，JS 里只能写数值——**只许写在这里**。
 *
 * 和 globals.css 的 :root 一一对应（tests/motion-tokens.test.ts 逐值对一遍，对不上就红）：
 *   曲线CSS.ease = --ease         曲线CSS.spring = --ease-spring  曲线CSS.morph = --ease-morph
 *   时长.press  = --t-press       时长.pop    = --t-pop         时长.fast  = --t-fast
 *   时长.leave  = --t-leave       时长.base   = --t             时长.morph = --t-morph    时长.seal = --t-seal
 *   间隔        = --stagger       浮层缩放    = --pop-scale
 * 单位不同：CSS 写毫秒，这里是秒（motion 的 duration 按秒算）。
 *
 * 2026-11 动效底座（P-界面-38，「像 Apple 靠齐」）：JS 侧能用弹簧就用弹簧（下面 弹簧 三档，全都不回弹），
 * CSS 侧用 linear() 采样同一条弹簧；原来 --ease-spring 那条 1.34 的过冲去掉了。
 *
 * 为什么要这一份：2026-09-28 之前 JS 里到处是各写各的数，已经和 CSS 对不上了——
 * Rise 0.42s 超过 320 上限（守卫只查样式表，查不到 JS）、时间线排队 40ms 而 Rise 70ms、
 * 左栏底块用的 [0.2, 0.8, 0.2, 1] 是第四条曲线、MotionConfig 默认 0.26 不是任何一档。
 * 现在 src 下别处写裸的 duration / ease 会被守卫抓出来。
 */

/** 和 motion 的 BezierDefinition 同形：直接传 `ease: 曲线.morph`，不用展开 */
type 贝塞尔 = readonly [number, number, number, number];

/**
 * 弹簧档位（P-界面-38，2026-11 动效底座）：照 Apple「拿不准就 bounce 0」——**全站不回弹**，
 * 阻尼比 ζ = damping / (2·√(stiffness·mass)) 都在 1 附近（临界阻尼），到位不越过。
 * 数值和 motion 的 { visualDuration, bounce: 0 } 一一对应（原型 前端改版-逐块确认/core.js 的 S 表）：
 *   snap   1218 / 70   ≈ visualDuration .18   按下、勾选、开关、选中跟随
 *   ui      632 / 50   ≈ visualDuration .25   菜单尺寸、行重排、列表增删、页签内容（MotionConfig 的默认）
 *   panel   439 / 42   ≈ visualDuration .30   弹窗、抽屉、命令面板、浮窗
 * 写 motion 的地方直接 `transition={弹簧.ui}`；CSS 那边用不了弹簧，用下面 弹簧曲线 采出来的 linear()。
 */
export const 弹簧 = {
  snap: { type: "spring", stiffness: 1218, damping: 70, mass: 1 },
  ui: { type: "spring", stiffness: 632, damping: 50, mass: 1 },
  panel: { type: "spring", stiffness: 439, damping: 42, mass: 1 },
} as const;
export type 弹簧参数 = { stiffness: number; damping: number; mass: number };

/**
 * 从 0 到 1 跑一遍弹簧（半隐式欧拉，1ms 一步，和原型 core.js 同一算法），离 1 不到千分之一、速度也停了就算到位。
 * 返回到位用了几秒、每毫秒的位置。纯算术，浏览器、Node 跑出来逐位一样（测试拿它对 globals.css 里的字面值）。
 */
export function 弹簧轨迹(p: 弹簧参数): { 秒: number; 位置: number[] } {
  const dt = 1 / 1000;
  let x = 0, v = 0, t = 0;
  const 位置 = [0];
  while (t < 2.5) {
    const a = (-p.stiffness * (x - 1) - p.damping * v) / p.mass;
    v += a * dt; x += v * dt; t += dt;
    位置.push(x);
    if (Math.abs(1 - x) < 0.001 && Math.abs(v) < 0.02) break;
  }
  return { 秒: t, 位置 };
}

/** 把弹簧的一整段（起步到到位）按时间均分 段 段，取每个分点的位置，三位小数；首尾钉成 0、1 */
export function 弹簧采样(p: 弹簧参数, 段 = 32): number[] {
  const { 位置 } = 弹簧轨迹(p);
  const 点 = Array.from({ length: 段 + 1 }, (_, i) => Math.round(位置[Math.round((i / 段) * (位置.length - 1))] * 1000) / 1000);
  点[0] = 0;
  点[段] = 1;
  return 点;
}

/** 均分的点连成折线，给 motion 当缓动函数用（和 CSS 的 linear(…) 一个形状） */
function 折线(点: readonly number[]): (t: number) => number {
  const n = 点.length - 1;
  return (t) => {
    if (t <= 0) return 点[0];
    if (t >= 1) return 点[n];
    const i = Math.floor(t * n);
    return 点[i] + (点[i + 1] - 点[i]) * (t * n - i);
  };
}

/**
 * CSS 侧的弹簧：ui 那档弹簧采样成 linear()。临界阻尼的弹簧按「到位时间」归一化以后形状只差一点点，
 * 所以 CSS 一条曲线就够，快慢交给 --t-* 时长。globals.css 的 --ease / --ease-spring 一字不差就是这一串
 * （tests/motion-tokens.test.ts 逐字对）；不支持 linear() 的老浏览器在 globals.css 的 @supports 里回到 cubic-bezier。
 */
export const 弹簧点 = 弹簧采样(弹簧.ui);
export const 弹簧CSS = `linear(${弹簧点.join(", ")})`;
const 弹簧缓动 = 折线(弹簧点);

/** 时长不变时的三条曲线（JS 侧用 motion 的 tween 时拿这几个） */
export const 曲线 = {
  /** 绝大多数：出现、消失、位移。= 弹簧（不回弹）的形状，起步快、收尾软 */
  ease: 弹簧缓动,
  /** 「弹出来」的：菜单、开关拨柄、确认态。11 月起和 ease 同一条弹簧，**不再过冲**（原来 1.34 的那一下） */
  spring: 弹簧缓动,
  /** 一个东西变成另一个东西：浮层长出来、卡片收成一行。两头慢中间快 */
  morph: [0.33, 0.55, 0.2, 1] as 贝塞尔,
} as const;

/** 上面三条曲线在 CSS 里的写法（antd 的 token、测试对 :root 用） */
export const 曲线CSS = {
  ease: 弹簧CSS,
  spring: 弹簧CSS,
  morph: `cubic-bezier(${曲线.morph.join(", ")})`,
} as const;

/** 秒 */
export const 时长 = {
  /** 按下：故意最短 */
  press: 0.09,
  /** 浮层（菜单、下拉、气泡）从触发处 .97 缩放出现 */
  pop: 0.1,
  /** 悬停、收起、撤销：要跟手的 */
  fast: 0.12,
  /** 悬停离开（进入是即时的，不走过渡） */
  leave: 0.15,
  /** 绝大多数过渡 */
  base: 0.18,
  /** 形变；也是除落印以外的上限 */
  morph: 0.32,
  /** 落印专用，也只许它用（上限 0.48） */
  seal: 0.32,
} as const;

/** 浮层出现时从多大缩放起（= --pop-scale）。只缩一点点：看得出「从这里长出来」，看不出「弹」 */
export const 浮层缩放 = 0.97;

/**
 * 进场排队，一档的间隔（秒）。70ms：40ms 那一版排是排了但人看不出（2026-09-18 装机反馈），
 * 间隔要读得出先后，又不能读出「它在等」。超过八档就整组一起出来。
 */
export const 间隔 = 0.07;

/**
 * 打字机（登录页的「Daedalus.AI CRM」，login/TypeBrand.tsx）：等窗口露面再起步，一个字一档。
 * 不是过渡时长，不受 320 上限管；打完光标再闪 收尾 秒就收掉。
 */
export const 打字 = { 起步: 0.5, 每字: 0.09, 收尾: 2.4 } as const;

/**
 * agent 过程里「一句打算」逐字出来（背调，照 Attio 首页那条：约一帧一个字）。
 * 比登录页的打字机快得多——这是在读它的想法，不是看字一个个敲。
 */
export const 思考打字 = { 每字: 0.016 } as const;

/**
 * 各处 motion 组件拿的那一份（经 components/MotionTheme.tsx 的 useMotionTheme()）：就是上面这几个常量。
 */
export type 缓动 = 贝塞尔 | ((t: number) => number);
export type 动效 = {
  曲线: { ease: 缓动; spring: 缓动; morph: 缓动 };
  时长: { press: number; pop: number; fast: number; leave: number; base: number; morph: number; seal: number };
  间隔: number;
};
export const 现状动效: 动效 = { 曲线, 时长, 间隔 };

/**
 * MotionConfig 的默认过渡：ui 那档弹簧（不回弹）。
 * 系统开了「减弱动态」不在这里管——MotionTheme 上的 reducedMotion="user" 让 motion 把位移、缩放直接跳到位，只留透明度。
 */
export const 默认过渡 = 弹簧.ui;

/**
 * 「选中跟着走」的过渡：左栏选中底块、⌘K 高亮块从一项滑到另一项（PR2 外壳，原型 g.nav / g.cmdk 的 S.snappy）。
 * 走 snap 那档弹簧——比 ui 快一档，手指到哪它就到哪。
 */
export const 跟随过渡 = 弹簧.snap;

/**
 * 列表重排（FLIP / motion 的 layout）最多带几行。超过就整批硬换、不做位移动画：
 * 每一行都要量一次位置再补一段位移，几百行同时动在 Windows 的集显上掉帧，掉帧比不动更像卡。
 * ⌘K 的结果单用它；以后长表要做 FLIP 也照这个数。
 */
export const 重排上限 = 40;

/**
 * antd 的动效 token（16a），lib/theme.ts 直接展开。悬停 / 收起 = fast，展开 = base，浮层长出来 = morph。
 * 曲线写成 var(--ease*)：antd 只把它们原样拼进样式（transition / animation），从不拿来算，
 * 写变量就和 CSS 那边同一条——老浏览器不认 linear() 时也跟着 globals.css 的 @supports 退回 cubic-bezier，
 * 不会因为一条认不出的曲线让 antd 的进场动画整条作废（rc-motion 等不到 animationend，弹层就卡住）。
 * 两条 back 原本带过冲：out-back 接不过冲的 --ease-spring，in-back 接 --ease-morph（全站不回弹，P-界面-38）。
 * 暗黑下 antd-dark.css 那几条 --ant-motion-* 也是同样的接法。
 */
export const antd动效 = {
  motionDurationFast: `${时长.fast}s`,
  motionDurationMid: `${时长.base}s`,
  motionDurationSlow: `${时长.morph}s`,
  motionEaseOut: "var(--ease)",
  motionEaseInOut: "var(--ease-morph)",
  motionEaseOutBack: "var(--ease-spring)",
  motionEaseInBack: "var(--ease-morph)",
} as const;
