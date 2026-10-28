/**
 * 企业版主流程 E2E（playwright.enterprise.config.ts）的建库：每轮从空库开始，照企业版的样子造一套人和数据。
 *
 *   老板 admin（seed 建，企业版 seed 只建这一个）、销售经理、两个销售（内贸、汇报给经理）、市场经理
 *   设置：项目模式开、组织规则四条开（数据范围 / 线索分配 / 字段权限 / 交接确认）
 *   公海：客户放进客户公海；名下项目一在项目公海里、项目二不在（领项目时客户和项目二一起跟过来）
 *
 * 和主配置一样由 webServer 命令在起服务之前跑（企业版服务器一启动就连库，见 e2e/global-setup.ts 文件头），不走 globalSetup。
 * 密码每轮随机，只写进 prisma/e2e-ent/seed.json（不进仓库），spec 从那里读——测试密码不进代码。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma";

const ROOT = path.resolve(__dirname, "..");
export const ENT_DIR = path.resolve(ROOT, "prisma/e2e-ent");
export const ENT_DB = path.join(ENT_DIR, "e2e-ent.db");
export const SEED_JSON = path.join(ENT_DIR, "seed.json");

/** 登录名（企业版用户名就存在 email 字段里，同 seed 的 admin） */
export const 账号 = { 老板: "admin", 经理: "ent-mgr", 销售1: "ent-sales1", 销售2: "ent-sales2", 市场: "ent-mkt" } as const;

export type 种子 = { 密码: string; 客户: string; 自己客户: string; 项目1: string; 项目2: string; 名字: Record<keyof typeof 账号, string> };

export function 读种子(): 种子 {
  return JSON.parse(readFileSync(SEED_JSON, "utf8")) as 种子;
}

export default async function setup() {
  rmSync(ENT_DIR, { recursive: true, force: true });
  mkdirSync(ENT_DIR, { recursive: true });
  writeFileSync(ENT_DB, "");

  const 密码 = randomBytes(9).toString("base64url");
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: `file:${ENT_DB}`, CRM_ENTERPRISE: "1", INIT_PASSWORD: 密码 };
  execFileSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], { cwd: ROOT, env, stdio: "pipe" });
  execFileSync("npx", ["tsx", "prisma/seed.ts"], { cwd: ROOT, env, stdio: "pipe" });

  const db = new PrismaClient({ datasources: { db: { url: `file:${ENT_DB}` } } });
  try {
    writeFileSync(SEED_JSON, JSON.stringify(await 灌数据(db, 密码), null, 2));
  } finally {
    await db.$disconnect();
  }
}

async function 灌数据(db: PrismaClient, 密码: string): Promise<种子> {
  const hash = await bcrypt.hash(密码, 10);
  const 名字 = { 老板: "管理员", 经理: "销售经理甲", 销售1: "销售甲", 销售2: "销售乙", 市场: "市场经理甲" };
  const 建 = (k: "经理" | "销售1" | "销售2" | "市场", role: string) =>
    db.user.create({ data: { email: 账号[k], name: 名字[k], title: k === "市场" ? "市场" : "销售", role, password: hash } });
  const 经理 = await 建("经理", "MANAGER");
  const 销售1 = await 建("销售1", "SALES");
  const 销售2 = await 建("销售2", "SALES");
  const 市场 = await 建("市场", "SALES");

  const 部门 = await db.entDept.create({ data: { name: "销售一部" } });
  await db.entMember.createMany({
    data: [
      { userId: 经理.id, deptId: 部门.id, bizRole: "sales_mgr", line: "内贸" },
      { userId: 销售1.id, deptId: 部门.id, bizRole: "sales", line: "内贸", managerId: 经理.id },
      { userId: 销售2.id, deptId: 部门.id, bizRole: "sales", line: "内贸", managerId: 经理.id },
      { userId: 市场.id, deptId: 部门.id, bizRole: "marketing_mgr" },
    ],
  });

  // Setting.value 是 JSON 串；business 只写开关，getBusiness 会补默认值（src/lib/business.ts）
  await db.setting.createMany({
    data: [
      { key: "business", value: JSON.stringify({ projectMode: true }) },
      ...["org_scope", "lead_assign", "field_perm", "handover_confirm"].map((k) => ({ key: `enterprise.rule.${k}`, value: "true" })),
    ],
  });

  const 客户 = await db.customer.create({ data: { name: "公海客户甲", phone: "13900000001", salesOwnerId: 销售1.id } });
  await db.customerPool.create({ data: { customerId: 客户.id, userId: 销售1.id } });
  const 项目1 = await db.project.create({
    data: { name: "公海项目一", customerId: 客户.id, ownerId: 销售1.id, creatorId: 销售1.id, pooledAt: new Date() },
  });
  const 项目2 = await db.project.create({ data: { name: "同客户项目二", customerId: 客户.id, ownerId: 销售1.id, creatorId: 销售1.id } });
  // 字段权限那条用：销售甲自己名下、不在公海的客户
  const 自己客户 = await db.customer.create({ data: { name: "销售甲的客户", phone: "13900000002", remark: "原备注", salesOwnerId: 销售1.id } });
  // 线索分配那两条用（企业版「新线索」= 线索阶段的项目）：市场建的一条等分配，销售甲自己的一条（他看得到这一行，但没有「分配」）
  const 市场客户 = await db.customer.create({ data: { name: "市场的客户", phone: "13900000003", salesOwnerId: 市场.id } });
  await db.project.create({ data: { name: "线索甲", customerId: 市场客户.id, ownerId: 市场.id, creatorId: 市场.id } });
  await db.project.create({ data: { name: "线索乙", customerId: 自己客户.id, ownerId: 销售1.id, creatorId: 销售1.id } });
  return { 密码, 客户: 客户.id, 自己客户: 自己客户.id, 项目1: 项目1.id, 项目2: 项目2.id, 名字 };
}

if (require.main === module) void setup();
