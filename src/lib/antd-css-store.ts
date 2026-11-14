/*
  antd 服务端样式改成外链（11-15 列表页瘦身）：原来每个整页 HTML 内联两段 <style id="antd-cssinjs">，
  客户列表一页 610 KB 里有 418 KB 是它，公海、项目、跟进记录都一样（实测）。同一类页面每次吐出来的这两段逐字相同
  （components/AntdRegistry.tsx：单主题，同一组 key 算出来的样式不变），所以：
    服务端把这一批样式按「这一批有哪些 key、什么先后」记一个号，正文存在进程里；
    页面里只放 <link rel="stylesheet" href="/api/antd-css/<号>">，浏览器按号长期缓存，第二次打开不再下这 400 KB；
    同一个号第二次出现时连 extractStyle 都不跑（不再拼 400 KB 字符串）。
  浏览器端照旧：cssinjs 原来就把服务端那段当「来自 CSS 文件」的样式（plain 模式没有带标记的 <style>，见 cacheMapUtil.prepare），
  外链后读法一样（读 .data-ant-cssinjs-cache-path 的 content）。

  正文放 globalThis：页面（SSR 那一层）和 /api/antd-css 路由是两份打包，模块各一份，进程只有一个。
  不 import node 模块：这个文件会跟着 AntdRegistry 进浏览器包（浏览器端用不到）。
*/

type 店 = { 正文: Map<string, string> };
const 全局 = globalThis as typeof globalThis & { __crmAntdCss?: 店 };

/** 最多记多少批：一批 200 KB 上下，按页面种类 × 角色 × 两批算，平时几十批；超了丢最早的 */
export const 记多少批 = 96;

function 店(): 店 {
  return (全局.__crmAntdCss ??= { 正文: new Map() });
}

/** 53 位字符串散列（cyrb53），两个种子拼成号；号只用来对上同一批 key，不做安全用途 */
function 散列(s: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function 样式号(签名: string): string {
  return `${散列(签名, 1)}${散列(签名, 7)}${签名.length.toString(36)}`;
}

/** 号 → 正文；没记过 = undefined（进程重启前发出去的页面才会碰到） */
export function 取样式(号: string): string | undefined {
  return 店().正文.get(号);
}

export function 记样式(号: string, 正文: string): void {
  const m = 店().正文;
  if (m.has(号)) return;
  if (m.size >= 记多少批) m.delete(m.keys().next().value!);
  m.set(号, 正文);
}

/** 号长这样才认（路由那头先挡掉乱写的） */
export const 号的样子 = /^[0-9a-z]{6,40}$/;
