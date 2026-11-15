/**
 * 跳到另一页时带过去的一句话（落地后在那页原处说，不弹顶部提示；原型 g.notice「改后」）。
 *
 * 例：嵌在客户页的项目详情里，最后一个我负责的项目转走 / 退回公海 / 删了，人被送回客户列表——
 * 这一页没地方写为什么，跳过去以后在客户列表上方写一句「这位客户下已经没有你负责的项目了，已回到客户列表」。
 *
 * 一次性：只给要去的那一页（按路径，不看查询串），30 秒内落地才算；那一页的人点「知道了」或离开就清掉。
 * 站内跳转（router.push）靠这里的内存就够；存一份 sessionStorage 是为了整页刷新那种落地，读写都 try/catch（无痕 / 禁存储时只靠内存）。
 */
const 键 = "crm:landing-note";
const 有效毫秒 = 30_000;

type 一句 = { 到: string; 话: string; 至: number };
let 待: 一句 | null = null;
let 读过存储 = false;
const 听众 = new Set<() => void>();
const 发 = () => 听众.forEach((f) => f());

const 路径of = (到: string) => 到.split(/[?#]/)[0];

/** 跳之前调：到 = 要去的地址（可以带查询串），话 = 落地后那页要说的 */
export function 留落地话(到: string, 话: string) {
  待 = { 到: 路径of(到), 话, 至: Date.now() + 有效毫秒 };
  读过存储 = true;
  try {
    sessionStorage.setItem(键, JSON.stringify(待));
  } catch {
    /* 存不了：站内跳转照样靠内存 */
  }
  发();
}

function 读(): 一句 | null {
  if (!待 && !读过存储) {
    读过存储 = true;
    try {
      const x = JSON.parse(sessionStorage.getItem(键) ?? "null") as Partial<一句> | null;
      if (x && typeof x.到 === "string" && typeof x.话 === "string" && typeof x.至 === "number") 待 = { 到: x.到, 话: x.话, 至: x.至 };
    } catch {
      /* 读不了 / 坏了：当没有 */
    }
  }
  return 待;
}

/** 这一页（路径）有没有带过来的话；不清 */
export function 看落地话(路径: string): string | null {
  const x = 读();
  return x && x.到 === 路径of(路径) && x.至 >= Date.now() ? x.话 : null;
}

/** 说过了（点了「知道了」、离开了这页）：清掉 */
export function 清落地话() {
  if (!待) return;
  待 = null;
  try {
    sessionStorage.removeItem(键);
  } catch {
    /* 同上 */
  }
  发();
}

export function 订落地话(f: () => void) {
  听众.add(f);
  return () => void 听众.delete(f);
}
