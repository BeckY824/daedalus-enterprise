/**
 * 设置缓存跨进程作废（11-16 用满 4 核，src/lib/settings.ts）：
 * - 按库指纹认新旧：指纹没变一直用缓存，变了（任何进程提交过）重读；
 * - 拿不到指纹时最多用 兜底毫秒，不得永不过期；
 * - 同一时刻的几次读只查一次库（loadAll 去重）；
 * - 只读通道关着（只有那 1 条写连接）时旧了先给旧的、后台重读，不在事务里现读等自己；
 * - 本进程写过设置马上看得到（读到一半的那次不算数）。
 * 库、指纹、只读通道开关都换成假的，只钉缓存的规则。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const 假 = vi.hoisted(() => ({
  指纹: "f1" as string | null,
  读通道: true,
  行: [] as { key: string; value: string }[],
  读了: 0,
  卡住: null as null | Promise<void>,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    setting: {
      findMany: async () => {
        假.读了++;
        const 此刻的行 = 假.行.map((r) => ({ ...r }));
        if (假.卡住) await 假.卡住;
        return 此刻的行;
      },
      upsert: async ({ where, update, create }: { where: { key: string }; update: { value: string }; create: { key: string; value: string } }) => {
        const 有 = 假.行.find((r) => r.key === where.key);
        if (有) 有.value = update.value;
        else 假.行.push({ ...create });
      },
    },
  },
}));
vi.mock("@/lib/home-cache", () => ({ 库指纹: () => 假.指纹 }));
vi.mock("@/lib/read-pool", () => ({ 读通道开着: () => 假.读通道 }));

import { getSetting, setSetting, invalidateSettingsCache, 兜底毫秒 } from "@/lib/settings";

const 存 = (key: string, v: unknown) => {
  const 有 = 假.行.find((r) => r.key === key);
  if (有) 有.value = JSON.stringify(v);
  else 假.行.push({ key, value: JSON.stringify(v) });
};

beforeEach(() => {
  假.指纹 = "f1";
  假.读通道 = true;
  假.行 = [];
  假.读了 = 0;
  假.卡住 = null;
  invalidateSettingsCache();
});
afterEach(() => vi.restoreAllMocks());

describe("设置缓存按库指纹作废", () => {
  it("指纹没变：一直用缓存，别处改了库也不重读；指纹一变（别的进程提交了）下一次就读到新值", async () => {
    存("权限", "旧");
    expect(await getSetting("权限")).toBe("旧");
    存("权限", "新"); // 别的进程直接改了库，但指纹还没变（假的）
    expect(await getSetting("权限")).toBe("旧");
    expect(假.读了).toBe(1);
    假.指纹 = "f2";
    expect(await getSetting("权限")).toBe("新");
    expect(await getSetting("权限")).toBe("新");
    expect(假.读了).toBe(2);
  });

  it("拿不到指纹：按 兜底毫秒 过期，不会永远用旧的", async () => {
    假.指纹 = null;
    let 此刻 = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => 此刻);
    存("规则", 1);
    expect(await getSetting("规则")).toBe(1);
    存("规则", 2);
    此刻 += 兜底毫秒 - 1;
    expect(await getSetting("规则")).toBe(1);
    此刻 += 2;
    expect(await getSetting("规则")).toBe(2);
    expect(假.读了).toBe(2);
    expect(兜底毫秒).toBeLessThanOrEqual(5_000);
  });

  it("同时来的几次读只查一次库", async () => {
    let 放 = () => {};
    假.卡住 = new Promise<void>((r) => (放 = r));
    存("a", 1);
    const 几个 = Promise.all([getSetting("a"), getSetting("a"), getSetting("b"), getSetting("a")]);
    await new Promise((r) => setTimeout(r, 5));
    放();
    expect(await 几个).toEqual([1, 1, null, 1]);
    expect(假.读了).toBe(1);

    // 指纹变了之后同时来的也只重读一次
    假.指纹 = "f2";
    await Promise.all([getSetting("a"), getSetting("a"), getSetting("a")]);
    expect(假.读了).toBe(2);
  });

  it("只读通道关着：指纹变了先给旧的、后台重读一次（不在事务里现读等自己），读好就换上", async () => {
    假.读通道 = false;
    存("k", "旧");
    expect(await getSetting("k")).toBe("旧");
    存("k", "新");
    假.指纹 = "f2";
    let 放 = () => {};
    假.卡住 = new Promise<void>((r) => (放 = r));
    expect(await getSetting("k")).toBe("旧");
    expect(await getSetting("k")).toBe("旧");
    expect(假.读了).toBe(2); // 后台只起了一次
    放();
    await vi.waitFor(async () => expect(await getSetting("k")).toBe("新"));
    expect(假.读了).toBe(2);
  });

  it("本进程写了设置马上读得到；写之前开始、写之后才读完的那一次不算数", async () => {
    存("k", 1);
    expect(await getSetting("k")).toBe(1);
    // 有人正在读（指纹变了），读的是写之前的那份
    假.指纹 = "f2";
    let 放 = () => {};
    假.卡住 = new Promise<void>((r) => (放 = r));
    const 在读 = getSetting("k");
    await new Promise((r) => setTimeout(r, 5));
    假.卡住 = null;
    await setSetting("k", 2);
    expect(await getSetting("k")).toBe(2); // 不等也不用那次旧读
    放();
    expect(await 在读).toBe(1);
    expect(await getSetting("k")).toBe(2); // 旧读完了也没把旧值放回缓存
  });

  it("invalidateSettingsCache 后一定现读（只读通道关着也不给旧的）", async () => {
    假.读通道 = false;
    存("k", 1);
    expect(await getSetting("k")).toBe(1);
    存("k", 2);
    invalidateSettingsCache();
    expect(await getSetting("k")).toBe(2);
  });
});
