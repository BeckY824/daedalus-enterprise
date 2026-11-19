/**
 * 企业版客户名称选填（11-19 复审第 1 条）：三态的几条通知里叫没全称的客户不出「」——
 * 每日提醒汇总、代选继续持有、让同事结束项目、已回公海。称呼同其他通知（通知里的客户名：全称空着兜简称 → 客户编号）。
 * 搭法照 ent-tri-state-actions.test.ts，日子都是改出来的。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 继续持有, 让同事结束项目动作 } from "@/lib/enterprise/tri-state-hold";
import { 三态夜扫, 收三态客户 } from "@/lib/enterprise/tri-state-db";
import { 已回公海通知, 钟上三态提醒 } from "@/lib/enterprise/tri-state-notice";
import { 读组织 } from "@/lib/enterprise/org";
import { 默认组织规则, 默认三态规则, type 组织规则 } from "@/lib/project/org-rules";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 加天 } from "@/lib/enterprise/tri-state";

const 起 = "2026-11-01";
const 第 = (n: number) => new Date(`${加天(起, n)}T10:00:00+08:00`);
const 开三态: 组织规则 = { ...默认组织规则, 三态: { ...默认三态规则, 开: true } };

const 人 = {} as Record<"乙" | "丙" | "甲" | "总内", { id: string; name: string }>;
let 客户: string;
const 标题们 = async (userId: string) => (await prisma.entNotice.findMany({ where: { userId }, select: { title: true, body: true } })).map((n) => `${n.title}\n${n.body ?? ""}`).join("\n");

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  for (const k of ["乙", "丙", "甲", "总内"] as const) {
    const u = await prisma.user.create({ data: { email: k, name: k, title: "", role: "SALES", password: "x" } });
    人[k] = { id: u.id, name: u.name };
  }
  await prisma.entMember.createMany({
    data: [
      { userId: 人.乙.id, bizRole: "sales", line: "内贸", managerId: 人.甲.id },
      { userId: 人.丙.id, bizRole: "sales", line: "内贸", managerId: 人.甲.id },
      { userId: 人.甲.id, bizRole: "sales_mgr", line: "内贸" },
      { userId: 人.总内.id, bizRole: "director", line: "内贸" },
    ],
  });
  客户 = (await prisma.customer.create({ data: { name: "", customerNo: 12, phone: "13800000001", salesOwnerId: 人.乙.id, createdAt: new Date("2026-10-01T10:00:00+08:00") } })).id;
  await setSetting("business", { projectMode: true });
  await setSetting("orgRules", 开三态);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("三态通知里叫没全称的客户（复审 11-19 第 1 条）", () => {
  it("收三态客户带出简称、客户编号", async () => {
    const org = await 读组织();
    const c = (await 收三态客户(prisma, [客户], 开三态, org, 第(1))).get(客户)!;
    expect(c).toMatchObject({ name: "", shortName: null, customerNo: 12 });
  });

  it("每日待回收提醒：汇总里叫「客户 NO.00012」，不出「」", async () => {
    // 00:05 那遍改状态，08:00 那遍发提醒（同 ent-tri-state-notice.test.ts）
    await 三态夜扫(new Date(`${加天(起, 180)}T00:10:00+08:00`));
    await 钟上三态提醒(new Date(`${加天(起, 180)}T08:10:00+08:00`));
    const 记 = await 标题们(人.乙.id);
    expect(记).toContain("客户 NO.00012");
    expect(记).not.toContain("「」");
  });

  it("直属上级代选继续持有：通知原负责人的标题叫客户编号；有简称叫简称", async () => {
    expect(await 继续持有(人.甲, 客户, null, 第(120))).toMatchObject({ ok: true });
    const 记 = await 标题们(人.乙.id);
    expect(记).toContain("「客户 NO.00012」由 甲 代选了继续持有");
    expect(记).not.toContain("「」");
  });

  it("有简称的叫简称", async () => {
    await prisma.customer.update({ where: { id: 客户 }, data: { shortName: "编的简称" } });
    expect(await 继续持有(人.甲, 客户, null, 第(120))).toMatchObject({ ok: true });
    expect(await 标题们(人.乙.id)).toContain("「编的简称」由 甲 代选了继续持有");
  });

  it("让同事结束项目：通知同事的标题叫客户编号", async () => {
    await prisma.project.create({ data: { name: "同事的项目", customerId: 客户, ownerId: 人.丙.id, creatorId: 人.丙.id, createdAt: new Date("2026-10-20T10:00:00+08:00") } });
    await 三态夜扫(第(180));
    await prisma.entCustomerClock.update({ where: { customerId: 客户 }, data: { noticeCount: 3, lastNoticeDay: 加天(起, 200) } });
    await 三态夜扫(第(210));
    expect(await 让同事结束项目动作(人.总内, 客户, 第(210))).toMatchObject({ ok: true });
    const 记 = await 标题们(人.丙.id);
    expect(记).toContain("「客户 NO.00012」到期该回公海");
    expect(记).not.toContain("「」");
  });

  it("已回公海：原负责人、第 2 次起抄送上级的标题都叫客户编号", async () => {
    const org = await 读组织();
    await 已回公海通知([{ id: 客户, name: "", shortName: null, customerNo: 12, 原负责人: 人.乙.id, 第几次: 2, bizLine: "内贸" }], org, 加天(起, 210));
    expect(await 标题们(人.乙.id)).toContain("「客户 NO.00012」即将回收阶段期满没人处理");
    expect(await 标题们(人.甲.id)).toContain("下属的客户「客户 NO.00012」第 2 次被自动收回");
    expect([await 标题们(人.乙.id), await 标题们(人.甲.id)].join("\n")).not.toContain("「」");
  });
});
