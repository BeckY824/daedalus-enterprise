/**
 * 企业版三大阶段的门（10-26，lib/project/stage-gates.ts + mql.ts + db.ts 改节点 / 记项目沟通 / 按必填推进）。
 *   - 记沟通：要选项目当前阶段（11-05 起不再问客户是否明确回复）；一条沟通一行标记（EntFollowUpMark，迁移 055，replied 一律 false）
 *   - 有效线索要有效沟通（11-05）：「线索验证」节点配的必填项（不含有效沟通、线索验证结果）都齐，没配看需求状态选了没有；
 *     不满足推不过「线索验证」，手动、自动推进都拦
 *   - MQL 人工判：合格往前推到线索推进；不合格退回潜客培育 + 培育跟进计划（下一步时间 + 跟进计划）
 *   - 不是企业版：阶段不要，一行标记不写，越过线索验证不拦，MQL 判不了
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 改节点, 改项目, 记项目沟通, 终止进程, 删项目, 放回公海 } from "@/lib/project/db";
import { 判MQL } from "@/lib/project/mql";
import { 撤培育计划 } from "@/lib/project/nurture-plan";
import { 改项目 as 导入改项目, 读项目 as 导入读项目 } from "@/lib/enterprise-import/project-target";
import { 缺有效沟通还差, 记沟通阶段问题, 缺本节点沟通, 要沟通的节点 } from "@/lib/project/stage-gates";
import { 默认组织规则 } from "@/lib/project/org-rules";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { dayjs } from "@/lib/utils";
import { 记有效沟通 } from "./helpers/ent-valid-followup";

describe("企业版三大阶段的门", () => {
  let 老板: { id: string; role: string };
  let 乙: { id: string; role: string };
  let 客户: string;

  async function 人(email: string, role: string) {
    const u = await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } });
    return { id: u.id, role };
  }
  const 项目 = (补: Record<string, unknown> = {}) =>
    prisma.project.create({ data: { name: "一号项目", customerId: 客户, ownerId: 乙.id, creatorId: 乙.id, ...补 } });
  const 现 = (id: string) => prisma.project.findUniqueOrThrow({ where: { id } });
  const 沟通 = (补: Record<string, unknown> = {}) => ({ type: "PHONE", content: "聊了", occurredAt: dayjs().format("YYYY-MM-DD HH:mm"), ...补 });
  const 明天 = () => dayjs().add(1, "day").format("YYYY-MM-DD");

  beforeEach(async () => {
    await resetDb();
    invalidateSettingsCache();
    老板 = await 人("boss", "ADMIN");
    乙 = await 人("yi", "SALES");
    客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "", salesOwnerId: 乙.id } })).id;
    // 老板 = 系统管理员（director、没设业务线），乙 = 销售（项目负责人）；门都按负责人乙测
    await prisma.entMember.createMany({ data: [{ userId: 老板.id, bizRole: "director" }, { userId: 乙.id }] });
    vi.stubEnv("CRM_ENTERPRISE", "1");
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  describe("记沟通要选阶段", () => {
    it("纯函数：没选阶段、选的不是当前阶段各给一句话；选对就过（不再问明确回复）；不是企业版一律 null", () => {
      expect(记沟通阶段问题({}, { phase: "线索" })).toBe("记沟通要选项目当前所在的阶段");
      expect(记沟通阶段问题({ 阶段: "随便" }, { phase: "线索" })).toBe("记沟通要选项目当前所在的阶段");
      expect(记沟通阶段问题({ 阶段: "商机" }, { phase: "线索" })).toBe("项目现在在线索阶段，沟通只能记在线索阶段");
      expect(记沟通阶段问题({ 阶段: "线索" }, { phase: "线索" })).toBeNull();
      vi.stubEnv("CRM_ENTERPRISE", "");
      expect(记沟通阶段问题({}, { phase: "线索" })).toBeNull();
    });

    it("记项目沟通：拦下时一行不写；记成一条一行标记，阶段是项目当前阶段，replied 一律 false（传了明确回复也不认）", async () => {
      const p = await 项目({ phase: "商机", node: "明确需求" });
      expect(await 记项目沟通(乙, p.id, 沟通())).toEqual({ ok: false, error: "记沟通要选项目当前所在的阶段" });
      expect(await 记项目沟通(乙, p.id, 沟通({ 阶段: "线索" }))).toEqual({ ok: false, error: "项目现在在商机阶段，沟通只能记在商机阶段" });
      expect(await prisma.followUp.count()).toBe(0);
      expect(await prisma.entFollowUpMark.count()).toBe(0);

      const r = await 记项目沟通(乙, p.id, 沟通({ 阶段: "商机", 明确回复: true }));
      expect(r).toMatchObject({ ok: true });
      expect(await prisma.entFollowUpMark.findUniqueOrThrow({ where: { followUpId: r.followUpId! } })).toMatchObject({ projectId: p.id, phase: "商机", replied: false });
      expect(await prisma.followUpProject.findUniqueOrThrow({ where: { followUpId: r.followUpId! } })).toMatchObject({ projectId: p.id });
    });
  });

  describe("有效线索要有效沟通（线索验证必填项齐，没配看需求状态）", () => {
    it("没配线索验证必填：需求状态没选拦（负责人也拦）；记了沟通也不算；选了需求状态就能推", async () => {
      // 11-01 权限只认业务角色：总管理改不了进程，原来「老板也拦」改成负责人乙推、被门拦（V3.5.1 老板是系统管理员，能改进程，见 project-node-direct-mgr）
      const p = await 项目({ node: "线索验证" });
      const 拦 = { ok: false, error: 缺有效沟通还差(["需求（需求状态）"]) };
      expect(await 改节点(乙, p.id, { phase: "线索", node: "线索推进" })).toEqual(拦);
      expect(await 记项目沟通(乙, p.id, 沟通({ 阶段: "线索" }))).toMatchObject({ ok: true });
      expect(await 改节点(乙, p.id, { phase: "线索", node: "线索推进" })).toEqual(拦);
      expect((await 现(p.id)).node).toBe("线索验证");
      await prisma.project.update({ where: { id: p.id }, data: { demandStatus: "暂未确认" } });
      expect(await 改节点(乙, p.id, { phase: "线索", node: "线索推进" })).toEqual(拦);
      await prisma.project.update({ where: { id: p.id }, data: { demandStatus: "方向明晰" } });
      expect(await 改节点(乙, p.id, { phase: "线索", node: "线索推进" })).toMatchObject({ ok: true });
    });

    it("配了线索验证必填：看配的那几样（有效沟通、线索验证结果不算进来），需求状态不再单看", async () => {
      await setSetting("orgRules", { ...默认组织规则, 节点推进: { 开: true, 必填: { 线索验证: ["金额", "有效沟通"] } } });
      const p = await 项目({ node: "线索验证", demandStatus: "明确需求" });
      expect(await 改节点(乙, p.id, { phase: "线索", node: "线索推进" })).toEqual({ ok: false, error: 缺有效沟通还差(["预计成交金额"]) });
      await prisma.project.update({ where: { id: p.id }, data: { amount: 5, demandStatus: null } });
      expect(await 改节点(乙, p.id, { phase: "线索", node: "线索推进" })).toMatchObject({ ok: true });
    });

    it("线索验证以前、往后退、点结局都不看有效沟通", async () => {
      const p = await 项目();
      expect(await 改节点(乙, p.id, { phase: "线索", node: "线索验证" })).toMatchObject({ ok: true });
      const q = await 项目({ node: "线索推进" });
      expect(await 改节点(乙, q.id, { phase: "线索", node: "线索验证" })).toMatchObject({ ok: true });
      expect(await 改节点(乙, q.id, { phase: "线索", node: "线索验证", result: "线索流失" }, { 备注: "没回" })).toMatchObject({ ok: true });
    });

    it("自动推进（节点必填齐了）：线索验证必填齐了就算有效沟通，接着推过线索验证", async () => {
      await setSetting("orgRules", { ...默认组织规则, 节点推进: { 开: true, 必填: { 线索验证: ["金额"] } } });
      const p = await 项目({ node: "线索验证" });
      const r = await 改项目(乙, p.id, { name: "一号项目", amount: 5 });
      expect(r).toMatchObject({ 自动推到: expect.arrayContaining(["线索推进"]) });
      expect((await 现(p.id)).node).not.toBe("线索验证");
    });

    it("不是企业版：不拦、不写标记", async () => {
      vi.stubEnv("CRM_ENTERPRISE", "");
      const p = await 项目({ node: "线索验证" });
      expect(await 改节点(乙, p.id, { phase: "线索", node: "线索推进" })).toMatchObject({ ok: true });
      expect(await 记项目沟通(乙, p.id, 沟通())).toMatchObject({ ok: true });
      expect(await prisma.entFollowUpMark.count()).toBe(0);
    });
  });

  describe("后台开关：线索、商机前两个节点各要一条沟通", () => {
    const 开 = () => setSetting("orgRules", { ...默认组织规则, 阶段: { ...默认组织规则.阶段, 前两节点要沟通: true } });

    it("管的是 潜客培育 / 线索验证 / 痛点挖掘 / 方案敲定（企业版 10-31 改名）", () => {
      expect(要沟通的节点()).toEqual(["潜客培育", "线索验证", "痛点挖掘", "方案敲定"]);
    });

    it("默认关：潜客培育、明确需求没沟通也能往后推", async () => {
      const p = await 项目({ node: "潜客培育" });
      expect(await 改节点(乙, p.id, { phase: "线索", node: "线索验证" })).toMatchObject({ ok: true });
      const q = await 项目({ phase: "商机", node: "明确需求" });
      expect(await 改节点(乙, q.id, { phase: "商机", node: "共识方案" })).toMatchObject({ ok: true });
      // 传旧名（改名前打开的页面）也认，存进库的是新名；节点变更记录照写新名
      expect((await 现(q.id)).node).toBe("方案敲定");
    });

    it("开了：本节点没沟通拦下，记了一条（在本节点记的）才放行；别的节点记的不算", async () => {
      await 开();
      const p = await 项目({ node: "潜客培育" });
      expect(await 改节点(乙, p.id, { phase: "线索", node: "线索验证" })).toEqual({ ok: false, error: 缺本节点沟通("潜客培育") });
      await 记有效沟通(p.id, false);
      expect(await 改节点(乙, p.id, { phase: "线索", node: "线索验证" })).toMatchObject({ ok: true });
      // 到了线索验证，潜客培育时记的那条不算（11-01 权限只认业务角色：推的人从老板换成负责人乙）
      expect(await 改节点(乙, p.id, { phase: "线索", node: "线索推进" })).toEqual({ ok: false, error: 缺本节点沟通("线索验证") });

      // 库里存旧名 明确需求 的项目：按新名 痛点挖掘 认、报错也说新名
      const q = await 项目({ phase: "商机", node: "明确需求" });
      expect(await 改节点(乙, q.id, { phase: "商机", node: "方案敲定" })).toEqual({ ok: false, error: 缺本节点沟通("痛点挖掘") });
      await 记有效沟通(q.id, false, "商机");
      expect(await 改节点(乙, q.id, { phase: "商机", node: "方案敲定" })).toMatchObject({ ok: true });
      expect(await 改节点(乙, q.id, { phase: "商机", node: "成交推进" })).toEqual({ ok: false, error: 缺本节点沟通("方案敲定") });
      await 记有效沟通(q.id, true, "商机");
      expect(await 改节点(乙, q.id, { phase: "商机", node: "成交推进" })).toMatchObject({ ok: true });
      // 第三个节点起不管
      expect(await 改节点(乙, q.id, { phase: "商机", node: "合同审批" })).toMatchObject({ ok: true });
    });

    it("开了：往回退、结束项目不拦", async () => {
      await 开();
      const q = await 项目({ phase: "商机", node: "共识方案" });
      // 11-01 权限只认业务角色：退、结束由负责人乙做（总管理改不了进程）
      expect(await 改节点(乙, q.id, { phase: "商机", node: "明确需求" })).toMatchObject({ ok: true });
      expect(await 改节点(乙, q.id, { phase: "商机", node: "明确需求", result: "丢单" }, { 备注: "不做了" })).toMatchObject({ ok: true });
    });

    it("开了：自动推进也停在没沟通的节点", async () => {
      await setSetting("orgRules", { ...默认组织规则, 阶段: { ...默认组织规则.阶段, 前两节点要沟通: true }, 节点推进: { 开: true, 必填: { 明确需求: ["金额"] } } });
      const q = await 项目({ phase: "商机", node: "明确需求" });
      expect(await 改项目(乙, q.id, { name: "一号项目", amount: 5 })).not.toHaveProperty("自动推到");
      expect((await 现(q.id)).node).toBe("明确需求");
      expect(await 记项目沟通(乙, q.id, 沟通({ 阶段: "商机" }))).toMatchObject({ ok: true, 自动推到: ["方案敲定"] });
    });

    it("不是企业版：存了开也不拦", async () => {
      await 开();
      vi.stubEnv("CRM_ENTERPRISE", "");
      invalidateSettingsCache();
      const q = await 项目({ phase: "商机", node: "明确需求" });
      expect(await 改节点(乙, q.id, { phase: "商机", node: "共识方案" })).toMatchObject({ ok: true });
    });
  });

  describe("MQL 人工判", () => {
    it("合格：往前推到线索推进（照旧要有效沟通、记节点变更）", async () => {
      const p = await 项目({ node: "线索验证" });
      // 11-01 权限只认业务角色：判 MQL 合格 = 推进程，由负责人乙判
      expect(await 判MQL(乙, p.id, true)).toEqual({ ok: false, error: 缺有效沟通还差(["需求（需求状态）"]) });
      await 记有效沟通(p.id);
      expect(await 判MQL(乙, p.id, true)).toMatchObject({ ok: true });
      expect(await 现(p.id)).toMatchObject({ phase: "线索", node: "线索推进" });
      expect(await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId: p.id } })).toMatchObject({ fromNode: "线索验证", toNode: "线索推进", userId: 乙.id });
    });

    it("不合格：退回潜客培育，写下一步时间 + 培育跟进计划；日期不填、早于今天、计划内容不填拦", async () => {
      const p = await 项目({ node: "线索验证" });
      expect(await 判MQL(乙, p.id, false)).toEqual({ ok: false, error: "MQL 不合格要定下一次培育跟进的日期" });
      expect(await 判MQL(乙, p.id, false, dayjs().subtract(1, "day").format("YYYY-MM-DD"))).toEqual({ ok: false, error: "下一次培育跟进不能早于今天" });
      expect(await 判MQL(乙, p.id, false, 明天())).toEqual({ ok: false, error: "MQL 不合格要写下一次培育跟进的计划内容" });
      expect(await 判MQL(乙, p.id, false, 明天(), new Date(), "   ")).toEqual({ ok: false, error: "MQL 不合格要写下一次培育跟进的计划内容" });
      expect((await 现(p.id)).node).toBe("线索验证");
      expect(await prisma.followPlan.count()).toBe(0);

      expect(await 判MQL(乙, p.id, false, 明天(), new Date(), "  下月再问预算  ")).toEqual({ ok: true });
      const 后 = await 现(p.id);
      expect(后).toMatchObject({ phase: "线索", node: "潜客培育" });
      expect(dayjs(后.nextStepAt).format("YYYY-MM-DD")).toBe(明天());
      const 计划 = await prisma.followPlan.findFirstOrThrow();
      expect(计划).toMatchObject({ customerId: 客户, ownerId: 乙.id, plannedOn: 明天(), done: false });
      expect(计划.subject).toBe("潜客培育：下月再问预算");
    });

    it("不合格建的培育计划带项目和来源标记（E-396）", async () => {
      const p = await 项目({ node: "线索验证" });
      expect(await 判MQL(乙, p.id, false, 明天(), new Date(), "下月再问")).toEqual({ ok: true });
      expect(await prisma.followPlan.findFirstOrThrow()).toMatchObject({ projectId: p.id, autoBy: "mql-nurture", done: false });
    });

    it("项目改回线索验证：自动培育计划撤掉（硬删、不算完成）、写操作日志；人手加的同客户计划、旧数据（两列空）不动（E-396）", async () => {
      const p = await 项目({ node: "线索验证" });
      const 人手 = await prisma.followPlan.create({ data: { subject: "人手加的", plannedAt: new Date(), customerId: 客户, ownerId: 乙.id } });
      const 旧 = await prisma.followPlan.create({ data: { subject: "潜客培育：旧数据", plannedAt: new Date(), customerId: 客户, ownerId: 乙.id } });
      await 判MQL(乙, p.id, false, 明天(), new Date(), "下月再问");
      expect(await prisma.followPlan.count()).toBe(3);
      expect(await 改节点(乙, p.id, { phase: "线索", node: "线索验证" })).toMatchObject({ ok: true });
      const 剩 = await prisma.followPlan.findMany({ orderBy: { subject: "asc" } });
      expect(剩.map((x) => x.id).sort()).toEqual([人手.id, 旧.id].sort());
      expect(剩.every((x) => !x.done)).toBe(true);
      const 日志 = await prisma.auditLog.findFirstOrThrow({ where: { entity: "FollowPlan", action: "delete" } });
      expect(日志).toMatchObject({ userId: 乙.id });
      expect(日志.summary).toContain("项目离开潜客培育，自动培育计划随之撤销");
      expect(日志.summary).toContain("潜客培育：下月再问");
    });

    it("往后推（线索验证）也撤；已完成的培育计划不动；还在潜客培育里保存不撤（E-396）", async () => {
      const p = await 项目({ node: "线索验证" });
      await 判MQL(乙, p.id, false, 明天(), new Date(), "第一条");
      const 做完 = await prisma.followPlan.findFirstOrThrow();
      await prisma.followPlan.update({ where: { id: 做完.id }, data: { done: true, doneAt: new Date() } });
      await prisma.followPlan.create({ data: { subject: "潜客培育：第二条", plannedAt: new Date(), customerId: 客户, ownerId: 乙.id, projectId: p.id, autoBy: "mql-nurture" } });
      expect(await 改节点(乙, p.id, { phase: "线索", node: "潜客培育" })).toMatchObject({ ok: true });
      expect(await prisma.followPlan.count()).toBe(2);
      expect(await 改节点(乙, p.id, { phase: "线索", node: "线索验证" })).toMatchObject({ ok: true });
      const 剩 = await prisma.followPlan.findMany();
      expect(剩.map((x) => x.id)).toEqual([做完.id]);
      expect(await prisma.auditLog.count({ where: { entity: "FollowPlan", action: "delete" } })).toBe(1);
    });

    it("别的项目的自动培育计划不受影响；非企业版不撤（E-396）", async () => {
      const p = await 项目({ node: "线索验证" });
      const q = await 项目({ node: "线索验证", name: "二号" });
      await 判MQL(乙, p.id, false, 明天(), new Date(), "甲的");
      await 判MQL(乙, q.id, false, 明天(), new Date(), "乙的");
      await 改节点(乙, p.id, { phase: "线索", node: "线索验证" });
      expect((await prisma.followPlan.findMany()).map((x) => x.projectId)).toEqual([q.id]);
    });

    it("导入 / 同步改已有项目的节点离开潜客培育：自动培育计划一起撤；节点没变、还在潜客培育不撤；人手加的不动（E-396）", async () => {
      const p = await 项目({ node: "线索验证" });
      await 判MQL(乙, p.id, false, 明天(), new Date(), "下月再问");
      await prisma.followPlan.create({ data: { subject: "人手加的", plannedAt: new Date(), customerId: 客户, ownerId: 乙.id } });
      const 导 = async (stage: string) => prisma.$transaction(async (tx) => 导入改项目(tx, p.id, { stage }, (await 导入读项目(tx, p.id))!, new Date().toISOString()));
      await 导("潜客培育");
      expect(await prisma.followPlan.count()).toBe(2);
      await 导("线索验证");
      expect((await prisma.followPlan.findMany()).map((x) => x.subject)).toEqual(["人手加的"]);
      const 日志 = await prisma.auditLog.findFirstOrThrow({ where: { entity: "FollowPlan", action: "delete" } });
      expect(日志.summary).toContain("潜客培育：下月再问");
    });

    describe("其他撤法（E-396 客户口径）", () => {
      const 建计划 = (p: { id: string }, subject = "潜客培育：自动") =>
        prisma.followPlan.create({ data: { subject, plannedAt: new Date(), customerId: 客户, ownerId: 乙.id, projectId: p.id, autoBy: "mql-nurture" } });
      const 人手加 = () => prisma.followPlan.create({ data: { subject: "人手加的", plannedAt: new Date(), customerId: 客户, ownerId: 乙.id } });

      it("在潜客培育上终止进程（线索流失）：自动培育计划撤掉、人手加的不动", async () => {
        const p = await 项目({ node: "潜客培育" });
        await 建计划(p);
        await 人手加();
        expect(await 终止进程(乙, p.id, { 备注: "客户不要了" })).toMatchObject({ ok: true });
        expect((await 现(p.id)).result).toBe("线索流失");
        expect((await prisma.followPlan.findMany()).map((x) => x.subject)).toEqual(["人手加的"]);
      });

      it("删项目进回收站：自动培育计划撤掉（客户名下还有别的项目才能单删）", async () => {
        const p = await 项目({ node: "潜客培育" });
        await 项目({ name: "二号" });
        await 建计划(p);
        await 人手加();
        expect(await 删项目(乙, p.id)).toMatchObject({ ok: true });
        expect((await prisma.followPlan.findMany()).map((x) => x.subject)).toEqual(["人手加的"]);
      });

      it("项目放回公海：自动培育计划撤掉", async () => {
        const p = await 项目({ node: "潜客培育" });
        await prisma.contact.create({ data: { name: "联系人", customerId: 客户, phone: "13900001111", isPrimary: true } });
        await 建计划(p);
        await 人手加();
        const r = await 放回公海(乙, p.id);
        expect(r).toMatchObject({ ok: true });
        expect((await prisma.followPlan.findMany()).map((x) => x.subject)).toEqual(["人手加的"]);
      });

      it("撤的时候这几条计划还没读的到期 / 逾期提醒标已读；别的计划的、已读的不碰", async () => {
        const p = await 项目({ node: "潜客培育" });
        const 计划 = await 建计划(p);
        const 别 = await 人手加();
        const 记 = (key: string, readAt: Date | null = null) => prisma.entNotice.create({ data: { userId: 乙.id, kind: "跟进到期", title: key, dedupeKey: key, readAt } });
        const 到期 = await 记(`due:plan:${计划.id}:2026-11-27`);
        const 逾期 = await 记(`overdue:plan:${计划.id}:2026-11-27`);
        const 别的 = await 记(`due:plan:${别.id}:2026-11-27`);
        // 返回里带撤了几条：项目页撤销条据此提示「培育计划已撤，不随撤销恢复」；没撤的不带
        expect(await 改节点(乙, p.id, { phase: "线索", node: "线索验证" })).toMatchObject({ ok: true, 撤了培育计划: 1 });
        const 读 = async (id: string) => (await prisma.entNotice.findUniqueOrThrow({ where: { id } })).readAt;
        expect(await 读(到期.id)).not.toBeNull();
        expect(await 读(逾期.id)).not.toBeNull();
        expect(await 读(别的.id)).toBeNull();
      });

      it("系统身份（查不到人）撤：操作日志记「系统」；返回值是实际删掉的条数", async () => {
        const p = await 项目({ node: "潜客培育" });
        await 建计划(p, "潜客培育：一");
        await 建计划(p, "潜客培育：二");
        expect(await prisma.$transaction((tx) => 撤培育计划(tx, { id: "system" }, p.id))).toBe(2);
        expect(await prisma.$transaction((tx) => 撤培育计划(tx, { id: "system" }, p.id))).toBe(0);
        const 日志 = await prisma.auditLog.findMany({ where: { entity: "FollowPlan", action: "delete" } });
        expect(日志).toHaveLength(1);
        expect(日志[0]).toMatchObject({ userName: "系统" });
        expect(JSON.parse(日志[0].detail ?? "{}").撤了).toBe(2);
      });
    });

    it("培育计划字数上限（M-节点-03）：默认不设，很长也收；管理员设了才拦，拦下一行不写", async () => {
      const p = await 项目({ node: "线索验证" });
      expect(await 判MQL(乙, p.id, false, 明天(), new Date(), "长".repeat(1000))).toEqual({ ok: true });
      expect((await prisma.followPlan.findFirstOrThrow()).subject).toBe(`潜客培育：${"长".repeat(1000)}`);

      await setSetting("orgRules", { ...默认组织规则, 阶段: { ...默认组织规则.阶段, 培育计划上限: 10 } });
      invalidateSettingsCache();
      const q = await 项目({ node: "线索验证", name: "二号" });
      expect(await 判MQL(乙, q.id, false, 明天(), new Date(), "长".repeat(11))).toEqual({ ok: false, error: "计划内容最多 10 个字" });
      expect((await 现(q.id)).node).toBe("线索验证");
      expect(await prisma.followPlan.count()).toBe(1);
      expect(await 判MQL(乙, q.id, false, 明天(), new Date(), "长".repeat(10))).toEqual({ ok: true });
    });

    it("只有停在线索验证的能判；不是企业版判不了，一行不写", async () => {
      for (const 补 of [{ node: "潜客培育" }, { node: "线索推进" }, { node: "线索验证", result: "线索流失" }, { phase: "商机", node: "明确需求" }]) {
        const p = await 项目(补);
        expect(await 判MQL(老板, p.id, false, 明天(), new Date(), "再问")).toEqual({ ok: false, error: "只有停在「线索验证」的项目能判 MQL" });
      }
      expect(await 判MQL(老板, "没这个", true)).toMatchObject({ ok: false, error: expect.stringContaining("不在了") });
      vi.stubEnv("CRM_ENTERPRISE", "");
      const q = await 项目({ node: "线索验证" });
      expect(await 判MQL(老板, q.id, false, 明天(), new Date(), "再问")).toEqual({ ok: false, error: "MQL 判定只在企业版有" });
      expect(await prisma.followPlan.count()).toBe(0);
      expect(await prisma.projectNodeLog.count()).toBe(0);
    });
  });
});
