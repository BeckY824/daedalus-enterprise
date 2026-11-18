/**
 * 企业版运行记录（批次 28-⑤）：页面报错、慢请求记到服务器本地文件，每天一份摘要（scripts/telemetry-daily.mjs）。
 * 起因：员工先报了「浏览器 86 内核被挡在旧浏览器提示上」「渠道页偏慢」——这两件服务器本该自己先看到。
 *
 * 这一份是纯函数（不碰文件、不碰库）：浏览器、服务端、单测（tests/telemetry.test.ts）都能引。管「记哪些字段、怎么脱敏」：
 *
 * 只记：时刻、路由模式（不带 id、不带查询串）、错误类别 + 错误名 + 脱敏后的报错首行（≤200 字）、Next 的 digest、
 *       浏览器名 + 主版本、系统大类、内置浏览器壳（飞书 / 企业微信 / 360…）、耗时、状态码、业务角色、当天的人员短号。
 * 不记：用户名、用户 id、客户名、电话、邮箱、表单内容、请求体、cookie、完整 URL、查询串、IP。
 *
 * 报错文本可能夹带客户数据（校验报错拼了客户名、电话），脱敏规则见 脱敏报错：
 * - 只取第一行；网址、邮箱、5 位以上的数字串（电话、编号）、20 位以上的字母数字串（id、令牌）换成占位
 * - 引号里的内容换成「…」，只留像代码标识符的（`reading 'name'` 里的 name）
 * - **带中文的整句不记原文**：中文报错是我们自己写给人看的话，最可能拼了客户名，只记「中文提示」和一个指纹（同一句话同一个指纹，能数次数）
 */

export const 报错类们 = {
  /** window error：脚本里没人接住的错 */
  error: "未捕获错误",
  /** unhandledrejection，不是动作这一层的 */
  rejection: "未捕获Promise",
  /** (app)/error.tsx：React 错误边界接住、整页换成「这一页没能打开」 */
  boundary: "错误边界",
  /** 服务器动作失败（lib/action-error.ts 认得出的：旧版本 / 网络 / 超时 / 服务端） */
  action: "动作失败",
  /** lib/old-browser.ts 的整页提示被显示 */
  old: "旧浏览器",
} as const;
export type 报错类 = keyof typeof 报错类们;

/** 落盘的一行。键用短英文：一天几千行，省地方；摘要脚本认这些键 */
export type 一行 = {
  t: string;
  /** err = 报错，slow = 慢请求 */
  k: "err" | "slow";
  /** browser = 浏览器报上来的，server = 服务端自己记的 */
  src: "browser" | "server";
  route: string;
  role: string;
  /** 当天的人员短号（见 lib/telemetry/who.ts）：同一天同一人相同、隔天就变、不可逆 */
  u?: string;
  br?: string;
  os?: string;
  shell?: string;
  /** 报错：类别（报错类们的值，或服务端的「服务端出错」） */
  type?: string;
  /** 报错：错误名（TypeError…）；动作失败时是 旧版本 / 网络 / 超时 / 服务端 */
  name?: string;
  msg?: string;
  digest?: string;
  /** 慢请求：HTML / RSC / RSC预取 / ACTION / API；服务端报错：render / route / action / proxy */
  kind?: string;
  ms?: number;
  status?: number;
};

/* ---------------- 浏览器 ---------------- */

export type 浏览器 = { br: string; os: string; shell?: string };

