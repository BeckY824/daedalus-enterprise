/**
 * 浏览器这头往 /api/client-report 报错（批次 28-⑤）。components/ErrorReporter.tsx 装上（只在企业版的应用内页面），
 * (app)/error.tsx、lib/action-error.ts 给人看的错 也从这里报。
 *
 * - 没装（不是企业版、或关了）之前报的先攒着（最多 10 条），装上时一起发；一直没装就一直不发
 * - 同一页面载入内：同样的报错只报一次，最多报 10 条（死循环报错不刷接口）
 * - 只发类别、错误名、原文前 300 字、digest、页面路径（location.pathname，不带查询串）；脱敏、归路由在服务端做
 * - sendBeacon 优先（关页面也发得出去），没有就 fetch keepalive；失败一律静默
 */
import type { 报错类 } from "./fields";

export const 上报地址 = "/api/client-report";
export const 每页上限 = 10;

type 一包 = { k: 报错类; n?: string; m?: string; d?: string };

let 开着 = false;
let 已报 = 0;
const 见过 = new Set<string>();
const 攒着: 一包[] = [];

function 发(包: 一包) {
  try {
    const 体 = JSON.stringify({ ...包, p: typeof location !== "undefined" ? location.pathname : "/" });
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function" && navigator.sendBeacon(上报地址, 体)) return;
    void fetch(上报地址, { method: "POST", body: 体, keepalive: true, credentials: "same-origin", headers: { "Content-Type": "text/plain" } }).catch(() => null);
  } catch {
    /* 报不出去就算了 */
  }
}

/** 报一条。不在浏览器里（服务端渲染、单测）什么都不做 */
export function 报错(k: 报错类, e?: unknown, 名?: string) {
  if (typeof window === "undefined") return;
  const o = (e && typeof e === "object" ? e : {}) as { name?: unknown; message?: unknown; digest?: unknown };
  const m = (typeof e === "string" ? e : typeof o.message === "string" ? o.message : "").slice(0, 300);
  const n = 名 ?? (typeof o.name === "string" ? o.name.slice(0, 60) : undefined);
  const d = typeof o.digest === "string" ? o.digest.slice(0, 40) : undefined;
  const 键 = `${k}|${n ?? ""}|${m}|${d ?? ""}`;
  if (见过.has(键) || 已报 >= 每页上限) return;
  见过.add(键);
  已报++;
  const 包: 一包 = { k, n, m, d };
  if (开着) 发(包);
  else 攒着.push(包);
}

/** ErrorReporter 装上时调：之前攒着的一起发 */
export function 开上报() {
  开着 = true;
  for (const 包 of 攒着.splice(0)) 发(包);
}

/** 测试用 */
export function 重置上报() {
  开着 = false;
  已报 = 0;
  见过.clear();
  攒着.length = 0;
}
