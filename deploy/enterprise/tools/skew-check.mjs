#!/usr/bin/env node
/**
 * 无感更新（11-17）：这次部署能不能把上一版留着接「老标签页的 server action」。
 *
 * 用法（服务器上 ent-install.sh 调，换程序之前）：
 *   node skew-check.mjs <上一版程序目录> <这一版程序目录>
 * 输出几行 key=value（old_id、new_id、verdict、reason），退出码：0 = 可以留（keep），3 = 不留（skip），2 = 用法错。
 *
 * 留上一版的前提：
 *   1. 两版都有部署号（next.config.ts 的 部署号），而且不一样
 *   2. 这次新加 / 改过的迁移（migrations/、control-migrations/ 里按文件名和内容比）只「加」：
 *      建表 / 建虚表 / 建普通索引（都带 IF NOT EXISTS）、加列（不许 NOT NULL 不带 DEFAULT）、
 *      不带 RAISE 的触发器、INSERT、PRAGMA、BEGIN / COMMIT。
 *      其余一律当「会让上一版出错」：DROP、RENAME、UPDATE、DELETE、改表重建（CREATE TABLE 不带 IF NOT EXISTS）、
 *      UNIQUE 索引（上一版写重复值会被拒）、不带 IF NOT EXISTS 的记号索引（107 那种重建）……
 * 只看 SQL。启动时跑的老数据活（instrumentation.ts）、新版写进库里上一版不认的值，这里看不出来：
 * 那类版本部署时设 ENT_SKEW=0（ent-deploy.sh 透传）不留上一版。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

const 迁移目录 = ["migrations", "control-migrations"];

/** 程序目录里构建时记下的部署号；没有回 "" */
export function 读部署号(appDir) {
  const 合法 = (v) => (typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : "");
  try {
    const j = JSON.parse(fs.readFileSync(path.join(appDir, ".next", "required-server-files.json"), "utf8"));
    const v = 合法(j?.config?.deploymentId);
    if (v) return v;
  } catch {
    // 往下看 server.js
  }
  try {
    // standalone 的 server.js 把整份配置烤成 const nextConfig = {...}
    const m = fs.readFileSync(path.join(appDir, "server.js"), "utf8").match(/"deploymentId":"([A-Za-z0-9_-]{1,64})"/);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

/** 去掉 -- 和 /* *\/ 注释（引号里的不动） */
export function 去注释(sql) {
  let out = "";
  let q = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (q) {
      out += c;
      if (c === q) q = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      q = c;
      out += c;
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 1;
      out += " ";
      continue;
    }
    out += c;
  }
  return out;
}

/** 按分号切成语句（引号里的分号不算；CREATE TRIGGER … BEGIN … END 算一句） */
export function 切语句(sql) {
  const s = 去注释(sql);
  const 句 = [];
  let cur = "";
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    cur += c;
    if (q) {
      if (c === q) q = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      q = c;
      continue;
    }
    if (c === ";") {
      const t = cur.trim();
      // 触发器体里的分号：到 END; 才算完
      if (/^CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(t) && !/\bEND\s*;$/i.test(t)) continue;
      if (t !== ";") 句.push(t.replace(/;$/, "").trim());
      cur = "";
    }
  }
  if (cur.trim()) 句.push(cur.trim());
  return 句.filter(Boolean);
}

