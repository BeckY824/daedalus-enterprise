/**
 * 查完再写（lib/check-then-write.ts，2026-10-04 J-104）的前提：同一个进程里两段事务不会交错。
 *
 * 签约查重、建客户查号、导入每行再认一次，全靠这一条——Prisma 哪天换了开事务的方式
 * （比如 SQLite 改成延迟加锁、或者连接池行为变了），这里先红，而不是等业绩翻倍了才发现。
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 查完再写, 撞上别的写入, 事务跑超时, 库忙错误, 事务超时错误, 库忙话 } from "@/lib/check-then-write";

let 我: string;
beforeEach(async () => {
  await resetDb();
  我 = (await prisma.user.create({ data: { email: "me", name: "我", title: "x", role: "ADMIN", password: "x" } })).id;
});
afterAll(async () => { await prisma.$disconnect(); });

describe("查完再写", () => {
  it("两段「查一下没有 → 停一会儿 → 写」同时跑：后一段查的时候前一段已经写完，只建出一位", async () => {
    const 建 = () => 查完再写(async (tx) => {
      if (await tx.customer.count({ where: { phone: "13800001111" } })) return "已经有了";
      // 故意在查和写之间留一段：没有闸门时另一段正好插进来
      await new Promise((r) => setTimeout(r, 50));
      await tx.customer.create({ data: { name: "王强", phone: "13800001111", followStatus: "待跟进", decisionStatus: "了解中", salesOwnerId: 我 } });
      return "建了";
    });
    const rs = await Promise.all([建(), 建()]);
    expect(rs.sort()).toEqual(["已经有了", "建了"]);
    expect(await prisma.customer.count()).toBe(1);
  });

  it("里面抛的不是「库忙」：原样抛出去、不重来、什么都没写进去", async () => {
    let 跑了 = 0;
    await expect(查完再写(async (tx) => {
      跑了++;
      await tx.customer.create({ data: { name: "半截", phone: "13800002222", followStatus: "待跟进", decisionStatus: "了解中", salesOwnerId: 我 } });
      throw new Error("别的错");
    })).rejects.toThrow("别的错");
    expect(跑了).toBe(1);
    expect(await prisma.customer.count()).toBe(0);
  });

  it("「库忙」重来一次就过", async () => {
    let 跑了 = 0;
    const r = await 查完再写(async () => {
      跑了++;
      if (跑了 === 1) throw Object.assign(new Error("Transaction failed due to a write conflict"), { code: "P2034" });
      return "过了";
    });
    expect([r, 跑了]).toEqual(["过了", 2]);
  });

  it("事务没开成（P2028 排队等开事务超了）照旧重来；三轮都不行给「系统正忙」", async () => {
    let 跑了 = 0;
    const r = await 查完再写(async () => {
      跑了++;
      if (跑了 === 1) throw Object.assign(new Error("Transaction API error: Unable to start a transaction in the given time."), { code: "P2028" });
      return "过了";
    });
    expect([r, 跑了]).toEqual(["过了", 2]);

    跑了 = 0;
    const 错 = await 查完再写(async () => {
      跑了++;
      throw Object.assign(new Error("Transaction API error: Unable to start a transaction in the given time."), { code: "P2028" });
    }).catch((e: unknown) => e);
    expect(跑了).toBe(3);
    expect(错).toBeInstanceOf(库忙错误);
    expect(错).not.toBeInstanceOf(事务超时错误);
    expect(错).toMatchObject({ code: "P2028", message: 库忙话 });
  });

  it("事务自己跑超时被关（P2028 expired / not found）：不重来，只跑一次，给「太大 / 太慢、分小批再试」", async () => {
    for (const msg of [
      "Transaction API error: Transaction already closed: A query cannot be executed on an expired transaction. The timeout for this transaction was 15000 ms, however 15023 ms passed since the start of the transaction.",
      "Transaction API error: Transaction already closed: A commit cannot be executed on an expired transaction. The timeout for this transaction was 15000 ms, however 15076 ms passed since the start of the transaction.",
      "Transaction API error: Transaction not found. Transaction ID is invalid, refers to an old closed transaction Prisma doesn't have information about anymore, or was obtained before disconnecting.",
    ]) {
      let 跑了 = 0;
      const 错 = await 查完再写(async () => {
        跑了++;
        throw Object.assign(new Error(msg), { code: "P2028" });
      }).catch((e: unknown) => e);
      expect([msg, 跑了]).toEqual([msg, 1]);
      expect(错).toBeInstanceOf(事务超时错误);
      // 同属「系统正忙」那类（还是 库忙错误、code 照旧），话说清是这次太大 / 太慢、能分小批，不露英文
      expect(错).toBeInstanceOf(库忙错误);
      expect(错).toMatchObject({ code: "P2028" });
      expect((错 as Error).message).toMatch(/太多.*15 秒内没做完.*什么都没改.*分小批再试/);
      expect(String(错)).not.toMatch(/Transaction|expired/);
    }
    expect(事务跑超时(Object.assign(new Error("Transaction not found."), { code: "P2028" }))).toBe(true);
    expect(事务跑超时(Object.assign(new Error("Unable to start a transaction in the given time."), { code: "P2028" }))).toBe(false);
    expect(撞上别的写入(Object.assign(new Error("Transaction already closed: … expired transaction"), { code: "P2028" }))).toBe(false);
  });

  it("真跑超时（事务限时 300 ms、里面拖 1 秒）：只跑一次、整段回滚；写锁马上放开，别人随即写得进去", async () => {
    let 跑了 = 0;
    const 起 = Date.now();
    const 错 = await 查完再写(async (tx) => {
      跑了++;
      await tx.customer.create({ data: { name: "太慢的", phone: "13800003333", followStatus: "待跟进", decisionStatus: "了解中", salesOwnerId: 我 } });
      await new Promise((r) => setTimeout(r, 1000));
      await tx.customer.count();
      return "不该到这";
    }, { timeout: 300 }).catch((e: unknown) => e);
    const 用了 = Date.now() - 起;
    expect(跑了).toBe(1);
    expect(错).toBeInstanceOf(事务超时错误);
    // 原来重来三轮：约 3 × (限时 + 拖的那段)；现在一轮就停
    expect(用了).toBeLessThan(2500);
    expect(await prisma.customer.count({ where: { phone: "13800003333" } })).toBe(0);
    // 写锁没被占着：外面紧接着写，很快就进去（排队等锁会到 maxWait / busy_timeout 的秒级）
    const 写起 = Date.now();
    await prisma.customer.create({ data: { name: "后来的", phone: "13800004444", followStatus: "待跟进", decisionStatus: "了解中", salesOwnerId: 我 } });
    expect(Date.now() - 写起).toBeLessThan(1000);
    // 再用 查完再写 写一笔也一轮就过
    let 再跑 = 0;
    await 查完再写(async (tx) => { 再跑++; await tx.customer.count(); });
    expect(再跑).toBe(1);
  });

  it("别的进程占着写锁等过了 busy_timeout（P1008 Socket timeout）：也重来；三轮都不行给人话，不露英文", async () => {
    let 跑了 = 0;
    const r = await 查完再写(async () => {
      跑了++;
      if (跑了 === 1) throw Object.assign(new Error("Socket timeout (the database failed to respond to a query within the configured timeout)"), { code: "P1008" });
      return "过了";
    });
    expect([r, 跑了]).toEqual(["过了", 2]);

    跑了 = 0;
    const 错 = await 查完再写(async () => {
      跑了++;
      throw Object.assign(new Error("Socket timeout"), { code: "P1008" });
    }).catch((e: unknown) => e);
    expect(跑了).toBe(3);
    expect(错).toBeInstanceOf(库忙错误);
    expect(错).toMatchObject({ code: "P1008", message: "系统正忙，请稍后再试" });
    expect(String(错)).not.toMatch(/Socket timeout/);
    expect(撞上别的写入(Object.assign(new Error("x"), { code: "P1008" }))).toBe(true);
    expect(撞上别的写入(Object.assign(new Error("x"), { code: "P2002" }))).toBe(false);
  });
});