/** 内置浏览器壳：认出来就记一个名字（不是个人信息，排查「86 内核」这类问题要它） */
const 壳们: [RegExp, string][] = [
  [/\b(?:Lark|Feishu)\//i, "飞书"],
  [/\bwxwork\//i, "企业微信"],
  [/\bMicroMessenger\//i, "微信"],
  [/\bDingTalk\//i, "钉钉"],
  [/\bQQBrowser\//i, "QQ浏览器"],
  [/\b360(?:SE|EE)\b|\bQIHU\b/i, "360"],
  [/\bMetaSr\b|\bSogouMobileBrowser\//i, "搜狗"],
  [/\bUB?rowser\/|\bUCBrowser\//i, "UC"],
  [/\b2345Explorer\//i, "2345"],
  [/\bLBBROWSER\b/i, "猎豹"],
];

/**
 * UA → 浏览器名 + 主版本、系统大类、壳。UA 截到 512 字再认（防超长串拖慢正则）。
 * Safari 多留一位小版本：旧浏览器提示的线就画在 Safari 16.4，只记 16 分不出挡没挡
 */
export function 认浏览器(uaIn: unknown): 浏览器 {
  const ua = typeof uaIn === "string" ? uaIn.slice(0, 512) : "";
  let br = "其他";
  let m: RegExpMatchArray | null;
  if ((m = ua.match(/\bEdg(?:e|A|iOS)?\/(\d+)/))) br = `Edge ${m[1]}`;
  else if ((m = ua.match(/\bOPR\/(\d+)/))) br = `Opera ${m[1]}`;
  else if ((m = ua.match(/\b(?:Firefox|FxiOS)\/(\d+)/))) br = `Firefox ${m[1]}`;
  else if ((m = ua.match(/\bCriOS\/(\d+)/))) br = `Chrome iOS ${m[1]}`;
  else if ((m = ua.match(/\bChrom(?:e|ium)\/(\d+)/))) br = `Chrome ${m[1]}`;
  else if ((m = ua.match(/\bVersion\/(\d+)(?:\.(\d+))?[\s\S]*\bSafari\//))) br = `Safari ${m[1]}${m[2] ? `.${m[2]}` : ""}`;
  else if (/\bAppleWebKit\//.test(ua) && /\b(?:iPhone|iPad|Macintosh)\b/.test(ua)) br = "WebKit";
  let os = "其他";
  if ((m = ua.match(/\bWindows NT (\d+)\.(\d+)/))) {
    const v = `${m[1]}.${m[2]}`;
    os = v === "10.0" ? "Windows 10+" : v === "6.1" ? "Windows 7" : v === "6.2" || v === "6.3" ? "Windows 8" : "Windows 旧";
  } else if (/\bWindows\b/.test(ua)) os = "Windows";
  else if (/\b(?:iPhone|iPad|iPod)\b/.test(ua)) os = "iOS";
  else if (/\bAndroid\b/.test(ua)) os = "Android";
  else if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) os = "macOS";
  else if (/\bCrOS\b/.test(ua)) os = "ChromeOS";
  else if (/\bLinux\b/.test(ua)) os = "Linux";
  const 壳 = 壳们.find(([re]) => re.test(ua));
  return 壳 ? { br, os, shell: 壳[1] } : { br, os };
}

/* ---------------- 报错文本 ---------------- */

export const 首行上限 = 200;
const 含中文 = /[㐀-鿿豈-﫿]/;
/** 像 JS 标识符 / 属性路径的，引号里留着（`reading 'name'`）；首字母大写的不留（多半是人名、公司名） */
const 像标识符 = /^[a-z_$][\w$.]{0,40}$/;

/** 短指纹（FNV-1a 32 位）：中文提示不记原文，同一句话同一个指纹，能数次数。不是密码学哈希，只为分组 */
export function 指纹(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** 报错原文 → 能落盘的一行（规则见文件头）。空的回 "" */
export function 脱敏报错(原: unknown): string {
  if (typeof 原 !== "string" || !原) return "";
  // 只取第一行，控制字符去掉
  let s = 原.slice(0, 2000).split(/\r?\n/)[0].replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!s) return "";
  s = s
    .replace(/\b(?:https?|wss?|file|blob|ftp):\/\/[^\s"'`<>]*/gi, "[url]")
    .replace(/\bdata:[\w/+.-]+[;,][^\s"'`]*/gi, "[data]")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]")
    // 引号里的内容（中英文各种引号）：像标识符的留，其余换成 …
    .replace(/(["'`“‘「『《])([^"'`”’」』》]{0,300})(["'`”’」』》])/g, (_, a: string, 里: string, b: string) => (像标识符.test(里) ? `${a}${里}${b}` : `${a}…${b}`))
    // 电话、编号：5 位以上数字（中间可夹空格、横线、括号、点）
    .replace(/\+?\d[\d\s().-]{3,}\d/g, (x) => ((x.match(/\d/g)?.length ?? 0) >= 5 ? "#" : x))
    // id、令牌、哈希
    .replace(/\b[A-Za-z0-9_-]{20,}\b/g, "[id]");
  if (含中文.test(s)) return `中文提示#${指纹(s)}`;
  return s.length > 首行上限 ? `${s.slice(0, 首行上限 - 1)}…` : s;
}

/** 错误名：像 TypeError、ChunkLoadError 的才留，别的一律 Error */
export function 错误名(x: unknown): string {
  return typeof x === "string" && /^[A-Za-z][\w.]{0,40}$/.test(x) ? x : "Error";
}

/** Next 的 digest：数字或短串，留着能和服务端日志对上 */
export function 认digest(x: unknown): string | undefined {
  return typeof x === "string" && /^[\w-]{1,40}$/.test(x) ? x : undefined;
}

/** 动作失败的那几类（lib/action-error.ts 认动作错） */
const 动作类们 = new Set(["旧版本", "网络", "超时", "服务端"]);
/** 旧浏览器脚本报的哪几项特性没过：lb 后行断言、fl findLast、sc structuredClone */
const 特性们 = new Set(["lb", "fl", "sc"]);

/** 浏览器报上来的、规整后留下的（还没有角色、浏览器、路由模式；那几样服务端自己填） */
export type 上报 = { 类: 报错类; name: string; msg: string; digest?: string; path: string };

/**
 * 浏览器 POST 来的那一包 → 规整后的上报；认不出、缺东西回 null。
 * 包里只认这几个键：k 类别、n 错误名、m 原文、d digest、p 页面路径、f 旧浏览器特性。别的一律丢掉（表单、cookie 带进来也不落）
 */
export function 规整上报(j: unknown): 上报 | null {
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const o = j as Record<string, unknown>;
  const k = o.k;
  if (typeof k !== "string" || !Object.prototype.hasOwnProperty.call(报错类们, k)) return null;
  const 类 = k as 报错类;
  const path = typeof o.p === "string" && o.p.startsWith("/") ? o.p.slice(0, 300) : "/";
  if (类 === "old") {
    const f = typeof o.f === "string" ? o.f.split(",").filter((x) => 特性们.has(x)).join(",") : "";
    return { 类, name: "旧浏览器", msg: f ? `缺 ${f}` : "", path };
  }
  if (类 === "action") {
    const n = typeof o.n === "string" && 动作类们.has(o.n) ? o.n : "服务端";
    return { 类, name: n, msg: 脱敏报错(o.m), digest: 认digest(o.d), path };
  }
  return { 类, name: 错误名(o.n), msg: 脱敏报错(o.m), digest: 认digest(o.d), path };
}

/** 路由模式里粗归一的占位 [x]（lib/request-log.ts 没有路由表时用）统一叫 [id] */
export const 统一占位 = (route: string) => route.replace(/\[x\]/g, "[id]");
