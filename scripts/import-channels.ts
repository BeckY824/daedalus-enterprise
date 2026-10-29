/**
 * 企业版渠道批量导入（2026-10-29）：把一张渠道表（xlsx 或 csv）建成渠道。
 *
 *   npx tsx --env-file=.env scripts/import-channels.ts <文件> [--apply] [--owner=姓名]
 *
 * - 默认是演练：只打印「将建哪些、跳过哪些、哪格没按原样收」，库不动。确认后加 --apply 再跑一次。
 * - 表头认：渠道属性 / 渠道名称 / 来源名称 / 渠道状态 / 结束日期 / 负责人 / 创建人；「累计运营天数」不读（是算出来的）。
 * - 全称（渠道名称|来源名称）和库里已有的、或文件里前面的重复：跳过，打印出来。
 * - 来源名称以「待清洗」开头的拦下不建；同一全称结束月份不同的按月份分开建（全称后加「（N月）」）。
 * - 负责人、创建人按员工姓名对；对不上留空。负责人是机器人、没填、对不上的该由管理员指定，
 *   但库里必填，先挂给 --owner 指的人（不给就第一个在职管理员），报告里写「负责人留空待管理员指定」。
 * 规矩全在 src/lib/enterprise/channel-import.ts（有单测），这个脚本只管读文件、读库、写库。
 *
 * 直接连 DATABASE_URL 指的那个库（企业版私有部署就一个库），不走请求上下文。
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@/generated/prisma";
import { 读xlsx带行号 } from "@/lib/import/xlsx";
import { 解码CSV, 解析CSV带行号 } from "@/lib/import/parse";
import { 字典定义 } from "@/lib/enterprise/dict-kinds";
import { 排导入, 计划报告, 认人 } from "@/lib/enterprise/channel-import";

function 用法(话?: string): never {
  if (话) console.error(话);
  console.error("用法：npx tsx --env-file=.env scripts/import-channels.ts <文件.xlsx|文件.csv> [--apply] [--owner=姓名]");
  process.exit(2);
}

/** 读出来空行已经丢了，行号是每一行在原表里的行号（报告里说「第 N 行」对得上 Excel） */
function 读表(文件: string): { rows: string[][]; 行号: number[] } {
  const bytes = new Uint8Array(fs.readFileSync(文件));
  const ext = path.extname(文件).toLowerCase();
  if (ext === ".xlsx") return 读xlsx带行号(bytes);
  if (ext === ".csv" || ext === ".txt") return 解析CSV带行号(解码CSV(bytes));
  用法(`只认 .xlsx 和 .csv，「${path.basename(文件)}」不认`);
}

async function main() {
  const args = process.argv.slice(2);
  const 写 = args.includes("--apply");
  const owner参 = args.find((a) => a.startsWith("--owner="))?.slice("--owner=".length);
  const 文件 = args.find((a) => !a.startsWith("--"));
  if (!文件) 用法();
  if (!fs.existsSync(文件)) 用法(`找不到文件：${文件}`);
  if (!process.env.DATABASE_URL) 用法("没有 DATABASE_URL：记得带 --env-file=.env");

  const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  try {
    const 表 = 读表(文件);
    const [员工们, 已有, 字典] = await Promise.all([
      db.user.findMany({ select: { id: true, name: true, active: true, role: true }, orderBy: { createdAt: "asc" } }),
      db.channel.findMany({ select: { name: true } }),
      db.entDictItem.findMany({ where: { kind: "channelAttr" }, select: { name: true } }),
    ]);

    let 找到: { id: string; name: string } | undefined;
    if (owner参) {
      const 认 = 认人(owner参, 员工们);
      if ("错" in 认) 用法(`--owner：${认.错}`);
      找到 = 员工们.find((u) => u.id === 认.id);
    } else {
      找到 = 员工们.find((u) => u.active && u.role === "ADMIN");
    }
    if (!找到) 用法("库里没有在职管理员，请用 --owner=姓名 指定负责人对不上时挂给谁");
    const 兜底 = 找到;
    console.log(`负责人对不上 / 没填 / 是机器人的，留空待管理员指定，先挂给：${兜底.name}`);

    const 计划 = 排导入(表.rows, {
      行号: 表.行号,
      员工们,
      已有全称: 已有.map((c) => c.name),
      // 字典一行都没有时（还没打开过设置 → 字典），按默认那几项认
      字典属性: 字典.length ? 字典.map((x) => x.name) : 字典定义.channelAttr.默认,
      兜底负责人: { id: 兜底.id, name: 兜底.name },
    });

    if (写 && 计划.要建.length) {
      // 一个事务里建完：中间哪条撞了唯一约束（比如别人刚好同时建了同名渠道）整批不落，改完重跑
      await db.$transaction(async (tx) => {
        for (const c of 计划.要建) {
          const 建 = await tx.channel.create({
            data: { name: c.name, attr: c.attr, platform: c.platform, active: c.active, endDate: c.endDate, channelOwnerId: c.channelOwnerId, createdById: c.createdById },
            select: { id: true },
          });
          await tx.auditLog.create({
            data: {
              userId: 兜底.id,
              userName: `${兜底.name}（批量导入）`,
              action: "create",
              entity: "Channel",
              entityId: 建.id,
              summary: `导入渠道「${c.name}」`,
              detail: JSON.stringify({ 来自: path.basename(文件), 行号: c.行号 }),
            },
          });
        }
      });
    }
    console.log(计划报告(计划, 写));
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
