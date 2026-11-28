/**
 * 发版之后还开着老页面（11-17 正式服日志）：页面是发版前打开的，里面的 server action 编号是老版本的，
 * 一提交服务端就报 `Failed to find Server Action "…"`，人这边只看到「没改成，请稍后再试」，以为系统坏了。
 *
 * 两头接住：
 * 1. 提交之前就发现（components/UpdateBanner.tsx 问 /api/version）：顶上一条「系统刚更新了，刷新一下再继续」
 * 2. 已经撞上了：各处 catch 里用 动作出错话(e, 原来那句)，认出是老版本的动作，换成「系统刚更新了，请刷新页面后再提交」，
 *    同时把顶上那条点亮
 *
 * Next 16.4 客户端实际抛的（node_modules/next/dist/client/components/router-reducer/reducers/server-action-reducer.js）：
 * 服务端回 409（编号格式不对是 400）+ 响应头 `x-nextjs-action-not-found: 1`，客户端据此
 * `throw new UnrecognizedActionError('Server Action "<id>" was not found on the server. \nRead more: …')`，
 * 它 `this.name = 'UnrecognizedActionError'`（写死的字符串，压缩后照样在）。tests/stale-deploy.test.ts 拿 Next 自己的类对拍，
 * tests/stale-deploy.ui.test.ts 在浏览器里让动作抛这个类，看框里的话和横幅。
 *
 * 这个文件不带 "use client"：纯函数，服务端组件、单测都能引；碰 window 的几个在服务端调到是空操作。
 */

/** 撞上老版本动作时给人看的那句 */
export const 刷新再提交话 = "系统刚更新了，请刷新页面后再提交";

/** 顶上那条横幅的字 */
export const 有新版本话 = "系统刚更新了，刷新一下再继续（没提交的内容会先存好）";

/** 撞上了老版本动作：点亮顶上那条横幅（UpdateBanner 听） */
export const 旧版本事件 = "crm:stale-build";

/** 横幅上点「刷新」、真刷新之前发一声：开着的录入框趁这时把填的存起来（同步听，听完才 reload） */
export const 刷新前事件 = "crm:before-reload";

/** 同上、同一刻再发一声：记下滚动位置（swap-guard 听） */
export const 记位事件 = "crm:remember-scroll";

/** 认出 Next 客户端在「服务端没有这个动作」时抛的那个错。只认这一种，别的错照原来的话说 */
export function 是旧版本动作错(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const 名 = (e as { name?: unknown }).name;
  if (名 === "UnrecognizedActionError") return true;
  const 话 = (e as { message?: unknown }).message;
  if (typeof 话 !== "string") return false;
  // 名字被包过一层（比如别处 new Error(原 message)）时按原文认；服务端那句（Failed to find Server Action）也认上，万一被透传过来
  return /Server Action "[^"]*" was not found on the server/.test(话) || /Failed to find Server Action/.test(话);
}

/**
 * catch 里换话用：是老版本动作 → 「系统刚更新了，请刷新页面后再提交」（顺手点亮横幅）；不是 → 原来那句。
 * 用法：`catch (e) { 报(动作出错话(e, "没改成，请稍后再试")) }`、`.catch((e) => ({ ok: false, error: 动作出错话(e, "没存上，请稍后再试") }))`
 */
export function 动作出错话(e: unknown, 原来: string): string {
  if (!是旧版本动作错(e)) return 原来;
  报旧版本();
  return 刷新再提交话;
}

/** 点亮横幅（浏览器里才有用） */
export function 报旧版本(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(旧版本事件));
}

/** 横幅上的「刷新」：先让开着的录入框存好，再整页重载 */
export function 存好再刷新(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(刷新前事件));
  // 记滚动位置，reload 后 UpdateBanner 恢复（lib/swap-guard.ts，PR-C）
  window.dispatchEvent(new Event(记位事件));
  window.location.reload();
}

/**
 * 问 /api/version 回来的东西算不算「换了版本」：两边都得是认得出的编号、而且不一样才算。
 * 载入时没有编号（读不到 BUILD_ID）、回来的不是 JSON / 没有 id / id 是空的（重启途中 nginx 给的错页、502）都不算——宁可不提示，也不乱提示
 */
export function 版本变了(载入时: string | null | undefined, 回来的: unknown): boolean {
  if (typeof 载入时 !== "string" || !载入时) return false;
  const id = 回来的 && typeof 回来的 === "object" ? (回来的 as { id?: unknown }).id : undefined;
  return typeof id === "string" && id !== "" && id !== 载入时;
}

/** 两次问之间至少隔多久（切回窗口、切回标签页都会问，来回切不能一直打） */
export const 最短间隔毫秒 = 30_000;
/** 窗口一直开着、没人切走：多久问一次 */
export const 定时毫秒 = 5 * 60_000;

/**
 * 原来写 `e instanceof Error ? e.message : 默认` 的地方：Next 那句英文不能直接给人看，老版本动作换成刷新那句；
 * 自己写的中文 message 照给；英文（生产构建里服务端出错那句、断网的 Failed to fetch…）换成 默认，原文进日志（25C）。
 * 断网 / 超时分开说的完整版见 lib/action-error.ts 给人看的错（那边引这边，这边不反引）
 */
export function 出错原话(e: unknown, 默认: string): string {
  if (是旧版本动作错(e)) return 动作出错话(e, 默认);
  const 话 = e instanceof Error ? e.message.trim() : "";
  const 有编号 = !!e && typeof e === "object" && typeof (e as { digest?: unknown }).digest === "string";
  if (话 && /[\u4e00-\u9fff]/.test(话) && !有编号) return 话;
  if (e) console.error("[出错] 换成中文给人看，原文：", e);
  return 默认;
}
