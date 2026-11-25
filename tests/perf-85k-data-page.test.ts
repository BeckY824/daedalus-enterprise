/**
 * 数据页统计（overview/project-stats.ts 项目现在 / 项目一段）在 8.5 万客户量级上要多久（后售培育拆行 11-25，方案-售后回访与后售培育 第七节风险 2）。
 * 平时跳过：BIG=1 [PERF_OUT=结果文件] npx vitest run tests/perf-85k-data-page.test.ts
 *
 * 造 8.5 万位客户、约 6.7 万个项目（照 c2 回填后的样子：5 万个历史分析回填的在公海、8 千个普通的在公海潜客培育、
 * 4 千个线索阶段在推、2 千个商机 / 订单在推、2 千个交付结清、1 千个线索流失），交付结清的那 2 千位客户名下各还有一个停在潜客培育的（= 后售）。
 * 每样量 5 次取中位数，打在控制台里；过关线写在断言上（宽松，防的是数量级的退化）。
 * 顺带钉一下大库上的拆行：潜客 + 后售 = 停在潜客培育的合计。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 项目现在, 项目一段 } from "../src/app/(app)/overview/project-stats";
import { 后售培育名 } from "@/lib/project/stage-dict";

const 客户数 = 85_000;
const 结果: string[] = [];

async function 量<T>(名: string, fn: () => Promise<T>, 上限毫秒: number): Promise<T> {
  let r!: T;
  const 用们: number[] = [];
  for (let i = 0; i < 5; i++) {
    const 起 = performance.now();
    r = await fn();
    用们.push(performance.now() - 起);
  }
  const 中 = Math.round([...用们].sort((a, b) => a - b)[2]);
  结果.push(`${名}：中位 ${中} ms（5 次 ${用们.map((x) => Math.round(x)).join(" / ")}；线 ${上限毫秒}）`);
  expect(中, `${名} 太慢`).toBeLessThan(上限毫秒);
  return r;
}

describe.runIf(process.env.BIG === "1")("数据页统计 · 8.5 万客户", () => {
  beforeAll(async () => {
    await resetDb();
    const 人们 = Array.from({ length: 20 }, (_, i) => ({ id: `u${i}`, email: `u${i}@t`, password: "x", name: `销售${i}`, role: "SALES" }));
    await prisma.user.createMany({ data: 人们 });
    const 批 = 2000;
    for (let i = 0; i < 客户数; i += 批) {
      await prisma.customer.createMany({ data: Array.from({ length: Math.min(批, 客户数 - i) }, (_, k) => ({ id: `c${i + k}`, name: `客户${i + k}`, phone: `139${String(i + k).padStart(8, "0")}`, salesOwnerId: `u${(i + k) % 20}` })) });
    }
    const 年初 = new Date(new Date().getFullYear(), 0, 2).getTime();
    const 天 = 86_400_000;
    type 行 = { customerId: string; phase: string; node: string; result?: string; pooledAt?: Date; source?: string; closedAt?: Date };
    const 项目们: 行[] = [];
    const 公海时 = new Date(年初 + 30 * 天);
    for (let i = 0; i < 50_000; i++) 项目们.push({ customerId: `c${i}`, phase: "线索", node: "潜客培育", pooledAt: 公海时, source: "history-analysis" });
    for (let i = 50_000; i < 58_000; i++) 项目们.push({ customerId: `c${i}`, phase: "线索", node: "潜客培育", pooledAt: 公海时 });
    const 线索节点 = ["潜客培育", "线索验证", "线索推进"];
    for (let i = 58_000; i < 62_000; i++) 项目们.push({ customerId: `c${i}`, phase: "线索", node: 线索节点[i % 3] });
    const 后节点 = [["商机", "痛点挖掘"], ["商机", "方案敲定"], ["订单", "生产备货"], ["订单", "尾款结算"]];
    for (let i = 62_000; i < 64_000; i++) 项目们.push({ customerId: `c${i}`, phase: 后节点[i % 4][0], node: 后节点[i % 4][1] });
    // 交付结清：挂在 c58000–c59999（这 2 千位名下各还有一个线索阶段在推的，停在潜客培育的那三分之一 = 后售）……
    for (let i = 58_000; i < 60_000; i++) 项目们.push({ customerId: `c${i}`, phase: "订单", node: "尾款结算", result: "交付结清", closedAt: new Date(年初 + (i % 200) * 天) });
    // ……再给这 2 千位各补一个停在潜客培育的，后售那行有 2 千多
    for (let i = 58_000; i < 60_000; i++) 项目们.push({ customerId: `c${i}`, phase: "线索", node: "潜客培育" });
    for (let i = 64_000; i < 65_000; i++) 项目们.push({ customerId: `c${i}`, phase: "线索", node: 线索节点[i % 3], result: "线索流失", closedAt: new Date(年初 + (i % 200) * 天) });
    for (let i = 0; i < 项目们.length; i += 批) {
      await prisma.project.createMany({
        data: 项目们.slice(i, i + 批).map((p, k) => {
          const n = i + k;
          const owner = `u${n % 20}`;
          return { name: `项目${n}`, ownerId: owner, creatorId: owner, createdAt: new Date(年初 + (n % 300) * 天), ...p };
        }),
      });
    }
  }, 600_000);

  afterAll(async () => {
    console.log(`\n数据页统计 · 8.5 万客户：\n${结果.join("\n")}\n`);
    // 通过的用例 vitest 不打控制台：要留数就给 PERF_OUT=文件路径
    if (process.env.PERF_OUT) fs.writeFileSync(process.env.PERF_OUT, `${结果.join("\n")}\n`);
    await resetDb();
  });

  it("项目现在（全部）、项目一段（本年）：中位数在线内", async () => {
    const 数 = await 量("项目现在 · 全部", () => 项目现在("CNY"), 3000);
    await 量("项目现在 · 只看一个人", () => 项目现在("CNY", "u3"), 3000);
    const 年初 = new Date(new Date().getFullYear(), 0, 1);
    const 年末 = new Date(new Date().getFullYear(), 11, 31, 23, 59, 59, 999);
    await 量("项目一段 · 本年", () => 项目一段(年初, 年末, "month", "CNY"), 3000);
    // 拆行：潜客 + 后售 = 停在潜客培育、有人跟的（8 千个公海的、5 万历史分析的不算）；后售 = 交付结清那 2 千位名下停在潜客培育的
    const 节 = (n: string) => 数.节点.find((x) => x.phase === "线索" && x.node === n)?.count ?? 0;
    const 潜客的 = (从: number, 到: number) => Array.from({ length: 到 - 从 }, (_, k) => 从 + k).filter((i) => i % 3 === 0).length;
    expect(节("潜客培育") + 节(后售培育名)).toBe(潜客的(58_000, 62_000) + 2000);
    expect(节(后售培育名)).toBe(潜客的(58_000, 60_000) + 2000);
  }, 120_000);
});
