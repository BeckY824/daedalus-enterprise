/**
 * 企业版推进 / 终止（P2：M-权限-07、M-节点-04/05/06/07/09、A-12）
 *   - 需求状态补全期开关：开着只有经理、总管理员能往前推，成员拦下；往后退、记沟通照旧；自动推进停；关着照旧
 *   - 终止进程：线索→线索流失、商机→丢单、订单→异常状态，留节点变更；有结局了不再终止；不是企业版没有
 *   - 线索最后一个节点完成：进商机第一个节点，项目上的字段跟着走
 *   - 占位值（暂无、- 等）不算填了；销售本人填齐了能手动完成节点
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 改节点, 改项目, 记项目沟通, 终止进程, 异常类别字典, 补全期提示 } from "@/lib/project/db";
import { 默认组织规则, type 组织规则 } from "@/lib/project/org-rules";
import { 是占位值, 还差, type 必填数据 } from "@/lib/project/required";
import { 终止结局 } from "@/lib/project/nodes";
import { 企业版字典 } from "@/lib/project/stage-dict";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { dayjs } from "@/lib/utils";
import { 记有效沟通 } from "./helpers/ent-valid-followup";
import { 改项目画像 } from "@/lib/project/profile";

type 人 = { id: string; role: string };
const 规则 = (补: Partial<组织规则["阶段"]> = {}, 必填: Record<string, string[]> = {}): 组织规则 => ({
  ...默认组织规则,
  节点推进: { 开: Object.keys(必填).length > 0, 必填 },
  阶段: { ...默认组织规则.阶段, ...补 },
});

describe("企业版推进 / 终止（P2）", () => {
  let 老板: 人, 经理: 人, 总: 人, 成员: 人;
  let 客户: string;

  async function 建(email: string, role: string): Promise<人> {
    const u = await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } });
    return { id: u.id, role };
  }
  const 项目 = (补: Record<string, unknown> = {}) =>
    prisma.project.create({ data: { name: "一号项目", customerId: 客户, ownerId: 成员.id, creatorId: 成员.id, ...补 } });
  const 现 = (id: string) => prisma.project.findUniqueOrThrow({ where: { id } });
  async function 设(r: 组织规则) {
    await setSetting("orgRules", r);
    invalidateSettingsCache();
  }

  beforeEach(async () => {
    await resetDb();
    invalidateSettingsCache();
    老板 = await 建("boss", "ADMIN");
    经理 = await 建("mgr", "MANAGER");
    总 = await 建("top", "SALES"); // 组织里设成总管理员，账号角色还是 SALES
    成员 = await 建("sales", "SALES");
    await prisma.entMember.createMany({
      data: [
        { userId: 经理.id, bizRole: "sales_mgr" },
        { userId: 总.id, bizRole: "director" },
        { userId: 成员.id, managerId: 经理.id },
      ],
    });
    客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "", salesOwnerId: 成员.id } })).id;
    vi.stubEnv("CRM_ENTERPRISE", "1");
    await setSetting("enterprise.rule.org_scope", true);
    await 设(规则());
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  describe("需求状态补全期（M-权限-07）", () => {
    const 往前 = { phase: "线索", node: "线索验证" };

    it("关着（默认）：成员、经理、总管理员都能往前推", async () => {
      for (const who of [成员, 经理, 总]) {
        const p = await 项目();
        expect(await 改节点(who, p.id, 往前)).toMatchObject({ ok: true, 变了: true });
        expect(await 现(p.id)).toMatchObject({ node: "线索验证" });
      }
    });

    it("开着：成员往前推拦下、节点不动；经理、总管理员照样能推", async () => {
      await 设(规则({ 需求补全期: true }));
      const p = await 项目();
      expect(await 改节点(成员, p.id, 往前)).toEqual({ ok: false, error: 补全期提示 });
      expect((await 现(p.id)).node).toBe("潜客培育");
      expect(await prisma.projectNodeLog.count({ where: { projectId: p.id } })).toBe(0);

      expect(await 改节点(经理, p.id, 往前)).toMatchObject({ ok: true });
      await 记有效沟通(p.id);
      expect(await 改节点(总, p.id, { phase: "线索", node: "线索推进" })).toMatchObject({ ok: true });
      expect(await 现(p.id)).toMatchObject({ node: "线索推进" });
      expect(await 改节点(老板, p.id, { phase: "商机", node: "痛点挖掘" })).toMatchObject({ ok: true });
    });

    it("开着：往后退、终止、记沟通照旧", async () => {
      await 设(规则({ 需求补全期: true }));
      const p = await 项目({ node: "线索推进" });
      expect(await 改节点(成员, p.id, { phase: "线索", node: "线索验证" })).toMatchObject({ ok: true });
      const r = await 记项目沟通(成员, p.id, {
        type: "PHONE", content: "聊了", occurredAt: dayjs().format("YYYY-MM-DD HH:mm"),
        下一步时间: dayjs().add(2, "day").format("YYYY-MM-DD"), 阶段: "线索", 明确回复: false,
      });
      expect(r).toMatchObject({ ok: true });
      expect((await 现(p.id)).node).toBe("线索验证"); // 记沟通不动节点
      expect(await 终止进程(成员, p.id, { 备注: "客户没预算" })).toMatchObject({ ok: true });
      expect((await 现(p.id)).result).toBe("线索流失");
    });

    it("开着：必填填齐了也不自动推进；关掉后再保存照常推", async () => {
      await 设(规则({ 需求补全期: true }, { 潜客培育: ["金额"] }));
      const p = await 项目();
      const r = await 改项目(成员, p.id, { name: "一号项目", amount: 100 });
      expect(r).toMatchObject({ ok: true });
      expect(r).not.toHaveProperty("自动推到");
      expect((await 现(p.id)).node).toBe("潜客培育");
      await 设(规则({}, { 潜客培育: ["金额"] }));
      expect(await 改项目(成员, p.id, { name: "一号项目", amount: 200 })).toMatchObject({ ok: true, 自动推到: ["线索验证"] });
    });

    it("不是企业版：开关存着也不拦", async () => {
      await 设(规则({ 需求补全期: true }));
      vi.stubEnv("CRM_ENTERPRISE", "");
      const p = await 项目();
      expect(await 改节点(成员, p.id, 往前)).toMatchObject({ ok: true });
    });
  });

  describe("终止进程（M-节点-04）", () => {
    it("线索 → 线索流失：要写原因，节点停在现在这个，留一行节点变更", async () => {
      const p = await 项目({ node: "线索验证" });
      expect(await 终止进程(成员, p.id)).toMatchObject({ ok: false });
      expect((await 现(p.id)).result).toBeNull();
      const r = await 终止进程(成员, p.id, { 备注: "客户没预算" });
      expect(r).toMatchObject({ ok: true, 到: { phase: "线索", node: "线索验证", result: "线索流失" } });
      expect(await 现(p.id)).toMatchObject({ phase: "线索", node: "线索验证", result: "线索流失" });
      const log = await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId: p.id } });
      expect(log).toMatchObject({ userId: 成员.id, fromResult: null, toResult: "线索流失", reason: "客户没预算" });
      expect(await 终止进程(成员, p.id, { 备注: "再来" })).toEqual({ ok: false, error: "项目已经有结局了，不用再终止" });
    });

    it("商机 → 丢单", async () => {
      const p = await 项目({ phase: "商机", node: "方案敲定" });
      expect(await 终止进程(经理, p.id, { 备注: "价格谈不拢" })).toMatchObject({ ok: true });
      expect(await 现(p.id)).toMatchObject({ phase: "商机", node: "方案敲定", result: "丢单" });
      expect(await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId: p.id } })).toMatchObject({ userId: 经理.id, toResult: "丢单" });
    });

    it("订单 → 异常状态：要选异常类别", async () => {
      await 异常类别字典();
      const p = await 项目({ phase: "订单", node: "物流运输" });
      expect(await 终止进程(成员, p.id, { 备注: "卡在海关" })).toMatchObject({ ok: false });
      expect(await 终止进程(成员, p.id, { categoryId: "stalled", 备注: "卡在海关" })).toMatchObject({ ok: true });
      expect(await 现(p.id)).toMatchObject({ phase: "订单", node: "物流运输", result: "异常状态", exceptionCategoryId: "stalled", exceptionReason: "卡在海关" });
      expect(await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId: p.id } })).toMatchObject({ toResult: "异常状态", categoryId: "stalled" });
    });

    it("别人的项目改不了；不是企业版没有终止", async () => {
      const 外人 = await 建("other", "SALES");
      await prisma.entMember.create({ data: { userId: 外人.id } });
      const p = await 项目();
      expect(await 终止进程(外人, p.id, { 备注: "x" })).toMatchObject({ ok: false });
      vi.stubEnv("CRM_ENTERPRISE", "");
      expect(await 终止进程(成员, p.id, { 备注: "x" })).toEqual({ ok: false, error: "终止进程只在企业版有" });
      expect((await 现(p.id)).result).toBeNull();
    });

    it("终止结局：按阶段落到没走成的出口，有结局了 null", () => {
      expect(终止结局({ phase: "线索" }, 企业版字典)).toBe("线索流失");
      expect(终止结局({ phase: "商机" }, 企业版字典)).toBe("丢单");
      expect(终止结局({ phase: "订单" }, 企业版字典)).toBe("异常状态");
      expect(终止结局({ phase: "订单", result: "异常状态" }, 企业版字典)).toBeNull();
      expect(终止结局({ phase: "乱写" }, 企业版字典)).toBeNull();
    });
  });

  describe("完成节点（M-节点-05/06/07/09、A-12）", () => {
    it("线索最后一个节点完成：进商机第一个节点，字段带过去；商机一次只能走一步", async () => {
      const p = await 项目({ node: "线索推进", amount: 8800, remark: "要 200 台" });
      await 记有效沟通(p.id);
      expect(await 改节点(成员, p.id, { phase: "商机", node: "痛点挖掘" })).toMatchObject({ ok: true });
      expect(await 现(p.id)).toMatchObject({ phase: "商机", node: "痛点挖掘", result: null, amount: 8800, remark: "要 200 台", customerId: 客户, ownerId: 成员.id });
      expect(await 改节点(成员, p.id, { phase: "商机", node: "成交推进" })).toMatchObject({ ok: false });
      expect(await 改节点(成员, p.id, { phase: "商机", node: "方案敲定" })).toMatchObject({ ok: true });
    });

    it("商机最后一个节点完成：进订单（商机赢单）", async () => {
      const 末 = 企业版字典.节点们.商机.at(-1)!;
      const 首 = 企业版字典.节点们.订单[0];
      const p = await 项目({ phase: "商机", node: 末 });
      expect(await 改节点(成员, p.id, { phase: "订单", node: 首 })).toMatchObject({ ok: true });
      expect(await 现(p.id)).toMatchObject({ phase: "订单", node: 首, result: null });
      expect(企业版字典.出口们.商机[0].叫法).toBe("商机赢单");
      expect(企业版字典.出口们.线索[0].叫法).toBe("已转商机");
    });

    it("销售本人：必填填齐了能手动完成节点；占位值不算填了", async () => {
      await 设(规则({}, { 线索验证: ["金额", "需求"] }));
      const p = await 项目({ node: "线索验证", amount: 100 });
      await 记有效沟通(p.id);
      // 需求状态没选 / 选「暂无」一类的占位：还差需求，拦下
      await prisma.project.update({ where: { id: p.id }, data: { demandStatus: "暂无" } });
      const 拦 = await 改节点(成员, p.id, { phase: "线索", node: "线索推进" });
      expect(拦).toEqual({ ok: false, error: "「线索验证」还差必填：需求（需求状态）；补齐再推，要先推请找老板或主管" });
      // 填了真值：没自动推的话手动也能推（这里改画像就自动推了，两种都算完成）
      const r = await 改项目画像(成员, p.id, { demandStatus: "明确需求" });
      expect(r).toMatchObject({ ok: true });
      if (!("自动推到" in r)) expect(await 改节点(成员, p.id, { phase: "线索", node: "线索推进" })).toMatchObject({ ok: true });
      expect((await 现(p.id)).node).toBe("线索推进");
    });
  });

  describe("占位值", () => {
    it("暂无、-、待定、n/a 这类不算填了；真内容算", () => {
      for (const v of ["暂无", " - ", "待定", "N/A", "？", "暂未确认"]) expect(是占位值(v), v).toBe(true);
      for (const v of ["100台", "德国", "暂无库存的替代款", "-5%"]) expect(是占位值(v), v).toBe(false);
    });

    it("还差：需求状态是占位、联系方式全是占位 → 都算缺", () => {
      const 规 = 规则({}, { 潜客培育: ["联系方式", "需求"] });
      const d: 必填数据 = {
        项目: { node: "潜客培育", contactId: null, nextStepAt: null, expectedDealAt: null, amount: 0, remark: null, acceptancePassed: false, demandStatus: "待定" },
        客户: { phone: "-", extra: { whatsapp: "暂无", email: "n/a" } },
        联系人们: [{ phone: "无" }],
        沟通节点们: [],
      };
      expect(还差(规, d)).toEqual(["联系方式", "需求"]);
      expect(还差(规, { ...d, 客户: { ...d.客户, phone: "+44 7700 900123" }, 项目: { ...d.项目, demandStatus: "明确需求" } })).toEqual([]);
    });
  });
});
