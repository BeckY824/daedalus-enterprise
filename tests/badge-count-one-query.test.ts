/**
 * 左栏角标一句数完（4 核提速 1c 第 4 条，11-16，lib/reminders-db.ts 数角标）：原来跟进的 逾期 / 今天 是 4 句 count（每句带限定层补的「客户没删」），
 * 铃铛的未读通知又 1 句。这里拿老实现（带限定的 4 句 count，名下这人在读的范围里时包在 看全部 里 + notify.ts 的 未读通知数）对拍新实现，逐项相等：
 *   - 各业务角色（销售、销售管理、总管理、管理员只读、市场管理、没有组织行的人）各数自己的，也互相数别人的（不在读的范围里的走老路）；
 *   - 数据专挑容易漏的：进了回收站的客户上的计划 / 待办、挂在别人客户上的我的计划、别人的、做完的、空串日历日、没排时间的待办、零点边上的；
 *     通知：已读的、别人的；
 *   - 不是企业版（软删那层不加）、在 看已删() 里（回收站里的照数）也一样；
 *   - 句数：热了以后，数角标(带通知) 只发 1 句，老实现 5 句；那一句认得出是只读的（企业版走只读通道，不挤写连接）。
 * 用拷出来的一份库、显式单连接（同 ent-customer-follow-feed-scope.test.ts），主连接的 query 事件计数。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-badge-one-"));
  fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db"), path.join(dir, "A.db"));
  if (fs.existsSync(path.resolve(__dirname, "../prisma/test.db-wal"))) fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db-wal"), path.join(dir, "A.db-wal"));
  return { dir, 开: false, 句: [] as string[] };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@/generated/prisma");
  const { 加上限定 } = await import("@/lib/team-scope");
  const raw = new PrismaClient<import("@/generated/prisma").Prisma.PrismaClientOptions>({ datasourceUrl: `file:${path.join(临时.dir, "A.db")}?connection_limit=1`, log: [{ emit: "event", level: "query" }] });
  (raw as unknown as { $on: (e: string, f: (x: { query: string }) => void) => void }).$on("query", (e) => { if (临时.开) 临时.句.push(e.query); });
  return { prisma: 加上限定(raw), defaultClient: raw };
});

import { defaultClient as raw } from "@/lib/prisma";
import { 等日志齐 } from "./query-log";
import { 看全部, 读的我 } from "@/lib/team-scope";
import { 看已删 } from "@/lib/enterprise/soft-delete-core";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 今天界线 } from "@/lib/reminders";
import { 数角标, 数提醒, 照数 } from "@/lib/reminders-db";
import { 未读通知数 } from "@/lib/enterprise/notify";
import { 只读SQL } from "@/lib/read-pool";

const 现在 = new Date(2026, 9, 10, 9, 30);

/** 改前的 数提醒（原样）+ layout 里另调的 未读通知数 */
async function 老实现(ownerId: string, 带通知: boolean, now: Date) {
  const 读 = await 读的我(raw);
  const 恒真 = !读 || (typeof 读 === "string" ? 读 === ownerId : 读.includes(ownerId));
  const 数 = await (恒真 ? 看全部(() => 照数(ownerId, now)) : 照数(ownerId, now));
  return { ...数, 通知未读: 带通知 ? await 未读通知数(ownerId) : undefined };
}

// 销售 A、B（A 的上级是销售管理）、总管理、管理员（只读）、市场管理、没有组织行的人
const 人们 = { 销售A: "bdg_a", 销售B: "bdg_b", 销售管理: "bdg_mgr", 总管理: "bdg_dir", 管理员: "bdg_admin", 市场管理: "bdg_mkt", 没组织: "bdg_none" } as const;
const 全部人 = Object.values(人们);

