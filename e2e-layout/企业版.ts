/**
 * 排版闸门的企业版服务（10-28）：本仓库只出企业版（CRM_ENTERPRISE=1，项目模式），闸门量的页面要是企业版用户真看得到的那些。
 * 闸门三份（排版闸门-1024 / -1280 / -1366）都在这里起的企业版服务上跑，见 playwright.layout.config.ts（10-28 起和桌面端那一套脱钩）。
 *
 * 库、端口都是自己的：prisma/e2e-layout-ent/（不进仓库）、E2E_PORT + 2（默认 3302，跟着 E2E_PORT 挪）。
 * 和 e2e-ent/global-setup.ts 一样由 webServer 命令在起服务前跑（企业版服务器一启动就连库）：
 *
 *   npx tsx e2e-layout/企业版.ts
 *
 * 数据照种子.ts 的长名客户造，换成企业版的样子：没有商机 / 订单 / 供应商（企业版启动清理会删老表，见 lib/enterprise/legacy-cleanup.ts），
 * 每位客户挂线索 / 商机 / 订单三个阶段的项目（项目名用长句、整段询盘、长网址、长中文、中英混排），一位长英文名同事挂大额项目，
 * 跟进记录挂在项目上、跟进计划有逾期的；业务配置写长来源 / 长职级 / 长行业 + 长字段名（设置有进程内缓存，只能起服务前写）。
 * 名字、号码都是编的。密码每轮随机，只写进 seed.json（不进仓库），用例从那里读
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import bcrypt from "bcryptjs";
import type { Page } from "@playwright/test";
import { PrismaClient } from "../src/generated/prisma";
import { BUSINESS_KEY } from "../src/lib/business-config";
import { 客户们, 长句商机, 长段商机, 长网址商机, 长中文商机, 混排商机, 长名同事 } from "./种子";

const ROOT = path.resolve(__dirname, "..");
export const 企业版目录 = path.resolve(ROOT, "prisma/e2e-layout-ent");
export const 企业版库 = path.join(企业版目录, "e2e-layout-ent.db");
const 种子文件 = path.join(企业版目录, "seed.json");
/** E2E_PORT（默认 3300）+ 2：沿用和桌面端那一套同开时的端口，本机已有的 E2E_PORT 习惯不用改 */
export const 企业版端口 = (Number(process.env.E2E_PORT) || 3300) + 2;
export const 企业版地址 = `http://localhost:${企业版端口}`;

type 种子 = { 密码: string; 项目: string; 公海项目: string };
const 读种子 = (): 种子 => JSON.parse(readFileSync(种子文件, "utf8")) as 种子;

/** 用 seed 建的 admin（老板）登录：企业版用户名存在 email 字段里 */
export async function 企业版进门(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("用户名").fill("admin");
  await page.getByPlaceholder("登录密码").fill(读种子().密码);
  await page.getByRole("button", { name: /登\s*录/ }).click();
  await page.waitForURL(/\/dashboard/);
}

/** 页面表里要用到的 id（项目 id 是 cuid，起服务前才定） */
export const 企业版种子 = () => 读种子();

const 天 = 86400_000;
const 长 = (前: string, n: number) => Array.from({ length: n }, (_, i) => `${前}${i + 1}`);

async function 建库() {
  rmSync(企业版目录, { recursive: true, force: true });
  mkdirSync(企业版目录, { recursive: true });
  writeFileSync(企业版库, "");
  // 开发模式下换开构建目录、tsconfig，免得和同一工作树里自己开着的 next dev 抢目录（见 next.config.ts 的 distDir 那段）
  writeFileSync(path.join(企业版目录, "tsconfig.json"), JSON.stringify({ extends: "../../tsconfig.json" }, null, 2));

  const 密码 = randomBytes(9).toString("base64url");
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: `file:${企业版库}`, CRM_ENTERPRISE: "1", INIT_PASSWORD: 密码 };
  execFileSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], { cwd: ROOT, env, stdio: "pipe" });
  execFileSync("npx", ["tsx", "prisma/seed.ts"], { cwd: ROOT, env, stdio: "pipe" });

  const db = new PrismaClient({ datasources: { db: { url: `file:${企业版库}` } } });
  try {
    writeFileSync(种子文件, JSON.stringify({ 密码, ...(await 灌数据(db, 密码)) }, null, 2));
  } finally {
    await db.$disconnect();
  }
}

