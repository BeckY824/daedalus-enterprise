/*
  antd 服务端样式改成外链（11-15 列表页瘦身）：原来每个整页 HTML 内联两段 <style id="antd-cssinjs">，
  客户列表一页 610 KB 里有 418 KB 是它，公海、项目、跟进记录都一样（实测）。同一类页面每次吐出来的这两段逐字相同
  （components/AntdRegistry.tsx：单主题，同一组 key 算出来的样式不变），所以：
    服务端把这一批样式的正文算一个号（按正文算，正文不同号就不同，浏览器按号缓存一年也不会拿错），正文存在进程里、另落一份盘
    （lib/antd-css-disk.ts，重启 / 部署后旧页面引用的号照样取得到）；
    页面里只放 <link rel="stylesheet" href="/api/antd-css/<号>">；
    「这一批有哪些 key、什么先后」另记一个签名 → 号：同一签名第二次出现时连 extractStyle 都不跑（不再拼 400 KB 字符串）。
  浏览器端照旧：cssinjs 原来就把服务端那段当「来自 CSS 文件」的样式（plain 模式没有带标记的 <style>，见 cacheMapUtil.prepare），
  外链后读法一样（读 .data-ant-cssinjs-cache-path 的 content）。

  正文放 globalThis：页面（SSR 那一层）和 /api/antd-css 路由是两份打包，模块各一份，进程只有一个。
  不 import node 模块：这个文件会跟着 AntdRegistry 进浏览器包（浏览器端用不到）；落盘那一步由 instrumentation.ts 启动时
  装到 globalThis 上（装样式落盘），这里只调。
*/

type 店 = { 正文: Map<string, string>; 签名: Map<string, string> };
type 落盘钩子 = { 写: (号: string, 正文: string) => void };
const 全局 = globalThis as typeof globalThis & { __crmAntdCss?: 店; __crmAntdCssDisk?: 落盘钩子 };

/** 最多记多少批：一批 200 KB 上下，按页面种类 × 角色 × 两批算，平时几十批；超了丢最早的（盘上还有） */
export const 记多少批 = 96;

function 店(): 店 {
  return (全局.__crmAntdCss ??= { 正文: new Map(), 签名: new Map() });
}

/** 53 位字符串散列（cyrb53） */
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
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, "0");
}

/** 签名的号：只在进程里对上「同一批 key」，不出进程 */
export function 签名号(签名: string): string {
  return `${散列(签名, 1)}${散列(签名, 7)}${签名.length.toString(36)}`;
}

/**
 * 正文的号：四个种子的 cyrb53 拼起来（约 210 位）再拼长度。只认正文：同一正文永远同一个号，
 * 正文变了（升级 antd、改主题）号就变，浏览器长期缓存不会拿到旧样式。不做安全用途
 */
export function 正文号(正文: string): string {
  return `${散列(正文, 1)}${散列(正文, 7)}${散列(正文, 13)}${散列(正文, 29)}${正文.length.toString(36)}`;
}

/** 号长这样才认（路由、读盘那头先挡掉乱写的，杜绝路径穿越） */
export const 号的样子 = /^[0-9a-z]{6,64}$/;

/** 号 → 正文（只看进程里）；没有 = undefined，路由再去盘上找 */
export function 取样式(号: string): string | undefined {
  return 店().正文.get(号);
}

/** 同一批 key 记过没有：记过回号（这一批没样式 = ""），没记过 = undefined */
export function 查签名(签: string): string | undefined {
  return 店().签名.get(签);
}

function 有限记(m: Map<string, string>, k: string, v: string) {
  if (m.has(k)) return;
  if (m.size >= 记多少批) m.delete(m.keys().next().value!);
  m.set(k, v);
}

/** 进程里记一份正文（路由从盘上读回来的也记进来，下回不再读盘） */
export function 存正文(号: string, 正文: string): void {
  有限记(店().正文, 号, 正文);
}

/**
 * 这一批 key（签名）抽出来的正文：算号、进程里记一份、落盘一份（装了钩子才落，单测、构建期没装）；
 * 正文为空（这一批没样式）记成 ""、返回 ""
 */
export function 记样式(签: string, 正文: string): string {
  if (!正文) {
    有限记(店().签名, 签, "");
    return "";
  }
  const 号 = 正文号(正文);
  存正文(号, 正文);
  有限记(店().签名, 签, 号);
  try {
    全局.__crmAntdCssDisk?.写(号, 正文);
  } catch {
    // 落盘失败不挡页面：进程里有，这次照样能取；只是重启后旧页面取不到
  }
  return 号;
}

/** instrumentation.ts 启动时装上落盘（lib/antd-css-disk.ts） */
export function 装落盘(钩子: 落盘钩子): void {
  全局.__crmAntdCssDisk = 钩子;
}
