#!/usr/bin/env node
/**
 * 客户页流式首屏量时（11-26，perf/ent-customers-parallel）：整页打开 /customers 的几组查询，读响应流记三个时刻——
 *   首字节      发请求到第一块到（服务端壳 / layout 开始吐）
 *   骨架        流里第一次出现 data-testid="page-skeleton"（Suspense 兜底那块骨架，SlotSkeleton）；没出现记「—」
 *   最后一块    流读完（页面数据全到、HTML 收尾）
 * 各组跑 --runs 次（默认 5，另先热身 1 次不算）取中位数，输出一张 Markdown 表（--json 时多打一份 JSON）。
 * 只发 GET、不写库；不进生产代码路径。
 *
 *   node scripts/perf/customers-stream.mjs --base http://127.0.0.1:3703 --cookie 'crm_session=…' [--runs 5] [--json]
 *     [--query '/customers' --query '/customers?keyword=1' …]   不给 = 下面 默认组 那几组
 *
 * 「看板 / 列表」不是地址参数：记在 cookie customers-view（lib/customers-view-pref.ts）。查询里写 view=board / view=list，
 * 脚本把它从地址里拿掉、改成 customers-view=board|list 带进 Cookie（不写 = 不带，服务端按「没记」= 列表）。
 * 两字中文关键词默认用「客户」（编造的通用词，不放真实名字）；要换用 --query '/customers?keyword=<词>'。
 */
import process from "node:process";

const 参 = process.argv.slice(2);
const 取 = (k) => { const i = 参.indexOf(k); return i >= 0 ? 参[i + 1] : undefined; };
const 全取 = (k) => 参.flatMap((v, i) => (v === k && 参[i + 1] ? [参[i + 1]] : []));
const base = (取("--base") ?? "").replace(/\/$/, "");
const cookie = 取("--cookie") ?? process.env.CRM_COOKIE ?? "";
const runs = Math.max(1, Number(取("--runs") ?? 5) || 5);
if (!base) {
  console.error("用法：node scripts/perf/customers-stream.mjs --base <http://主机:端口> --cookie '<会话 cookie>' [--runs 5] [--query <路径>]… [--json]");
  process.exit(2);
}

const 默认组 = [
  "/customers",
  "/customers?view=list&keyword=1",
  "/customers?view=list&keyword=客户",
  "/customers?view=list&keyword=没有这个人zz",
  "/customers?view=board",
  "/customers?view=board&keyword=1",
  "/customers?view=board&keyword=客户",
];
const 组 = 全取("--query").length ? 全取("--query") : 默认组;
const 骨架标 = Buffer.from('data-testid="page-skeleton"');

/** 地址里的 view= 换成 cookie；返回真正请求的地址和 Cookie 头 */
function 拆(q) {
  const u = new URL(q, base);
  const view = u.searchParams.get("view");
  u.searchParams.delete("view");
  const 带 = view === "board" || view === "list" ? `customers-view=${view}` : "";
  // 原 cookie 里要是已有 customers-view，以这一组的为准
  const 原 = cookie.split(/;\s*/).filter((x) => x && !(带 && x.startsWith("customers-view=")));
  return { url: u.toString(), cookie: [...原, 带].filter(Boolean).join("; ") };
}

async function 一次(url, ck) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { cookie: ck, accept: "text/html" }, redirect: "manual" });
  if (res.status !== 200) throw new Error(`${url} 回 ${res.status}${res.headers.get("location") ? ` → ${res.headers.get("location")}` : ""}（cookie 过期了？）`);
  const reader = res.body.getReader();
  let 首字节 = null, 骨架 = null, 尾 = Buffer.alloc(0), 字节 = 0;
  for (;;) {
    const { done, value } = await reader.read();
    const t = performance.now() - t0;
    if (done) return { 首字节, 骨架, 最后: t, 字节 };
    if (首字节 === null) 首字节 = t;
    字节 += value.length;
    if (骨架 === null) {
      // 标记可能跨两块：带上一块的尾巴一起找
      const 块 = Buffer.concat([尾, Buffer.from(value)]);
      if (块.includes(骨架标)) 骨架 = t;
      尾 = 块.subarray(Math.max(0, 块.length - 骨架标.length));
    }
  }
}

const 中位 = (xs) => {
  const v = xs.filter((x) => x !== null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const 毫秒 = (x) => (x === null ? "—" : `${Math.round(x)}`);

const 结果 = [];
for (const q of 组) {
  const { url, cookie: ck } = 拆(q);
  await 一次(url, ck); // 热身
  const 次 = [];
  for (let i = 0; i < runs; i++) 次.push(await 一次(url, ck));
  结果.push({
    查询: q,
    首字节: 中位(次.map((x) => x.首字节)),
    骨架: 中位(次.map((x) => x.骨架)),
    骨架出现: 次.filter((x) => x.骨架 !== null).length,
    最后: 中位(次.map((x) => x.最后)),
    最后们: 次.map((x) => Math.round(x.最后)),
    字节: 中位(次.map((x) => x.字节)),
  });
  process.stderr.write(`· ${q} 完\n`);
}

console.log(`\n${base}　每组 ${runs} 次中位数（ms），另热身 1 次不算\n`);
console.log("| 查询 | 首字节 | 骨架 | 最后一块 | 各次最后一块 | 骨架出现 |");
console.log("|---|---:|---:|---:|---|---:|");
for (const r of 结果) console.log(`| \`${r.查询}\` | ${毫秒(r.首字节)} | ${毫秒(r.骨架)} | ${毫秒(r.最后)} | ${r.最后们.join(" / ")} | ${r.骨架出现}/${runs} |`);
if (参.includes("--json")) console.log(`\n${JSON.stringify({ base, runs, 结果 }, null, 2)}`);
