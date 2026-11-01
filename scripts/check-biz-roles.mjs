/**
 * 企业版部署前核对：权限只认业务角色（2026-11-01）之后，库里的人都设好业务角色了没有。**只读**，库一个字都不改。
 *
 *   node --no-warnings scripts/check-biz-roles.mjs <crm.db>
 *
 * 11-01 起「兜底不留，没设业务角色就没权限」：在职账号没有组织那一行、或角色串空着 / 全是不认识的，上线后什么都看不到、做不了。
 * 所以部署这一版之前先跑这个，有一条不过就停下来，先在设置 → 组织架构里补好再部署：
 *   1. 每个在职账号都有业务角色（列出没设的：姓名、邮箱、账号角色）
 *   2. 至少一位总管理（director）；再看有几位能管设置（没勾「不管设置」）——一位都没有时设置页没人能进
 * 另外只打印、不判过不过：哪几位总管理勾了「不管设置」、规则「按组织看客户」开着还是关着。
 * 不过 = 退出码 1；用法错 = 2；全过 = 0。
 * 只用 node 自带的 node:sqlite（只读打开），服务器上不用装别的：scp 这一个文件过去跑，跑完删掉。
 * 认的业务角色和 src/lib/sync/dept-policy.ts 的 业务角色 是同一份（tests/ent-check-biz-roles.test.ts 钉着）。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

export const 认的角色 = ["director", "admin", "sales_mgr", "sales", "channel_ops", "marketing_mgr", "project_ops"];
export const 按组织看客户key = "enterprise.rule.org_scope";

/** 角色串（逗号分隔）里认得的角色；同 org-core.ts 拆角色 */
export const 拆角色 = (s) => {
  const 有 = new Set(String(s ?? "").split(",").map((x) => x.trim()));
  return 认的角色.filter((r) => 有.has(r));
};

/**
 * 纯算：在职账号 + 组织行 → 核对结果。
 * @param {{ id: string; name: string; email: string; role: string; active: number | boolean }[]} users
 * @param {{ userId: string; bizRole: string | null; noSettings?: number | boolean | null }[]} members
 */
export function 核对(users, members) {
  const 行 = new Map(members.map((m) => [m.userId, m]));
  const 在职 = users.filter((u) => Boolean(u.active));
  const 没角色 = 在职.filter((u) => 拆角色(行.get(u.id)?.bizRole).length === 0);
  const 总管理 = 在职.filter((u) => 拆角色(行.get(u.id)?.bizRole).includes("director"));
  const 不管设置的总管理 = 总管理.filter((u) => Boolean(行.get(u.id)?.noSettings));
  const 能管设置的总管理 = 总管理.filter((u) => !行.get(u.id)?.noSettings);
  const 问题 = [];
  if (没角色.length) 问题.push(`${没角色.length} 个在职账号没设业务角色：上线后什么都看不到、做不了`);
  if (!总管理.length) 问题.push("一位总管理（director）都没有：没人能删除、管回收站、改组织架构");
  else if (!能管设置的总管理.length) 问题.push("总管理都勾了「不管设置」：设置页没人能改");
  return { 在职数: 在职.length, 没角色, 总管理, 不管设置的总管理, 问题, 过: 问题.length === 0 };
}

const 人 = (u) => `${u.name}（${u.email}，账号角色 ${u.role}）`;

/** 打印用 */
export function 报告(r, 规则开着) {
  const 行们 = [
    `在职账号 ${r.在职数} 个`,
    `没设业务角色：${r.没角色.length ? "\n  - " + r.没角色.map(人).join("\n  - ") : "没有"}`,
    `总管理：${r.总管理.length ? r.总管理.map((u) => u.name).join("、") : "没有"}`,
    `勾了「不管设置」的总管理：${r.不管设置的总管理.length ? r.不管设置的总管理.map((u) => u.name).join("、") : "没有"}`,
    `规则「按组织看客户」：${规则开着 === null ? "没拨过（= 关）" : 规则开着 ? "开" : "关"}`,
    r.过 ? "结论：过，可以部署" : `结论：不过，先补好再部署——\n  - ${r.问题.join("\n  - ")}`,
  ];
  return 行们.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const 库 = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!库) {
    console.error("用法：node --no-warnings scripts/check-biz-roles.mjs <crm.db>");
    process.exit(2);
  }
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(库, { readOnly: true });
  try {
    // 迁移 108 之前的库没有 noSettings 这一列：当没勾
    const 有列 = db.prepare(`PRAGMA table_info("EntMember")`).all().some((c) => c.name === "noSettings");
    const users = db.prepare(`SELECT id, name, email, role, active FROM "User"`).all();
    const members = db.prepare(`SELECT userId, bizRole${有列 ? ", noSettings" : ""} FROM "EntMember"`).all();
    const 设置 = db.prepare(`SELECT value FROM "Setting" WHERE key = ?`).get(按组织看客户key);
    const r = 核对(users, members);
    console.log(报告(r, 设置 ? JSON.parse(String(设置.value)) === true : null));
    process.exitCode = r.过 ? 0 : 1;
  } finally {
    db.close();
  }
}
