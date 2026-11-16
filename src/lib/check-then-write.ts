/**
 * 「先查重、再写入」落进同一个事务（2026-10-04 J-104）。
 *
 * 两个窗口几乎同时提交同一件事——同日同额的签约、同一个号码的新客户、同一份表导两次——
 * 原来都是「查一下没有 → 写」两步分开走：两边的「查」都落在对方的「写」之前，于是都查不到、都写进去，
 * 业绩翻倍、同号两份档案。界面上的提示只是给人看的，挡不住这种。
 *
 * 为什么不加唯一索引：手机号刻意不唯一（家长学生共用号码，2026-08-29 决策；老库里也真有同号的几条，
 * 建唯一索引会让老库迁移失败），签约「同日同额」更不是唯一——续费、分期就是同额同日，确认后照录。
 * 所以闸门只能是「查和写之间没有缝」：SQLite 的写事务是独占的，同一个进程里 Prisma 的交互式事务
 * 一个接一个跑（tests/check-then-write.test.ts 钉着），后进来的那个查的时候先进来的已经写完了。
 *
 * 另一个进程同时写（少见：桌面端只有一个本地服务）时 SQLite 会回「库忙」或写冲突，那一次什么都没写进去，
 * 整段重来即可，几轮拿不下就照常抛出去。排队太久开不了事务（P2028「Unable to start」）也一样：还没开始，重来是安全的。
 *
 * **事务自己跑超时被关掉（P2028「expired / Transaction not found」）不重来**（11-17 用户定）：那是这一段本身太大、太慢
 * （比如一次领 1000 多位公海客户、机器满载），不是撞上了别人。原来照「库忙」重来三轮，每轮都占满限时的写锁、
 * 前后挡住别人写库约 45 秒，最后还是失败。现在第一次超时就停（整段已经回滚，什么都没写进去），
 * 抛 事务超时错误，告诉人这次操作太大 / 太慢、可以分小批再试。
 *
 * **事务里只用 tx**：在里面走外面的 prisma 写，要排在这个事务后面等它提交（等到 busy_timeout）；
 * 走外面读，看不到事务里还没提交的那几行。要的配置（getBusiness 之类）先在外面读好。
 */
import type { Prisma } from "@/generated/prisma";
import { prisma } from "./prisma";

/**
 * 事务自己跑过了限时、被 Prisma 收掉（P2028）：
 *   - 跑到一半到点：「Transaction already closed: A query / commit cannot be executed on an expired transaction. The timeout for this transaction was …」
 *   - 到点后收得更干净，再查就是：「Transaction not found. Transaction ID is invalid, refers to an old closed transaction …」
 * 同是 P2028 的「Unable to start a transaction in the given time」是排队等开事务等超了（maxWait），还没开始，不算这个
 */
export function 事务跑超时(e: unknown): boolean {
  if ((e as { code?: string } | null)?.code !== "P2028") return false;
  const msg = e instanceof Error ? e.message : String(e);
  return /expired transaction|timeout for this transaction|Transaction not found|Transaction already closed/i.test(msg);
}

/**
 * 「库忙 / 写冲突 / 事务没开成」：这一轮什么都没写进去，可以整段重来。
 * P1008（Socket timeout，11-16）：多个进程共用一个库时，别的进程占着写锁超过 busy_timeout（lib/sqlite-url 等锁秒），
 * 交互式事务开头的 BEGIN IMMEDIATE 等不到锁就抛这个——事务没开成，同样什么都没写。
 * 事务自己跑超时（事务跑超时）不在这里：重来只会再占一轮写锁（见文件头）
 */
export function 撞上别的写入(e: unknown): boolean {
  if (事务跑超时(e)) return false;
  const code = (e as { code?: string } | null)?.code;
  if (code === "P2034" || code === "P2028" || code === "P1008") return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /database is locked|SQLITE_BUSY/i.test(msg);
}

export const 库忙话 = "系统正忙，请稍后再试";

/** 几轮都撞上别的写入：给人看的话（不露 Socket timeout 这类英文），code 和原来的错照旧带着，日志、调用方还认得出 */
export class 库忙错误 extends Error {
  readonly code?: string;
  constructor(cause: unknown, 话: string = 库忙话) {
    super(话, { cause });
    this.name = "库忙错误";
    this.code = (cause as { code?: string } | null)?.code;
  }
}

export const 事务超时话 = (秒: number) => `这次操作要改的太多（或系统正忙），${秒} 秒内没做完，已全部撤回、什么都没改；可以分小批再试，或稍后再试`;

/** 事务自己跑超时（只跑了一次、整段已回滚）：同属「系统正忙」那类，但说清是这次太大 / 太慢、可以分小批。code 照旧是 P2028 */
export class 事务超时错误 extends 库忙错误 {
  constructor(cause: unknown, 秒: number) {
    super(cause, 事务超时话(秒));
    this.name = "事务超时错误";
  }
}

/** 选项.timeout：一笔要转很多位客户的（确认交接、离职交接一键全部）放宽到 30 秒，同它们原来的事务 */
export async function 查完再写<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, 选项: { timeout?: number } = {}): Promise<T> {
  const 限时 = 选项.timeout ?? 15_000;
  for (let 第几轮 = 1; ; 第几轮++) {
    try {
      // 排队等前一个事务的时间放宽：默认 2 秒，前面恰好有一段同步回放时会误报失败
      return await prisma.$transaction(fn, { maxWait: 10_000, timeout: 限时 });
    } catch (e) {
      // 自己跑超时：不重来（见文件头），第一次就停
      if (事务跑超时(e)) {
        console.error(`查完再写：事务跑过了 ${限时} ms，已回滚、不重来`, e);
        throw new 事务超时错误(e, Math.round(限时 / 1000));
      }
      if (!撞上别的写入(e)) throw e;
      if (第几轮 >= 3) {
        console.error("查完再写：几轮都撞上别的写入", e);
        throw new 库忙错误(e);
      }
      await new Promise((r) => setTimeout(r, 30 * 第几轮));
    }
  }
}
