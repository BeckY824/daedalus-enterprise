/**
 * 公海分组计数的短时缓存（8.5 万客户提速第二轮，11-14，lib/enterprise/pool-count-cache.ts）：
 * 同一句同一组参数几秒内只查一次；参数不同（回避掉的人不同）各算各的；经限定层的任何写都让缓存作废；过了存活时间重查；查出错不留；
 * 交互式事务里写了、提交前别人读到旧数存进缓存的那份，事务结束后作废；命中 / 未命中 / 作废有计数。
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 缓存分组数, 测试里开公海分组缓存, 写库版本, 公海分组缓存统计 } from "@/lib/enterprise/pool-count-cache";
import { PrismaClient } from "@/generated/prisma";
import { 分组数SQL } from "@/lib/enterprise/unified-pool-sql";

beforeAll(async () => {
  delete process.env.CRM_ENTERPRISE;
  await resetDb();
  测试里开公海分组缓存(true);
});
afterEach(() => {
  delete process.env.CRM_ENTERPRISE;
  vi.useRealTimers();
  测试里开公海分组缓存(true);
});
afterAll(async () => {
  测试里开公海分组缓存(false);
  await resetDb();
});

describe("公海分组计数短时缓存", () => {
  it("同句同参数只查一次（并发的也一起等）；参数不同各查各的", async () => {
    let 次 = 0;
    const 查 = async () => ++次;
    const [a, b] = await Promise.all([缓存分组数("S", [1, "x"], 查), 缓存分组数("S", [1, "x"], 查)]);
    expect([a, b, 次]).toEqual([1, 1, 1]);
    expect(await 缓存分组数("S", [1, "x"], 查)).toBe(1);
    expect(await 缓存分组数("S", [1, "y"], 查)).toBe(2);
    expect(await 缓存分组数("T", [1, "x"], 查)).toBe(3);
  });

  it("回避掉的人不同，键就不同（整句 + 参数都进键）", () => {
    const 甲 = 分组数SQL({ 商机: ["a"], 订单: [], 排掉: [] });
    const 乙 = 分组数SQL({ 商机: ["a"], 订单: [], 排掉: ["c1"] });
    expect(JSON.stringify([甲.sql, 甲.值])).not.toBe(JSON.stringify([乙.sql, 乙.值]));
  });

  it("经限定层的写（模型写、$executeRaw）都让版本号变、缓存作废；只读的不变（企业版的 prisma 才套限定层）", async () => {
    process.env.CRM_ENTERPRISE = "1";
    let 次 = 0;
    const 查 = async () => ++次;
    await 缓存分组数("W", [], 查);
    const v0 = 写库版本();
    await prisma.setting.create({ data: { key: "pool-cache-test", value: "1" } });
    expect(写库版本()).toBeGreaterThan(v0);
    expect(await 缓存分组数("W", [], 查)).toBe(2);
    const v1 = 写库版本();
    await prisma.$executeRawUnsafe(`UPDATE "Setting" SET value = '2' WHERE key = 'pool-cache-test'`);
    expect(写库版本()).toBeGreaterThan(v1);
    expect(await 缓存分组数("W", [], 查)).toBe(3);
    const v2 = 写库版本();
    await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM "Setting"`);
    await prisma.setting.findMany();
    expect(写库版本()).toBe(v2);
    expect(await 缓存分组数("W", [], 查)).toBe(3);
    delete process.env.CRM_ENTERPRISE;
  });

  it("交互式事务：事务里写 → 提交前另一条连接读到旧数存进缓存 → 提交后再读拿到新数", async () => {
    process.env.CRM_ENTERPRISE = "1";
    // 另一处读：自己一条连接，只看得到已提交的
    const 别处 = new PrismaClient({ datasourceUrl: `${process.env.DATABASE_URL}?connection_limit=1` });
    try {
      const 数 = () => 缓存分组数("TX", [], () => 别处.setting.count({ where: { key: { startsWith: "pool-cache-tx-" } } }));
      expect(await 数()).toBe(0);
      let 事务里读到 = -1;
      await prisma.$transaction(async (tx) => {
        await tx.setting.create({ data: { key: "pool-cache-tx-1", value: "1" } });
        // 写已经做完、版本号已经加过，事务还没提交：这时读到的是旧数，带着最新版本号进了缓存
        事务里读到 = await 数();
      });
      expect(事务里读到).toBe(0);
      expect(await 数()).toBe(1);
    } finally {
      await 别处.$disconnect();
      delete process.env.CRM_ENTERPRISE;
    }
  });

  it("统计：命中 / 未命中 / 作废各记一次（只数不改行为）", async () => {
    const 前 = 公海分组缓存统计();
    const 查 = async () => 1;
    await 缓存分组数("S1", [], 查); // 未命中
    await 缓存分组数("S1", [], 查); // 命中
    process.env.CRM_ENTERPRISE = "1";
    await prisma.setting.create({ data: { key: "pool-cache-stat", value: "1" } });
    delete process.env.CRM_ENTERPRISE;
    await 缓存分组数("S1", [], 查); // 没过期但写过库：作废
    const 后 = 公海分组缓存统计();
    expect([后.未命中 - 前.未命中, 后.命中 - 前.命中, 后.作废 - 前.作废]).toEqual([1, 1, 1]);
  });

  it("过了存活时间重查；查出错的不留", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 14, 0, 0, 0)));
    let 次 = 0;
    const 查 = async () => ++次;
    await 缓存分组数("E", [], 查);
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 14, 0, 0, 2)));
    expect(await 缓存分组数("E", [], 查)).toBe(1);
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 14, 0, 0, 4)));
    expect(await 缓存分组数("E", [], 查)).toBe(2);
    let 坏 = true;
    const 会坏 = async () => {
      if (坏) throw new Error("库忙");
      return "好";
    };
    await expect(缓存分组数("F", [], 会坏)).rejects.toThrow("库忙");
    坏 = false;
    expect(await 缓存分组数("F", [], 会坏)).toBe("好");
  });

  it("测试里默认关着：直接查", async () => {
    测试里开公海分组缓存(false);
    let 次 = 0;
    const 查 = async () => ++次;
    await 缓存分组数("G", [], 查);
    await 缓存分组数("G", [], 查);
    expect(次).toBe(2);
  });
});