const 名 = (x) => x.replace(/^["`\[]|["`\]]$/g, "");

/** 这次新加的表和列：{ 表: Set<表名>, 列: Set<"表.列"> }。唯一索引只建在它们上面时上一版碰不到（老代码不写新表、不写新列，空值不算重复） */
export function 新加的(stmts) {
  const 表 = new Set();
  const 列 = new Set();
  for (const stmt of stmts) {
    const t = stmt.replace(/\s+/g, " ").trim();
    const a = t.match(/^CREATE (?:VIRTUAL )?TABLE IF NOT EXISTS (\S+?)\s*[( ]/i);
    if (a) 表.add(名(a[1]));
    const b = t.match(/^ALTER TABLE (\S+) ADD (?:COLUMN )?(\S+)/i);
    if (b) 列.add(`${名(b[1])}.${名(b[2])}`);
  }
  return { 表, 列 };
}

/** 一句 SQL 上一版能不能接着用：回 null = 只加；回字符串 = 不行的原因。新 = 新加的(这次全部语句) */
export function 判一句(stmt, 新 = { 表: new Set(), 列: new Set() }) {
  const t = stmt.replace(/\s+/g, " ").trim();
  const 头 = t.slice(0, 80);
  if (/^(BEGIN|COMMIT|END|PRAGMA|ANALYZE)\b/i.test(t)) return null;
  if (/^CREATE (TEMP |TEMPORARY )?TABLE IF NOT EXISTS\b/i.test(t)) return null;
  if (/^CREATE VIRTUAL TABLE IF NOT EXISTS\b/i.test(t)) return null;
  if (/^CREATE INDEX IF NOT EXISTS\b/i.test(t)) return null;
  const 唯一 = t.match(/^CREATE UNIQUE INDEX IF NOT EXISTS \S+ ON (\S+?)\s*\((.*)\)$/i);
  if (唯一) {
    const 表 = 名(唯一[1]);
    const 列们 = 唯一[2].split(",").map((x) => x.trim());
    const 都是新列 = 列们.every((c) => /^["`\[]?\w+["`\]]?$/.test(c) && 新.列.has(`${表}.${名(c)}`));
    if (新.表.has(表) || 都是新列) return null;
  }
  if (/^CREATE UNIQUE INDEX\b/i.test(t)) return `老表老列上的唯一索引（上一版写重复值会被拒）：${头}`;
  if (/^CREATE (TEMP |TEMPORARY )?TRIGGER IF NOT EXISTS\b/i.test(t)) {
    return /\bRAISE\s*\(/i.test(t) ? `会拦写入的触发器：${头}` : null;
  }
  const 加列 = t.match(/^ALTER TABLE \S+ ADD (COLUMN )?(.*)$/i);
  if (加列) {
    const 定义 = 加列[2];
    if (/\bNOT NULL\b/i.test(定义) && !/\bDEFAULT\b/i.test(定义)) return `加了不许空、没默认值的列：${头}`;
    return null;
  }
  if (/^INSERT\b/i.test(t)) return null;
  const 动词 = (t.match(/^\S+( \S+)?/) || [""])[0].toUpperCase();
  return `${动词}（不是只加）：${头}`;
}

function 哈希(f) {
  return crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
}

/** 这一版比上一版新加 / 改过的迁移文件（相对路径） */
export function 新迁移(oldApp, newApp) {
  const 新 = [];
  for (const d of 迁移目录) {
    const nd = path.join(newApp, d);
    if (!fs.existsSync(nd)) continue;
    for (const f of fs.readdirSync(nd).filter((x) => x.endsWith(".sql")).sort()) {
      const of = path.join(oldApp, d, f);
      if (!fs.existsSync(of) || 哈希(of) !== 哈希(path.join(nd, f))) 新.push(path.join(d, f));
    }
  }
  return 新;
}

/** 总判断：{ oldId, newId, keep, reasons, files } */
export function 判断(oldApp, newApp) {
  const oldId = 读部署号(oldApp);
  const newId = 读部署号(newApp);
  const reasons = [];
  if (!oldId) reasons.push("上一版没有部署号（无感更新之前的构建，它的页面不带 x-deployment-id）");
  if (!newId) reasons.push("这一版没有部署号");
  if (oldId && newId && oldId === newId) reasons.push(`两版部署号一样（${newId}）：同一份代码，不用留`);
  if (!fs.existsSync(path.join(oldApp, "server.js"))) reasons.push(`上一版目录里没有 server.js：${oldApp}`);
  const files = 新迁移(oldApp, newApp);
  const 每份 = files.map((f) => [f, 切语句(fs.readFileSync(path.join(newApp, f), "utf8"))]);
  const 新 = 新加的(每份.flatMap(([, ss]) => ss));
  for (const [f, ss] of 每份) {
    for (const s of ss) {
      const why = 判一句(s, 新);
      if (why) reasons.push(`${f}：${why}`);
    }
  }
  return { oldId, newId, keep: reasons.length === 0, reasons, files };
}

function main(argv) {
  const [oldApp, newApp] = argv;
  if (!oldApp || !newApp) {
    console.error("用法：node skew-check.mjs <上一版程序目录> <这一版程序目录>");
    return 2;
  }
  const r = 判断(oldApp, newApp);
  console.log(`old_id=${r.oldId}`);
  console.log(`new_id=${r.newId}`);
  console.log(`new_migrations=${r.files.join(",")}`);
  console.log(`verdict=${r.keep ? "keep" : "skip"}`);
  for (const why of r.reasons) console.log(`reason=${why}`);
  return r.keep ? 0 : 3;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main(process.argv.slice(2)));