beforeAll(async () => {
  process.env.CRM_ENTERPRISE = "1";
  delete process.env.DESKTOP_LOCAL;
  for (const t of ["EntNotice", "EntFollowUpMeta", "EntBlocker", "FollowUpProject", "ProjectMember", "ProjectContact", "ProjectCustomer", "ContactCustomer", "ContactMethod", "Attachment", "ProjectNodeLog", "Project", "AiConversation", "AiProject", "Setting", "AuditLog", "ImportBatch", "Task", "FollowPlan", "FollowUpSource", "FollowUp", "ContractOwner", "Contract", "Opportunity", "Contact", "UnassignedContact", "Lead", "CustomerPool", "CustomerClaim", "EntMember", "EntDept"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  await raw.$executeRawUnsafe('UPDATE "Customer" SET referrerCustomerId = NULL, attributionCustomerId = NULL');
  for (const t of ["Customer", "Channel", "User"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  for (const id of 全部人) await raw.user.create({ data: { id, email: `${id}@x.com`, name: id, password: "x", role: "SALES" } });
  await raw.entMember.createMany({ data: [
    { userId: 人们.销售A, managerId: 人们.销售管理 }, { userId: 人们.销售B }, { userId: 人们.销售管理, bizRole: "sales_mgr" },
    { userId: 人们.总管理, bizRole: "director" }, { userId: 人们.管理员, bizRole: "admin" }, { userId: 人们.市场管理, bizRole: "marketing_mgr" },
  ] });
  await raw.setting.upsert({ where: { key: 规则.按组织看客户.key }, update: { value: "true" }, create: { key: 规则.按组织看客户.key, value: "true" } });

  const { 今天开始, 明天开始, 今天串 } = 今天界线(现在);
  const 时 = (h: number) => new Date(今天开始.getTime() + h * 3_600_000);
  const 昨天串 = "2026-10-09", 明天串 = "2026-10-11";
  let 号 = 0;
  for (const 我 of 全部人) {
    const 客户 = (n: string, owner = 我) => raw.customer.create({ data: { name: `QA-${n}`, phone: `13900${String(++号).padStart(6, "0")}`, salesOwnerId: owner } }).then((c) => c.id);
    const 自己的 = await 客户(`${我}的客户`);
    const 删了的 = await 客户(`${我}删了的客户`);
    // 挂在别人客户上、负责人是我的（钩子那句「负责人在范围里 OR 客户看得到」靠前一半放行）
    const 别人的客户 = await 客户(`${我}挂在别人名下`, 我 === 人们.销售B ? 人们.销售A : 人们.销售B);
    const 计划: [Date, string | null, boolean?][] = [
      [时(-30), null], [时(-1), null], [今天开始, null], [时(10), null], [new Date(明天开始.getTime() - 1), null], [明天开始, null], [时(50), null],
      [时(30), 昨天串], [时(-30), 今天串], [时(-30), 明天串],
      [时(-5), ""], [时(5), ""], [时(40), ""],
      [时(-30), null, true], [时(5), 今天串, true],
    ];
    const 待办: [Date | null, string | null, boolean?][] = [
      [null, null], [null, 今天串], [null, 昨天串],
      [时(-30), null], [今天开始, null], [时(23), null], [明天开始, null],
      [时(30), 昨天串], [时(-30), 今天串], [时(-30), 明天串],
      [时(-5), ""], [时(5), ""],
      [时(-30), null, true],
    ];
    // 每人的量错开一点（别人的数不会凑巧和我的一样）
    const 份 = 全部人.indexOf(我) % 3;
    for (const [i, [plannedAt, plannedOn, done]] of 计划.entries()) {
      if (i % 3 === 份 && i > 2) continue;
      for (const c of [自己的, 删了的, ...(i % 2 ? [别人的客户] : [])]) await raw.followPlan.create({ data: { subject: "计划", plannedAt, plannedOn, done: !!done, customerId: c, ownerId: 我 } });
    }
    for (const [i, [dueAt, dueOn, done]] of 待办.entries()) {
      if (i % 3 === 份 && i > 2) continue;
      for (const c of [自己的, 删了的, ...(i % 2 ? [] : [别人的客户])]) await raw.task.create({ data: { title: "待办", dueAt, dueOn, done: !!done, customerId: c, ownerId: 我 } });
    }
    await raw.customer.update({ where: { id: 删了的 }, data: { deletedAt: new Date() } });
    for (let i = 0; i < 2 + 份; i++) await raw.entNotice.create({ data: { userId: 我, kind: "分配", title: `未读${i}`, dedupeKey: `${我}-u${i}` } });
    await raw.entNotice.create({ data: { userId: 我, kind: "分配", title: "已读", dedupeKey: `${我}-r`, readAt: new Date() } });
  }
  忘掉企业版范围();
});

beforeEach(() => {
  process.env.CRM_ENTERPRISE = "1";
  忘掉企业版范围();
});

afterAll(async () => {
  delete process.env.CRM_ENTERPRISE;
  忘掉企业版范围();
  await raw.$disconnect();
  fs.rmSync(临时.dir, { recursive: true, force: true });
});

describe("数角标 和老实现（4 句 count + 未读通知数）逐项一样", () => {
  it("各业务角色数自己的、数别人的：逾期、今天、未读通知都一样", async () => {
    for (const 谁 of 全部人) {
      for (const 数谁 of 全部人) {
        for (const 带通知 of [true, false]) {
          const 新 = await 以谁的身份(谁, () => 数角标(数谁, 带通知, 现在));
          const 旧 = await 以谁的身份(谁, () => 老实现(数谁, 带通知, 现在));
          expect({ 谁, 数谁, 带通知, ...新 }).toEqual({ 谁, 数谁, 带通知, ...旧 });
        }
      }
      // 数提醒（首页问候用）= 数角标 去掉未读通知
      expect(await 以谁的身份(谁, () => 数提醒(谁, 现在))).toEqual(await 以谁的身份(谁, () => 老实现(谁, false, 现在)).then(({ 逾期, 今天 }) => ({ 逾期, 今天 })));
    }
  });

  it("钉一下绝对值：删了的客户上的不算、挂在别人客户上的算、别人的不算（免得两边一起错还对得上）", async () => {
    const 新 = await 以谁的身份(人们.销售A, () => 数角标(人们.销售A, true, 现在));
    expect(新.通知未读).toBe(2);
    // 只留自己客户 + 别人客户上的，删了的客户那份不算：比 看已删 里数的少
    const 连删了的 = await 以谁的身份(人们.销售A, () => 看已删(() => 数角标(人们.销售A, true, 现在)));
    expect(连删了的.逾期).toBeGreaterThan(新.逾期);
    expect(连删了的.今天).toBeGreaterThan(新.今天);
    expect(新.逾期).toBeGreaterThan(0);
    expect(新.今天).toBeGreaterThan(0);
  });

  it("在 看已删() 里（回收站里的客户上的照数）、不是企业版（没有软删那层）：也和老实现一样", async () => {
    for (const 谁 of [人们.销售A, 人们.总管理, 人们.没组织]) {
      const 新 = await 以谁的身份(谁, () => 看已删(() => 数角标(谁, true, 现在)));
      const 旧 = await 以谁的身份(谁, () => 看已删(() => 老实现(谁, true, 现在)));
      expect({ 谁, ...新 }).toEqual({ 谁, ...旧 });
    }
    delete process.env.CRM_ENTERPRISE;
    try {
      for (const 谁 of [人们.销售A, 人们.销售B]) {
        const 新 = await 数角标(谁, true, 现在);
        const 旧 = await 老实现(谁, true, 现在);
        expect({ 谁, ...新 }).toEqual({ 谁, ...旧 });
        // 非企业版不滤回收站：和企业版 看已删 里数的一样
        process.env.CRM_ENTERPRISE = "1";
        忘掉企业版范围();
        const 连删 = await 以谁的身份(谁, () => 看已删(() => 数角标(谁, true, 现在)));
        delete process.env.CRM_ENTERPRISE;
        expect({ 逾期: 新.逾期, 今天: 新.今天 }).toEqual({ 逾期: 连删.逾期, 今天: 连删.今天 });
      }
    } finally {
      process.env.CRM_ENTERPRISE = "1";
    }
  });

  it("句数：热了以后数角标(带通知) 1 句（只读通道认得出），老实现 5 句", async () => {
    for (const 谁 of [人们.销售A, 人们.销售管理, 人们.总管理]) {
      await 以谁的身份(谁, () => 数角标(谁, true, 现在));
      await 以谁的身份(谁, () => 老实现(谁, true, 现在));
      // query 日志可能比结果晚到（见 tests/query-log.ts）：开开关后先等齐再清空，跑完、关开关前再等齐才数
      临时.句 = []; 临时.开 = true; await 等日志齐(raw, 临时.句); 临时.句 = [];
      try { await 以谁的身份(谁, () => 数角标(谁, true, 现在)); await 等日志齐(raw, 临时.句); } finally { 临时.开 = false; }
      const 新句 = 临时.句;
      临时.句 = []; 临时.开 = true; await 等日志齐(raw, 临时.句); 临时.句 = [];
      try { await 以谁的身份(谁, () => 老实现(谁, true, 现在)); await 等日志齐(raw, 临时.句); } finally { 临时.开 = false; }
      const 旧句 = 临时.句;
      expect({ 谁, 新: 新句.length }).toEqual({ 谁, 新: 1 });
      expect(只读SQL(新句[0])).toBe(true);
      expect({ 谁, 旧: 旧句.length }).toEqual({ 谁, 旧: 5 });
    }
  });
});
