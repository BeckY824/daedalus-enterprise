/**
 * 重复咨询线索的验证时限（P-线索-05，lib/project/lead-verify-timeout.ts）：
 * 等市场复核 / 销售终验 / 总管理终判满 1 小时提醒被等的人，再 30 分钟按上一步判定自动落定；
 * 夜里、周末顺延到下一工作日 08:00 重新计时；只管重复咨询线索；销售认领不走；已判了的不再落定。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 销售初判, 市场复核, 销售终验, 总管理终判, 到期落定话, 到期落定, 读线索验证 } from "@/lib/project/lead-verify";
import * as 状态自动 from "@/lib/enterprise/cust-status-auto-db";
import { 验证时限扫一遍, 验证时限通知种类, 起钟时刻 } from "@/lib/project/lead-verify-timeout";
import { 待补数们 } from "@/lib/enterprise/invalid-makeup";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 验证时限生效key } from "@/lib/project/lead-verify-timeout";
import { 超时转生效key } from "@/lib/enterprise/reply-overdue";
import { 月份 } from "@/lib/enterprise/lead-assign";
import { 记有效沟通 } from "./helpers/ent-valid-followup";

type 人 = { id: string; role: string };
// 北京 2026-12-02（周三）10:00 = 02:00Z；每个时刻都按北京写
const 京 = (s: string) => new Date(`${s}:00+08:00`);

describe("重复咨询线索的验证时限", () => {
  let 老板: 人, 总管: 人, 市场: 人, 乙: 人;
  let 客户: string;

  async function 建人(email: string, role: string) {
    const u = await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } });
    return { id: u.id, role };
  }
  const 项目 = async (补: Record<string, unknown> = {}) =>
    (await prisma.project.create({ data: { name: "重复咨询项", customerId: 客户, ownerId: 乙.id, creatorId: 市场.id, node: "线索验证", source: "repeat-inquiry", ...补 } })).id;
  const 现 = (id: string) => prisma.project.findUniqueOrThrow({ where: { id } });
  const 状态 = (id: string) => prisma.entLeadVerify.findUniqueOrThrow({ where: { projectId: id } });
  const 痕 = (id: string) => prisma.entLeadVerifyLog.findMany({ where: { projectId: id }, orderBy: { at: "asc" } });
  const 提醒数 = (userId: string) => prisma.entNotice.count({ where: { userId, kind: 验证时限通知种类, title: { startsWith: "线索验证待处理" } } });
  const 初判无效于 = (id: string, 时: Date) => 销售初判(乙, id, "无效", { invalidReason: "联系方式无效", verifyNote: "打了三次" }, 时);

  // 通知的 createdAt 是真实时钟，钟上读它当「提醒发出的时刻」：每扫一遍把这一遍新记的通知改成模拟的那一刻
  const 扫 = async (时: Date) => {
    const 旧 = new Set((await prisma.entNotice.findMany({ select: { id: true } })).map((n) => n.id));
    const r = await 验证时限扫一遍(时);
    const 新 = (await prisma.entNotice.findMany({ select: { id: true } })).map((n) => n.id).filter((i) => !旧.has(i));
    if (新.length) await prisma.entNotice.updateMany({ where: { id: { in: 新 } }, data: { createdAt: 时 } });
    return r;
  };

  beforeEach(async () => {
    await resetDb();
    invalidateSettingsCache();
    // 两个生效时刻都放到用例之前（只认生效后进入这一步的）；要测生效时刻的用例自己改
    await setSetting(超时转生效key, "2026-01-01T00:00:00.000Z");
    await setSetting(验证时限生效key, "2026-01-01T00:00:00.000Z");
    vi.stubEnv("CRM_ENTERPRISE", "1");
    老板 = await 建人("boss", "ADMIN");
    总管 = await 建人("director", "SALES");
    市场 = await 建人("mkt", "SALES");
    乙 = await 建人("yi", "SALES");
    await prisma.entMember.createMany({
      data: [
        { userId: 老板.id, bizRole: "director" },
        { userId: 总管.id, bizRole: "director" },
        { userId: 市场.id, bizRole: "marketing_mgr" },
        { userId: 乙.id, bizRole: "sales" },
      ],
    });
    客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "", salesOwnerId: 乙.id, contacts: { create: { name: "甲联系人", phone: "13900001234", isPrimary: true } } } })).id;
  });
  afterEach(() => { vi.unstubAllEnvs(); invalidateSettingsCache(); });

  it("等市场复核：1 小时提醒、1 小时 30 分按无效落定，记待补、写来源、通知被等的人和发起人", async () => {
    const id = await 项目();
    await prisma.entLeadAssign.create({ data: { projectId: id, toUserId: 乙.id, byUserId: 市场.id, month: 月份() } });
    await 初判无效于(id, 京("2026-12-02 10:00"));
    expect((await 扫(京("2026-12-02 10:59")))).toEqual({ 提醒: 0, 落定: 0, 没落成: 0 });
    expect((await 扫(京("2026-12-02 11:00"))).提醒).toBe(1);
    expect(await 提醒数(市场.id)).toBe(1);
    // 同一分钟再扫不重发
    expect((await 扫(京("2026-12-02 11:00"))).提醒).toBe(0);
    expect((await 扫(京("2026-12-02 11:29"))).落定).toBe(0);
    expect((await 现(id)).result).toBeNull();
    expect((await 扫(京("2026-12-02 11:30"))).落定).toBe(1);
    const p = await 现(id);
    expect(p.result).toBe("线索流失");
    expect(await 状态(id)).toMatchObject({ verdict: "无效线索", finalResult: "无效线索", pending: null });
    expect(((await 痕(id)).at(-1)?.note) ?? "").toContain(到期落定话);
    const 节点痕 = await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId: id }, orderBy: { at: "desc" } });
    expect(节点痕.reason).toContain(到期落定话);
    // 原因像系统自己落的，不像市场复核的人判的（建议 5）
    expect(节点痕.reason).toContain("等市场复核超过时限，按上一步判定无效");
    expect(节点痕.reason).not.toContain("市场复核判无效");
    // 验证时间线里这一行的人显示「系统」，不是「已不在的成员」（必改 4）
    const 详 = await 读线索验证(老板, await 现(id));
    expect(详?.痕.at(-1)?.谁).toBe("系统");
    expect((await 待补数们([乙.id])).get(乙.id) ?? 0).toBe(1);
    for (const u of [市场.id, 乙.id]) {
      expect(await prisma.entNotice.count({ where: { userId: u, kind: 验证时限通知种类, title: { startsWith: "线索验证已自动落定" } } })).toBe(1);
    }
    // 落定后不再动
    expect(await 扫(京("2026-12-02 12:30"))).toEqual({ 提醒: 0, 落定: 0, 没落成: 0 });
  });

  it("夜里进入的顺延：22:30 进入，次日 08:00 重新计时，09:00 提醒、09:30 落定", async () => {
    const id = await 项目();
    await 初判无效于(id, 京("2026-12-02 22:30"));
    expect(await 扫(京("2026-12-02 23:45"))).toEqual({ 提醒: 0, 落定: 0, 没落成: 0 });
    expect(await 扫(京("2026-12-03 08:59"))).toEqual({ 提醒: 0, 落定: 0, 没落成: 0 });
    expect((await 扫(京("2026-12-03 09:00"))).提醒).toBe(1);
    expect((await 扫(京("2026-12-03 09:29"))).落定).toBe(0);
    expect((await 扫(京("2026-12-03 09:30"))).落定).toBe(1);
    expect((await 现(id)).result).toBe("线索流失");
  });

  it("周五晚进入的顺延到下周一 08:00", async () => {
    const id = await 项目();
    await 初判无效于(id, 京("2026-12-04 21:30"));
    expect((await 扫(京("2026-12-05 11:00"))).提醒).toBe(0); // 周六不执行
    expect((await 扫(京("2026-12-07 08:30"))).提醒).toBe(0);
    expect((await 扫(京("2026-12-07 09:00"))).提醒).toBe(1);
  });

  it("提醒后 30 分钟落在夜里：不顺延着落定，次日 09:00 再提醒、09:30 才落定", async () => {
    const id = await 项目();
    await 初判无效于(id, 京("2026-12-02 20:45"));
    expect((await 扫(京("2026-12-02 21:45"))).提醒).toBe(1);
    expect((await 扫(京("2026-12-02 22:15"))).落定).toBe(0);
    expect((await 扫(京("2026-12-03 09:00"))).提醒).toBe(1);
    expect((await 扫(京("2026-12-03 09:29"))).落定).toBe(0);
    expect((await 扫(京("2026-12-03 09:30"))).落定).toBe(1);
  });

  it("等销售终验：复核判有效后 1 小时提醒负责人，1 小时 30 分按接受复核落定", async () => {
    const id = await 项目();
    await 初判无效于(id, 京("2026-12-02 09:00"));
    expect((await 市场复核(市场, id, true)).ok).toBe(true);
    await prisma.entLeadVerify.update({ where: { projectId: id }, data: { reviewedAt: 京("2026-12-02 10:00") } });
    await 记有效沟通(id);
    expect((await 扫(京("2026-12-02 11:00"))).提醒).toBe(1);
    expect(await 提醒数(乙.id)).toBe(1);
    const r = await 扫(京("2026-12-02 11:30"));
    expect(r.落定).toBe(1);
    expect((await 现(id)).node).toBe("线索推进");
    expect(await 状态(id)).toMatchObject({ verdict: "有效线索", salesAck: "接受复核", pending: null });
  });

  it("等总管理终判（销售提交异议）：从提交异议起钟，按无效落定", async () => {
    const id = await 项目();
    await 初判无效于(id, 京("2026-12-02 08:30"));
    await 市场复核(市场, id, true);
    await 销售终验(乙, id, false, "坚持无效");
    await prisma.entLeadVerify.update({ where: { projectId: id }, data: { ackedAt: 京("2026-12-02 10:00") } });
    expect((await 扫(京("2026-12-02 11:00"))).提醒).toBe(2);
    expect(await 提醒数(总管.id)).toBe(1);
    expect(await 提醒数(老板.id)).toBe(1); // 总管理（系统管理员）都是被等的人
    expect(await 提醒数(乙.id)).toBe(0);
    expect((await 扫(京("2026-12-02 11:30"))).落定).toBe(1);
    expect((await 现(id)).result).toBe("线索流失");
    expect(await 状态(id)).toMatchObject({ verdict: "无效线索", pending: null });
  });

  it("非重复咨询的线索不走这个钟", async () => {
    const id = await 项目({ source: null });
    await 初判无效于(id, 京("2026-12-02 10:00"));
    expect(await 扫(京("2026-12-02 12:00"))).toEqual({ 提醒: 0, 落定: 0, 没落成: 0 });
    expect((await 现(id)).result).toBeNull();
    expect((await 状态(id)).pending).toBe("市场复核");
  });

  it("销售认领不走这个钟", async () => {
    const id = await 项目();
    await 初判无效于(id, 京("2026-12-02 08:00"));
    await 市场复核(市场, id, true);
    await 销售终验(乙, id, false, "坚持无效");
    expect((await 总管理终判(总管, id, true)).ok).toBe(true);
    expect((await 状态(id)).pending).toBe("销售认领");
    expect(await 扫(京("2026-12-02 15:00"))).toEqual({ 提醒: 0, 落定: 0, 没落成: 0 });
    expect((await 现(id)).result).toBeNull();
  });

  it("已经判了的不再落定：复核判了无效、复核判了有效后各自走自己的步", async () => {
    const a = await 项目({ name: "甲" });
    await 初判无效于(a, 京("2026-12-02 10:00"));
    await 市场复核(市场, a, false);
    const b = await 项目({ name: "乙" });
    await 初判无效于(b, 京("2026-12-02 10:00"));
    await 市场复核(市场, b, true);
    // b 已进入销售终验，起钟时刻是复核那一刻（现在），不是初判的 10:00，所以 2 小时后也不落定
    const 明细 = await 扫(京("2026-12-02 12:00"));
    expect(明细.落定).toBe(0);
    expect((await 状态(a)).verdict).toBe("无效线索");
  });

  it("起钟时刻读哪一列", () => {
    const v = { pending: null, verifiedAt: new Date(1), reviewedAt: new Date(2), ackedAt: new Date(3), salesAck: null };
    expect(起钟时刻("市场复核", v)).toEqual(new Date(1));
    expect(起钟时刻("销售终验", v)).toEqual(new Date(2));
    expect(起钟时刻("总管理终判", v)).toEqual(new Date(1));
    expect(起钟时刻("总管理终判", { ...v, salesAck: "提交异议" })).toEqual(new Date(3));
  });

  it("夜里不执行：22:00 以后扫什么都不做", async () => {
    const id = await 项目();
    await 初判无效于(id, 京("2026-12-02 19:00"));
    expect(await 扫(京("2026-12-02 23:00"))).toEqual({ 提醒: 0, 落定: 0, 没落成: 0 });
  });

  it("生效时刻：上线前就在等的不提醒不落定，上线后（生效时刻之后）进入的照常", async () => {
    await setSetting(验证时限生效key, 京("2026-12-02 10:30").toISOString());
    const 老 = await 项目();
    await 初判无效于(老, 京("2026-12-02 10:00"));
    const 新 = await 项目();
    await 初判无效于(新, 京("2026-12-02 11:00"));
    expect(await 扫(京("2026-12-02 11:20"))).toEqual({ 提醒: 0, 落定: 0, 没落成: 0 });
    expect((await 扫(京("2026-12-02 12:00"))).提醒).toBe(1);
    expect((await 扫(京("2026-12-02 12:30"))).落定).toBe(1);
    expect((await 现(新)).result).toBe("线索流失");
    expect((await 现(老)).result).toBeNull();
    expect(await 提醒数(市场.id)).toBe(1);
  });

  it("本钟第一遍扫记生效时刻（上线时刻）：之前就在等的都不算", async () => {
    await prisma.setting.deleteMany({ where: { key: 验证时限生效key } });
    invalidateSettingsCache();
    const 老 = await 项目();
    await 初判无效于(老, 京("2026-12-02 09:00"));
    expect(await 扫(京("2026-12-02 10:00"))).toEqual({ 提醒: 0, 落定: 0, 没落成: 0 });
    expect(await 扫(京("2026-12-02 11:00"))).toEqual({ 提醒: 0, 落定: 0, 没落成: 0 });
    expect(await 扫(京("2026-12-02 12:00"))).toEqual({ 提醒: 0, 落定: 0, 没落成: 0 });
    expect((await prisma.setting.findUnique({ where: { key: 验证时限生效key } }))?.value).toContain("2026-12-02T02:00:00.000Z");
    expect((await 现(老)).result).toBeNull();
  });

  it("超时转开关从关拨开（生效时刻重记成那一刻）：老的不落定", async () => {
    const 老 = await 项目();
    await 初判无效于(老, 京("2026-12-02 09:00"));
    await setSetting(超时转生效key, 京("2026-12-02 10:00").toISOString());
    expect(await 扫(京("2026-12-02 10:10"))).toEqual({ 提醒: 0, 落定: 0, 没落成: 0 });
    expect(await 扫(京("2026-12-02 11:30"))).toEqual({ 提醒: 0, 落定: 0, 没落成: 0 });
    expect((await 现(老)).result).toBeNull();
  });

  it("被等的人为空：不会每分钟回到提醒，按起钟 + 1.5 小时直接落定", async () => {
    const id = await 项目();
    await 初判无效于(id, 京("2026-12-02 10:00"));
    await prisma.entMember.deleteMany({ where: { userId: { in: [老板.id, 总管.id, 市场.id] } } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await 扫(京("2026-12-02 11:00"))).提醒).toBe(0);
    expect((await 扫(京("2026-12-02 11:29"))).落定).toBe(0);
    expect((await 现(id)).result).toBeNull();
    const r = await 扫(京("2026-12-02 11:30"));
    expect(r.落定).toBe(1);
    expect((await 现(id)).result).toBe("线索流失");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it("销售终验到期：系统代推，节点变更的操作人是系统、验证痕是系统，不写必填拦截（必改 2）", async () => {
    const id = await 项目();
    await 初判无效于(id, 京("2026-12-02 09:00"));
    expect((await 市场复核(市场, id, true)).ok).toBe(true);
    await prisma.entLeadVerify.update({ where: { projectId: id }, data: { reviewedAt: 京("2026-12-02 10:00") } });
    await 记有效沟通(id);
    await 扫(京("2026-12-02 11:00"));
    expect((await 扫(京("2026-12-02 11:30"))).落定).toBe(1);
    const 节点痕 = await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId: id }, orderBy: { at: "desc" } });
    expect(节点痕.userId).toBe("system");
    expect(((await 痕(id)).at(-1))).toMatchObject({ step: "销售终验", userId: "system", note: 到期落定话 });
    expect(await prisma.entRequiredBlock.count()).toBe(0);
    expect((await 读线索验证(老板, await 现(id)))?.痕.at(-1)?.谁).toBe("系统");
  });

  it("销售终验到期被拦（缺沟通 / 必填）：只通知负责人一次、不写必填拦截、下一分钟不重试（必改 2）", async () => {
    const id = await 项目();
    await 初判无效于(id, 京("2026-12-02 09:00"));
    await 市场复核(市场, id, true);
    await prisma.entLeadVerify.update({ where: { projectId: id }, data: { reviewedAt: 京("2026-12-02 10:00") } });
    // 不补有效沟通：推进关拦着
    await 扫(京("2026-12-02 11:00"));
    const r = await 扫(京("2026-12-02 11:30"));
    expect(r).toMatchObject({ 落定: 0, 没落成: 1 });
    const 卡 = (u: string) => prisma.entNotice.count({ where: { userId: u, kind: 验证时限通知种类, title: { startsWith: "线索验证到期没能自动落定" } } });
    expect(await 卡(乙.id)).toBe(1);
    expect(await 卡(老板.id)).toBe(0);
    expect(await prisma.entRequiredBlock.count()).toBe(0);
    expect((await 现(id)).node).toBe("线索验证");
    expect(await 状态(id)).toMatchObject({ pending: "销售终验" });
    // 下一分钟、再下一分钟：不重试、不重发
    for (const t of ["11:31", "11:32", "12:30"]) expect(await 扫(京(`2026-12-02 ${t}`))).toEqual({ 提醒: 0, 落定: 0, 没落成: 0 });
    expect(await 卡(乙.id)).toBe(1);
    expect((await 现(id)).node).toBe("线索验证");
  });

  it("待分配的线索不走到期落定（扫描查询带 awaitAssignAt: null）", async () => {
    const id = await 项目({ awaitAssignAt: 京("2026-12-02 08:00") });
    await 初判无效于(id, 京("2026-12-02 09:00")).catch(() => {});
    await prisma.entLeadVerify.upsert({ where: { projectId: id }, create: { projectId: id, verdict: "初验无效", pending: "市场复核", verifiedAt: 京("2026-12-02 10:00") }, update: { pending: "市场复核", verifiedAt: 京("2026-12-02 10:00") } });
    expect(await 扫(京("2026-12-02 12:00"))).toEqual({ 提醒: 0, 落定: 0, 没落成: 0 });
  });

  it("销售终验到期撞上销售同时提交异议：整笔回滚，项目不动、验证状态是总管理终判、没有系统的痕（必改 3）", async () => {
    const id = await 项目();
    await 初判无效于(id, 京("2026-12-02 09:00"));
    await 市场复核(市场, id, true);
    await 记有效沟通(id);
    const 原 = 状态自动.客户状态自动;
    let 动过 = false;
    const spy = vi.spyOn(状态自动, "客户状态自动").mockImplementation(async () => {
      if (!动过) { 动过 = true; expect((await 销售终验(乙, id, false, "坚持无效")).ok).toBe(true); }
      return 原();
    });
    const r = await 到期落定(id, "销售终验", 京("2026-12-02 11:30"));
    spy.mockRestore();
    expect(动过).toBe(true);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("已被别人判过");
    expect((r as { 卡住?: boolean }).卡住).toBe(false);
    expect((await 现(id)).node).toBe("线索验证");
    expect(await 状态(id)).toMatchObject({ pending: "总管理终判", salesAck: "提交异议" });
    expect((await 痕(id)).some((l) => l.userId === "system")).toBe(false);
    expect(await prisma.projectNodeLog.count({ where: { projectId: id, userId: "system" } })).toBe(0);
  });
});
