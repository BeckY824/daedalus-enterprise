/**
 * 删沟通记录后重算客户「最近跟进」的缝（代码体检 C10）：
 *   原来读一下最近一条、再写回客户，两步不在一个事务里：读完那一刻同事刚记了一条新的，
 *   删除这边把读到的旧值写回去，最近跟进被算回旧的（回收时钟跟着早走）。
 *   现在读和写放进同一个事务（查完再写），别的写插不进来，同 saveFollowUp、soft-delete.ts。
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "boss", role: "ADMIN", title: "", avatar: null },
  /** 删除那边读完「最近一条跟进」之后、写回客户之前插进来的那一下（只跑一次） */
  读完最近: null as null | (() => Promise<void>),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/enterprise/switch", () => ({ 企业版: () => true }));
vi.mock("@/lib/prisma", async (原) => {
  const 真 = await 原<typeof import("@/lib/prisma")>();
  type 任意 = Record<string | symbol, unknown>;
  const 取 = (t: 任意, k: string | symbol) => {
    const v = Reflect.get(t, k);
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
  };
  // 「按时间倒着取最近一条跟进、只要时间」就是重算最近跟进的那一读：读完跑一下插进来的
  const 包跟进 = (m: 任意) => new Proxy(m, {
    get(t, k) {
      if (k !== "findFirst") return 取(t, k);
      return async (a: { select?: { occurredAt?: boolean }; orderBy?: { occurredAt?: string } }) => {
        const r = await (t.findFirst as (x: unknown) => Promise<unknown>)(a);
        if (a?.select?.occurredAt && a?.orderBy?.occurredAt === "desc") {
          const 插 = mocks.读完最近;
          mocks.读完最近 = null;
          if (插) await 插();
        }
        return r;
      };
    },
  });
  const 包 = (c: 任意): 任意 => new Proxy(c, {
    get(t, k) {
      if (k === "followUp") return 包跟进(Reflect.get(t, k) as 任意);
      if (k === "$transaction") {
        return (fn: unknown, ...rest: unknown[]) =>
          (t.$transaction as (...x: unknown[]) => unknown)(typeof fn === "function" ? (tx: 任意) => (fn as (x: unknown) => unknown)(包(tx)) : fn, ...rest);
      }
      return 取(t, k);
    },
  });
  return { ...真, prisma: 包(真.prisma as unknown as 任意) };
});

import { prisma, defaultClient as raw } from "@/lib/prisma";
import { resetDb } from "./reset";
import { deleteFollowUp } from "@/app/(app)/customers/[id]/actions";

let 老板: string, 销售: string, 客户: string;
const 天 = 86_400_000;
const 记 = (occurredAt: Date, content = "聊了") =>
  raw.followUp.create({ data: { customerId: 客户, ownerId: 销售, type: "CALL", title: "电话", content, status: "已完成", occurredAt } });
const 最近跟进 = async () => (await raw.customer.findUniqueOrThrow({ where: { id: 客户 } })).lastFollowAt;

beforeEach(async () => {
  await resetDb();
  mocks.读完最近 = null;
  const 人 = async (email: string, role = "SALES") => (await raw.user.create({ data: { email, name: email, title: "", role, password: "x" } })).id;
  老板 = await 人("boss", "ADMIN");
  销售 = await 人("s1");
  await raw.entMember.createMany({ data: [{ userId: 老板, bizRole: "director" }, { userId: 销售, bizRole: "sales" }] });
  mocks.user = { ...mocks.user, id: 老板, role: "ADMIN" };
  客户 = (await raw.customer.create({ data: { name: "张三", phone: "13800000001", salesOwnerId: 销售 } })).id;
});
afterAll(async () => { await prisma.$disconnect(); });

describe("删沟通记录后重算最近跟进（C10）", () => {
  it("删除这边读完最近一条、还没写回，同事记了一条新的：最近跟进是新的那条，不被算回旧值", async () => {
    const 旧 = await 记(new Date(Date.now() - 3 * 天), "三天前");
    const 要删 = await 记(new Date(Date.now() - 2 * 天), "两天前");
    await raw.customer.update({ where: { id: 客户 }, data: { lastFollowAt: 要删.occurredAt } });
    const 新时刻 = new Date(Date.now() - 60_000);
    let 同事记的: Promise<unknown> | null = null;
    mocks.读完最近 = async () => {
      // 同事记一条新的（同 saveFollowUp：建记录 + 写最近跟进，一个事务）。不等它：读写在一个事务里时它得排在后面
      同事记的 = raw.$transaction(async (tx) => {
        await tx.followUp.create({ data: { customerId: 客户, ownerId: 销售, type: "CALL", title: "电话", content: "刚打的", status: "已完成", occurredAt: 新时刻 } });
        await tx.customer.update({ where: { id: 客户 }, data: { lastFollowAt: 新时刻 } });
      });
      void 同事记的.catch(() => undefined);
      await new Promise((r) => setTimeout(r, 150));
    };
    expect((await deleteFollowUp(要删.id, 客户)).ok).toBe(true);
    expect(同事记的).not.toBeNull();
    await 同事记的;
    expect((await 最近跟进())?.getTime()).toBe(新时刻.getTime());
    expect(旧.occurredAt.getTime()).toBeLessThan(新时刻.getTime());
  });

  it("没人插进来：删掉最近一条，最近跟进退回前一条；删光了清空", async () => {
    const 旧 = await 记(new Date(Date.now() - 3 * 天));
    const 新 = await 记(new Date(Date.now() - 天));
    expect((await deleteFollowUp(新.id, 客户)).ok).toBe(true);
    expect((await 最近跟进())?.getTime()).toBe(旧.occurredAt.getTime());
    expect((await deleteFollowUp(旧.id, 客户)).ok).toBe(true);
    expect(await 最近跟进()).toBeNull();
  });
});
