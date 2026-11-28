/**
 * 回避名单根因（E-417 包 1，迁移 194）：给现在在公海里的项目和客户回填 Project / Customer.poolPrevOwnerId。
 *
 *   CRM_ENTERPRISE=1 npx tsx --env-file=.env scripts/pool-prev-owner-backfill.ts --dry
 *   CRM_ENTERPRISE=1 npx tsx --env-file=.env scripts/pool-prev-owner-backfill.ts --apply [--log <文件>]
 *
 * - --dry：只读，打印三张表（总行数 / 按人前 20 + 其余合计 / 按放进公海的北京日期）和「数于（北京时刻）」，库不动。上 c2 先空跑出数报给客户。
 * - --apply：先自动备份（VACUUM INTO 同目录 crm 库的 .bak-pool-prev-owner-<北京时间> 文件，备份不成功就不写），再逐行写；
 *   逐行日志写到 --log（默认当前目录 pool-prev-owner-backfill-<北京时间>.log），一行一条：实体 / id / 动作 / 旧 -> 新 / 来源，不写名字。
 * - 两个都不给报错；可以重复跑：值已经相同的跳过；跑的时候被别人改了的行不覆盖（并发跳过）。
 * - 只写 poolPrevOwnerId 这一列，别的什么都不动。写完用 scripts/pool-prev-owner-compare.ts 对拍。
 * 部署顺序（包 1）：先上代码和迁移（新进公海的开始写列），再备份、再跑这个。规矩和读法在 src/lib/enterprise/pool-prev-owner-backfill.ts。
 */
import fs from "node:fs";
import { defaultClient as db } from "@/lib/prisma";
import { 企业版 } from "@/lib/enterprise/switch";
import { 算回填计划, 写回填, 汇总表, 北京时刻 } from "@/lib/enterprise/pool-prev-owner-backfill";

/** 连着的那个库的真实文件路径（问库自己，不猜 DATABASE_URL 的相对路径） */
async function 库文件(): Promise<string | null> {
  const 行 = await db.$queryRawUnsafe<{ file: string }[]>("SELECT file FROM pragma_database_list WHERE name = 'main'");
  return 行[0]?.file || null;
}

async function main() {
  if (!企业版()) {
    console.error("只给企业版用：先设 CRM_ENTERPRISE=1");
    process.exit(2);
  }
  const 参数 = process.argv.slice(2);
  const 真写 = 参数.includes("--apply");
  const 空跑 = 参数.includes("--dry");
  if (真写 === 空跑) {
    console.error("要且只要一个：--dry（只出数）或 --apply（备份后写）");
    process.exit(2);
  }
  const i = 参数.indexOf("--log");
  const 日志文件 = i >= 0 ? 参数[i + 1] : `pool-prev-owner-backfill-${北京时刻(new Date()).replace(/[: ]/g, "-")}.log`;

  const 计划 = await 算回填计划(db);
  console.log(汇总表(计划));
  if (空跑) {
    console.log("\n演练：库没有动。确认后加 --apply 再跑。");
    return;
  }

  // 真写前自动备份：VACUUM INTO 一份一致的拷贝，写之前先落地
  const 库 = await 库文件();
  const 备份 = `${库 ?? "crm.db"}.bak-pool-prev-owner-${北京时刻(new Date()).replace(/[: ]/g, "-")}-${Date.now() % 100000}`;
  if (!库 || !fs.existsSync(库)) {
    console.error(`找不到库文件，不写。请先手动备份再处理`);
    process.exit(1);
  }
  await db.$executeRawUnsafe(`VACUUM INTO '${备份.replace(/'/g, "''")}'`);
  console.log(`\n已备份：${备份}（${fs.statSync(备份).size} 字节）`);

  const 流 = fs.createWriteStream(日志文件, { flags: "a" });
  流.write(`# 数于（北京时刻）${北京时刻(计划.数于)}；备份 ${备份}\n`);
  const r = await 写回填(db, 计划, (行) => 流.write(`${行}\n`));
  await new Promise((ok) => 流.end(ok));
  console.log(`\n项目：写 ${r.项目.写了}，已相同跳过 ${r.项目.已相同跳过}，无可写 ${r.项目.无可写}，并发跳过 ${r.项目.并发跳过}`);
  console.log(`客户：写 ${r.客户.写了}，已相同跳过 ${r.客户.已相同跳过}，无可写 ${r.客户.无可写}，并发跳过 ${r.客户.并发跳过}`);
  console.log(`逐行日志：${日志文件}`);
}

main().finally(() => db.$disconnect());