async function 灌数据(db: PrismaClient, 密码: string): Promise<Omit<种子, "密码">> {
  const 现在 = Date.now();
  const 我 = (await db.user.findFirstOrThrow({ where: { email: "admin" } })).id;
  const 同事 = await db.user.create({
    data: { id: 长名同事.id, email: "gate-long-owner", name: 长名同事.名, title: "大客户经理（中东 / 中亚 / 东欧）", role: "SALES", password: await bcrypt.hash(密码, 10) },
  });
  const 部门 = await db.entDept.create({ data: { name: "华东大区 · 冷链包装与清真食品进出口事业部（含中东 / 中亚业务线）" } });
  await db.entMember.create({ data: { userId: 同事.id, deptId: 部门.id, bizRole: "sales", line: "外贸" } });

  // 企业版业务配置读出来会锁成通用措辞 + 项目模式（business-config.ts 企业版锁定）；长选项、长字段名照样生效
  await db.setting.createMany({
    data: [
      {
        key: BUSINESS_KEY,
        value: JSON.stringify({
          projectMode: true,
          fields: { school: "公司全称（含英文注册名）", grade: "采购负责人职位 / 职级", major: "主营行业与细分品类" },
          grades: [...长("Head of Global Procurement & Strategic Sourcing (EMEA) 第", 12), "SeniorProcurementManagerForFrozenPoultryAndSeafoodImports"],
          sources: [...长("Alibaba International Station · RFQ 询盘 · 2026 秋季广交会线下展位 ", 12), "LinkedInSalesNavigatorOutboundCampaignAutumn2026"],
          industries: [...长("Frozen poultry, seafood & halal-certified meat products distribution 第", 12), "冷冻禽肉水产品及清真认证肉类产品进出口批发与零售连锁"],
        }),
      },
      { key: "onboarding.templateChosenAt", value: JSON.stringify(new Date().toISOString()) },
    ],
  });

  const 项目名们 = [长句商机, 长段商机, 长网址商机, 长中文商机, 混排商机];
  const 阶段们 = [
    { phase: "线索", node: "线索验证" },
    { phase: "商机", node: "成交推进" },
    { phase: "订单", node: "生产备货" },
  ] as const;
  let 第一个项目 = "";
  for (const [i, c] of 客户们.entries()) {
    const id = `gate-${c.k}`;
    await db.customer.create({
      data: {
        id, name: c.name, school: "school" in c ? c.school : undefined, grade: "grade" in c ? c.grade : undefined, major: "major" in c ? c.major : undefined,
        phone: `+44 20 7946 ${String(1000 + i)}`, salesOwnerId: i % 2 ? 同事.id : 我, followStatus: c.follow, decisionStatus: c.decision,
        lastFollowAt: new Date(现在 - i * 天), remark: "Incoterms 2020 EXW Shenzhen; payment T/T 30/70; samples DHL account 123456789; 每月 15 号前对账",
        extra: { create: { country: c.country, whatsapp: `+44 7700 900${String(100 + i)}`, email: `procurement.department.${c.k}@international-group-holdings.example.co.uk`, source: c.source, level: c.level, website: `https://www.${c.k}-international-group-holdings.example.co.uk/products/frozen-chicken-breast` } },
        contacts: { create: [
          { name: "Mr. Alexander Christopher Montgomery-Smythe", position: "Head of Global Procurement & Supply Chain", phone: "+44 7700 900123", email: "alexander.montgomery-smythe@scandipak-europe.example.co.uk", isPrimary: true },
          { name: "Ms. Aigul Berdimuhamedova", position: "Import Manager (Ashgabat office)", phone: "+993 12 345678", email: "aigul@altynasyr.example.tm" },
        ] },
      },
    });
    const 项目们: string[] = [];
    for (const [j, s] of 阶段们.entries()) {
      const 主人 = (i + j) % 3 === 2 ? 同事.id : 我;
      const p = await db.project.create({
        data: {
          name: 项目名们[(i + j) % 项目名们.length], customerId: id, ownerId: 主人, creatorId: 我, ...s,
          amount: [1234567.89, 98765432.1, 12345678.9][j], currency: j === 1 ? "CNY" : "USD",
          remark: "客户要求先寄样 3 箱，样品费到付；报价有效期 15 天；40ft reefer × 12，目的港 Turkmenbashi 经 Mersin 转运",
          expectedDealAt: new Date(现在 + (20 + j) * 天), nextStepAt: new Date(现在 + (j - 1) * 天),
        },
      });
      项目们.push(p.id);
      if (!第一个项目) 第一个项目 = p.id;
    }
    for (let j = 0; j < 4; j++) {
      const f = await db.followUp.create({
        data: {
          customerId: id, ownerId: 我, type: ["PHONE", "EMAIL", "OTHER", "MEETING"][j], title: "", status: "已完成", occurredAt: new Date(现在 - j * 天 - i * 3600_000),
          content: j === 1
            ? "客户发来询价：https://www.scandipak-europe.example.co.uk/procurement/rfq/2026/10/frozen-chicken-breast-bfq-exw-10kg-box-turkmenistan-tadjikistan?ref=whatsapp&lang=en"
            : `${长句商机}。客户说下周三之前要确认价格，T/T 30/70，US$ 1,234,567.89，问能不能做 CIF Turkmenbashi。`,
        },
      });
      if (j < 3) await db.followUpProject.create({ data: { followUpId: f.id, projectId: 项目们[j], node: 阶段们[j].node } });
    }
    for (const [j, 差] of [-3, 0, 2].entries()) {
      await db.followPlan.create({ data: { customerId: id, ownerId: 我, subject: `${j === 0 ? "【逾期】" : ""}催 ${c.name} 回签 PI 并确认 30% 定金到账时间（${长句商机.slice(0, 40)}…）`, plannedAt: new Date(现在 + 差 * 天), method: ["电话沟通", "邮件", "上门拜访"][j] } });
    }
  }
  // 项目公海：长名客户下一个线索项目放进去（/projects?pool=1 有一行、带「收回次数」列）
  const 公海 = await db.project.create({
    data: { name: 长段商机, customerId: "gate-long-uk", ownerId: 同事.id, creatorId: 我, phase: "线索", node: "潜客培育", pooledAt: new Date(现在 - 2 * 天), amount: 456789.12, currency: "USD" },
  });
  // 新线索在企业版就是线索阶段的项目（leads/page.tsx 企业版只用项目），上面每位客户都挂了一个，老 Lead 表不灌
  // 渠道：长名、长备注，挂两位客户（渠道页有「带来客户」数）
  const 渠道 = await db.channel.create({
    data: { name: "Dubai Jebel Ali Free Zone 华人商会 · 冷链食品进口采购联盟（含阿布扎比 / 沙迦分会）", phone: "+971 4 555 0199", remark: "每季度带一批采购商来厂；佣金 3%，到账后 30 天内结", channelOwnerId: 我 },
  });
  await db.customer.updateMany({ where: { id: { in: ["gate-scandi", "gate-long-uk"] } }, data: { channelId: 渠道.id } });
  // 带属性标签的超长渠道（10-30「渠道名要显示完整」）：名字折行、属性 / 已停用标签钉在第一行右边，不许压字、不许把表撑宽
  await db.channel.create({ data: { name: "Facebook｜VR STAR SPACE 某某某超长渠道名测试测试测试", attr: "公域引流", channelOwnerId: 我 } });
  await db.channel.create({
    data: { name: "视频号|星际空间 InterstellarSpaceOfficialChannel 超长渠道名测试测试测试", platform: "视频号", attr: "个人自拓", active: false, channelOwnerId: 我 },
  });
  return { 项目: 第一个项目, 公海项目: 公海.id };
}

if (require.main === module) {
  建库().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
