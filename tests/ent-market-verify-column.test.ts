/**
 * 市场视角项目列表的「验证结果」（客户 11-05（X-09））：
 *   - 判无效的写「叫法 · 无效原因」（初验无效 / 终验无效 / 无效线索）；判有效的只写叫法，当初的无效原因不挂
 *   - 悬停全文（验证全文）：每一步一行，哪天 谁 · 哪步 · 判定（无效原因；说明），按时间先后
 *   - 建的人（市场成员）和他的实线上级（市场管理）在列表里看到的一样
 *   - 纯函数：验证摘要、痕一行
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "a@x", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/shared-ws/current", () => ({ 当前是共享区: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 读项目列表, 验证摘要, 痕一行 } from "@/lib/project/list";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 市场成员key } from "@/lib/enterprise/market";

let 主管: string, 小市: string, 小王: string;
let 序 = 0;
const 人 = async (name: string, role = "SALES") => (await prisma.user.create({ data: { email: `${name}@t`, name, title: "", role, password: "x" } })).id;
async function 线索(名: string, 负责: string, 建的: string) {
  序++;
  const c = (await prisma.customer.create({ data: { name: `${名}客户`, phone: `1390000${String(序).padStart(4, "0")}`, salesOwnerId: 负责 } })).id;
  return (await prisma.project.create({ data: { name: 名, customerId: c, ownerId: 负责, creatorId: 建的, phase: "线索", node: "线索验证" } })).id;
}
const 看列表 = (id: string) => {
  mocks.user = { ...mocks.user, id, name: id };
  return 以谁的身份(id, () => 读项目列表(mocks.user, {}));
};
const 行of = (r: Awaited<ReturnType<typeof 读项目列表>>, 名: string) => r.行.find((x) => x.name === 名);

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  序 = 0;
  主管 = await 人("主管");
  小市 = await 人("小市");
  小王 = await 人("小王");
  await prisma.entMember.createMany({
    data: [
      { userId: 主管, bizRole: "marketing_mgr" },
      { userId: 小市, bizRole: "channel_ops", managerId: 主管 },
      { userId: 小王, bizRole: "sales" },
    ],
  });
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("enterprise.rule.org_scope", true);
  await setSetting(市场成员key, [小市]);
  忘掉企业版范围();
});
afterEach(() => { vi.unstubAllEnvs(); invalidateSettingsCache(); });

describe("纯函数", () => {
  it("验证摘要：判无效的三个叫法带原因，别的只写叫法；原因空白当没有", () => {
    expect(验证摘要("初验无效", "联系方式无效")).toBe("初验无效 · 联系方式无效");
    expect(验证摘要("终验无效", " 不是决策人 ")).toBe("终验无效 · 不是决策人");
    expect(验证摘要("无效线索", "同行")).toBe("无效线索 · 同行");
    expect(验证摘要("有效线索", "联系方式无效")).toBe("有效线索");
    expect(验证摘要("复核有效", "联系方式无效")).toBe("复核有效");
    expect(验证摘要("初验无效", "  ")).toBe("初验无效");
    expect(验证摘要("初验无效", null)).toBe("初验无效");
  });

  it("痕一行：哪天 谁 · 哪步 · 判定（无效原因；说明），没原因没说明就不带括号", () => {
    const at = new Date("2026-11-03T10:00:00+08:00");
    expect(痕一行({ step: "销售初判", verdict: "无效", reason: "联系方式无效", note: "打了三次", 谁: "小王", at })).toBe("2026-11-03 小王 · 负责人初判 · 无效（无效原因：联系方式无效；打了三次）");
    expect(痕一行({ step: "市场复核", verdict: "有效", reason: null, note: null, 谁: "主管", at })).toBe("2026-11-03 主管 · 管理员复核 · 有效");
  });
});

describe("市场视角列表的验证结果（X-09）", () => {
  it("建的人和实线上级都看到「初验无效 · 原因」，悬停全文一步一行、按时间先后", async () => {
    const 甲 = await 线索("甲线索", 小王, 小市);
    await prisma.entLeadVerify.create({ data: { projectId: 甲, verdict: "初验无效", pending: "市场复核", invalidReason: "联系方式无效" } });
    await prisma.entLeadVerifyLog.createMany({
      data: [
        { projectId: 甲, step: "销售初判", verdict: "还需培育", note: "下月再问", userId: 小王, at: new Date("2026-11-01T09:00:00+08:00") },
        { projectId: 甲, step: "销售初判", verdict: "无效", reason: "联系方式无效", note: "打了三次", userId: 小王, at: new Date("2026-11-04T09:00:00+08:00") },
      ],
    });
    const 全文 = "2026-11-01 小王 · 负责人初判 · 还需培育（下月再问）\n2026-11-04 小王 · 负责人初判 · 无效（无效原因：联系方式无效；打了三次）";
    for (const 谁 of [小市, 主管]) {
      const r = 行of(await 看列表(谁), "甲线索");
      expect(r).toMatchObject({ 验证结果: "初验无效 · 联系方式无效", 验证全文: 全文 });
    }
  });

  it("走完复核判死：无效线索 · 原因，全文里有复核那一步；判有效的不挂原因；没走过验证的线索 = 暂未验证、没有全文", async () => {
    const 乙 = await 线索("乙线索", 小王, 小市);
    await prisma.entLeadVerify.create({ data: { projectId: 乙, verdict: "无效线索", finalResult: "无效线索", invalidReason: "同行" } });
    await prisma.entLeadVerifyLog.createMany({
      data: [
        { projectId: 乙, step: "销售初判", verdict: "无效", reason: "同行", userId: 小王, at: new Date("2026-11-02T09:00:00+08:00") },
        { projectId: 乙, step: "市场复核", verdict: "无效", note: "核实是同行", userId: 主管, at: new Date("2026-11-03T09:00:00+08:00") },
      ],
    });
    const 丙 = await 线索("丙线索", 小王, 小市);
    await prisma.entLeadVerify.create({ data: { projectId: 丙, verdict: "有效线索", finalResult: "有效线索", invalidReason: "联系方式无效" } });
    await prisma.entLeadVerifyLog.create({ data: { projectId: 丙, step: "总管理终判", verdict: "有效", userId: 主管, at: new Date("2026-11-05T09:00:00+08:00") } });
    await 线索("丁线索", 小王, 小市);

    const 列表 = await 看列表(小市);
    expect(行of(列表, "乙线索")).toMatchObject({
      验证结果: "无效线索 · 同行",
      验证全文: "2026-11-02 小王 · 负责人初判 · 无效（无效原因：同行）\n2026-11-03 主管 · 管理员复核 · 无效（核实是同行）",
    });
    expect(行of(列表, "丙线索")).toMatchObject({ 验证结果: "有效线索", 验证全文: "2026-11-05 主管 · 管理员最终确认 · 有效" });
    expect(行of(列表, "丁线索")).toMatchObject({ 验证结果: "暂未验证", 验证全文: null });
  });

  it("不是市场视角（销售本人）：不给验证结果、也不给全文", async () => {
    const 甲 = await 线索("甲线索", 小王, 小市);
    await prisma.entLeadVerify.create({ data: { projectId: 甲, verdict: "初验无效", pending: "市场复核", invalidReason: "联系方式无效" } });
    await prisma.entLeadVerifyLog.create({ data: { projectId: 甲, step: "销售初判", verdict: "无效", reason: "联系方式无效", userId: 小王 } });
    const r = 行of(await 看列表(小王), "甲线索");
    expect(r).toBeDefined();
    expect(r?.验证结果).toBeUndefined();
    expect(r?.验证全文).toBeUndefined();
  });
});
