/**
 * 离职交接带走同事建的待分配项目（E-339，12-08）：通知建项目的同事「由接手人接手」，
 * 项目随客户转走后他常常看不到了，链到项目会报「没有找到这条记录」——看不到就不带链接，看得到照旧链项目。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 等通知推完 } from "@/lib/enterprise/notify";
import { 规则 } from "@/lib/enterprise/rules";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 离职带走待分配通知 } from "@/lib/enterprise/notice-sources";

let 上级: string, 离职: string, 接手: string, 同事: string;
let 号 = 0;
const 建人 = async (email: string, bizRole: string, managerId: string | null = null) => {
  const id = (await prisma.user.create({ data: { email, name: email, title: "", role: "SALES", password: "x" } })).id;
  await prisma.entMember.create({ data: { userId: id, bizRole, managerId } });
  return id;
};
/** 客户已在接手人名下，项目已转给接手人（交接写库之后的状态），建项目的是 creator */
async function 摆(creator: string) {
  const c = await prisma.customer.create({ data: { name: `客户${++号}`, phone: `1390000${String(号).padStart(4, "0")}`, salesOwnerId: 接手, followStatus: "待跟进" } });
  const p = await prisma.project.create({ data: { name: `项目${++号}`, customerId: c.id, ownerId: 接手, creatorId: creator } });
  return { c, p };
}
const 收到 = async (userId: string) => {
  await 等通知推完();
  return prisma.entNotice.findMany({ where: { userId, kind: "交接", dedupeKey: { startsWith: "offboard-awaiting:" } } });
};

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  号 = 0;
  await prisma.setting.create({ data: { key: 规则.按组织看客户.key, value: JSON.stringify(true) } });
  invalidateSettingsCache();
  忘掉企业版范围();
  上级 = await 建人("mgr", "sales_mgr");
  离职 = await 建人("leaver", "sales", 上级);
  接手 = await 建人("taker", "sales", 上级);
  同事 = await 建人("peer", "sales"); // 不在这条线上，接手后看不到
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("离职带走待分配通知：链接按收件人现在看不看得到项目", () => {
  it("看不到（项目已在接手人名下、他不在这条线上）：通知照发，不带链接", async () => {
    const { c, p } = await 摆(同事);
    await 离职带走待分配通知(离职, 接手, [{ id: p.id, 原: 同事, customerId: c.id }]);
    const 们 = await 收到(同事);
    expect(们).toHaveLength(1);
    expect(们[0].title).toContain("由 taker 接手");
    expect(们[0].link).toBeNull();
  });

  it("看得到（收件人是接手人的直属上级）：照旧链到项目", async () => {
    const { c, p } = await 摆(上级);
    await 离职带走待分配通知(离职, 接手, [{ id: p.id, 原: 上级, customerId: c.id }]);
    const 们 = await 收到(上级);
    expect(们).toHaveLength(1);
    expect(们[0].link).toBe(`/projects/${p.id}`);
  });

  it("带走多个、一个都看不到：不带链接", async () => {
    const a = await 摆(同事);
    const b = await 摆(同事);
    await 离职带走待分配通知(离职, 接手, [{ id: a.p.id, 原: 同事, customerId: a.c.id }, { id: b.p.id, 原: 同事, customerId: b.c.id }]);
    const 们 = await 收到(同事);
    expect(们).toHaveLength(1);
    expect(们[0].title).toContain("2 个待分配项目");
    expect(们[0].link).toBeNull();
  });
});
