/**
 * 企业版线索有效性验证（P12，lib/project/lead-verify.ts，迁移 088/089）。
 *   销售初判（有效 / 无效 / 还需培育）→ 市场复核 → 销售终验（接受 / 异议）→ 总管理终判 → 销售认领（继续 / 退回公海）
 *   - 规则「市场复核」关了、组织里没有市场管理：销售判无效直接交总管理终判
 *   - 谁能拍板哪一步（越权拦下、一行不写）
 *   - 最终判无效：项目 线索流失，负责人本月配额 +1（没设配额不加，下个月清零）
 *   - 每一步一行痕；等着的时候改节点 / 放回公海 / 判 MQL 都拦
 *   - 不是企业版：一律拦，一行不写
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 改节点, 放回公海 } from "@/lib/project/db";
import { 判MQL } from "@/lib/project/mql";
import {
  销售初判, 市场复核, 销售终验, 总管理终判, 销售认领, 读线索验证, 待我复核的, 实际待,
} from "@/lib/project/lead-verify";
import { 本月加额, 配额of, 月份 } from "@/lib/enterprise/lead-assign";
import { 规则 } from "@/lib/enterprise/rules";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { dayjs } from "@/lib/utils";
import { 记有效沟通 } from "./helpers/ent-valid-followup";

type 人 = { id: string; role: string };

describe("企业版线索有效性验证", () => {
  let 老板: 人, 总管: 人, 市场: 人, 销售经理: 人, 乙: 人, 丙: 人;
  let 客户: string;

  async function 建人(email: string, role: string) {
    const u = await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } });
    return { id: u.id, role };
  }
  const 项目 = async (补: Record<string, unknown> = {}) =>
    (await prisma.project.create({ data: { name: "一号项目", customerId: 客户, ownerId: 乙.id, creatorId: 乙.id, node: "线索验证", ...补 } })).id;
  const 现 = (id: string) => prisma.project.findUniqueOrThrow({ where: { id } });
  const 状态 = (id: string) => prisma.entLeadVerify.findUnique({ where: { projectId: id } });
  const 痕 = (id: string) => prisma.entLeadVerifyLog.findMany({ where: { projectId: id }, orderBy: { at: "asc" } });
  const 设配额 = (userId: string, quota: number) =>
    prisma.entLeadQuota.upsert({ where: { userId }, create: { userId, quota, setById: 老板.id }, update: { quota } });
  const 判无效 = (id: string, 谁: 人 = 乙) => 销售初判(谁, id, "无效", { invalidReason: "联系方式无效", verifyNote: "打了三次" });

  beforeEach(async () => {
    await resetDb();
    invalidateSettingsCache();
    vi.stubEnv("CRM_ENTERPRISE", "1");
    老板 = await 建人("boss", "ADMIN");
    总管 = await 建人("director", "SALES");
    市场 = await 建人("mkt", "SALES");
    销售经理 = await 建人("smgr", "SALES");
    乙 = await 建人("yi", "SALES");
    丙 = await 建人("bing", "SALES");
    await prisma.entMember.createMany({
      data: [
        { userId: 总管.id, bizRole: "director" },
        { userId: 市场.id, bizRole: "marketing_mgr" },
        { userId: 销售经理.id, bizRole: "sales_mgr" },
        { userId: 乙.id, bizRole: "sales" },
        { userId: 丙.id, bizRole: "sales" },
      ],
    });
    客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "", salesOwnerId: 乙.id } })).id;
  });
  afterEach(() => { vi.unstubAllEnvs(); invalidateSettingsCache(); });

  describe("1. 销售初判", () => {
    it("有效：要有效沟通；有了推到线索推进，判定 有效线索，一行痕", async () => {
      const id = await 项目();
      const 没沟通 = await 销售初判(乙, id, "有效");
      expect(没沟通.ok).toBe(false);
      expect(await 状态(id)).toBeNull();
      expect(await 痕(id)).toHaveLength(0);
      await 记有效沟通(id);
      expect((await 销售初判(乙, id, "有效", { verifyNote: "客户确认有预算" })).ok).toBe(true);
      expect((await 现(id)).node).toBe("线索推进");
      const s = await 状态(id);
      expect(s).toMatchObject({ verdict: "有效线索", finalResult: "有效线索", pending: null, verifiedById: 乙.id, verifyNote: "客户确认有预算" });
      expect(s?.verifiedAt).toBeInstanceOf(Date);
      expect((await 痕(id)).map((l) => [l.step, l.verdict, l.userId])).toEqual([["销售初判", "有效", 乙.id]]);
    });

    it("还需培育：走原来的 MQL 不合格（回潜客培育 + 培育计划），判定 暂未判定", async () => {
      const id = await 项目();
      expect((await 销售初判(乙, id, "还需培育", { 下一步时间: dayjs().add(3, "day").format("YYYY-MM-DD"), 计划内容: "下月问预算" })).ok).toBe(true);
      expect((await 现(id)).node).toBe("潜客培育");
      expect(await 状态(id)).toMatchObject({ verdict: "暂未判定", pending: null });
      expect((await 痕(id)).map((l) => [l.step, l.verdict, l.note])).toEqual([["销售初判", "还需培育", "下月问预算"]]);
      // 没写下一步时间：照 MQL 不合格的规矩拦下，一行不写
      const id2 = await 项目({ name: "二号" });
      expect((await 销售初判(乙, id2, "还需培育", { 计划内容: "x" })).ok).toBe(false);
      expect(await 痕(id2)).toHaveLength(0);
    });

    it("无效：要从无效原因字典里选（乱写、「其他」不写一句都拦）；交市场复核，判定 初验无效，项目不动", async () => {
      const id = await 项目();
      const 空 = await 销售初判(乙, id, "无效", { invalidReason: "  " });
      expect(空).toEqual({ ok: false, error: "判无效要选或写一个无效原因" });
      expect((await 销售初判(乙, id, "无效", { invalidReason: "随便写的" })).ok).toBe(false);
      expect((await 销售初判(乙, id, "无效", { invalidReason: "其他" })).ok).toBe(false);
      expect(await 状态(id)).toBeNull();
      const 其他 = await 项目({ name: "其他" });
      expect((await 销售初判(乙, 其他, "无效", { invalidReason: "其他：客户是同行" })).ok).toBe(true);
      expect((await 状态(其他))?.invalidReason).toBe("其他：客户是同行");
      expect(await 判无效(id)).toEqual({ ok: true });
      expect(await 现(id)).toMatchObject({ node: "线索验证", result: null });
      expect(await 状态(id)).toMatchObject({ verdict: "初验无效", invalidReason: "联系方式无效", verifyNote: "打了三次", pending: "市场复核" });
      expect((await 痕(id)).map((l) => [l.step, l.verdict, l.reason, l.note])).toEqual([["销售初判", "无效", "联系方式无效", "打了三次"]]);
      // 已经在等复核：不能再判一次
      expect((await 判无效(id)).ok).toBe(false);
    });

    it("只有停在线索验证的能判", async () => {
      const id = await 项目({ node: "潜客培育" });
      expect((await 判无效(id)).ok).toBe(false);
      const 结了 = await 项目({ name: "二号", result: "线索流失" });
      expect((await 判无效(结了)).ok).toBe(false);
    });
  });

  describe("2-4. 四步全走", () => {
    it("市场复核判有效 → 销售终验接受 → 推到线索推进，判定 有效线索", async () => {
      const id = await 项目();
      await 记有效沟通(id);
      await 判无效(id);
      expect((await 市场复核(市场, id, true, "看了录音，客户有兴趣")).ok).toBe(true);
      expect(await 状态(id)).toMatchObject({ reviewResult: "有效", reviewNote: "看了录音，客户有兴趣", reviewedById: 市场.id, pending: "销售终验", verdict: "初验无效" });
      expect((await 销售终验(乙, id, true)).ok).toBe(true);
      expect((await 现(id)).node).toBe("线索推进");
      expect(await 状态(id)).toMatchObject({ salesAck: "接受复核", verdict: "有效线索", finalResult: "有效线索", pending: null });
      expect((await 痕(id)).map((l) => `${l.step}:${l.verdict}`)).toEqual(["销售初判:无效", "市场复核:有效", "销售终验:接受复核"]);
    });

    it("销售终验接受但没有效沟通：门槛拦下，一行不写，还等终验", async () => {
      const id = await 项目();
      await 判无效(id);
      await 市场复核(市场, id, true);
      expect((await 销售终验(乙, id, true)).ok).toBe(false);
      expect((await 现(id)).node).toBe("线索验证");
      expect((await 状态(id))?.pending).toBe("销售终验");
      expect(await 痕(id)).toHaveLength(2);
    });

    it("提交异议要写说明 → 总管理终判判有效 → 销售认领继续推", async () => {
      const id = await 项目();
      await 记有效沟通(id);
      await 判无效(id);
      await 市场复核(市场, id, true);
      expect(await 销售终验(乙, id, false, " ")).toEqual({ ok: false, error: "提交异议要写一句为什么还认为无效" });
      expect((await 销售终验(乙, id, false, "客户明说不需要")).ok).toBe(true);
      expect(await 状态(id)).toMatchObject({ salesAck: "提交异议", disputeNote: "客户明说不需要", pending: "总管理终判" });
      expect((await 总管理终判(总管, id, true, "再跟一次")).ok).toBe(true);
      expect(await 状态(id)).toMatchObject({ finalResult: "有效线索", verdict: "有效线索", finalNote: "再跟一次", finalById: 总管.id, pending: "销售认领" });
      expect((await 销售认领(乙, id, true)).ok).toBe(true);
      expect((await 现(id)).node).toBe("线索推进");
      expect((await 状态(id))?.pending).toBeNull();
      expect((await 痕(id)).map((l) => `${l.step}:${l.verdict}`)).toEqual(["销售初判:无效", "市场复核:有效", "销售终验:提交异议", "总管理终判:有效", "销售认领:认领继续"]);
    });

    it("总管理判有效 → 销售退回公海：进公海，算主动退回（客户退回次数 +1）", async () => {
      const id = await 项目();
      await 判无效(id);
      await 市场复核(市场, id, true);
      await 销售终验(乙, id, false, "还是无效");
      await 总管理终判(老板, id, true);
      expect((await 销售认领(乙, id, false)).ok).toBe(true);
      expect((await 现(id)).pooledAt).toBeInstanceOf(Date);
      expect((await prisma.customer.findUniqueOrThrow({ where: { id: 客户 } })).poolReturns).toBe(1);
      expect((await prisma.projectNodeLog.findFirst({ where: { projectId: id, kind: "pool-release" } }))?.reason ?? null).toBeNull();
      expect((await 状态(id))?.pending).toBeNull();
      expect((await 痕(id)).at(-1)).toMatchObject({ step: "销售认领", verdict: "退回公海", userId: 乙.id });
    });

    it("市场复核判无效：项目 线索流失（closedAt），节点变更一行带无效原因，判定 无效线索", async () => {
      const id = await 项目();
      await 判无效(id);
      expect((await 市场复核(市场, id, false, "确认空号")).ok).toBe(true);
      const p = await 现(id);
      expect(p.result).toBe("线索流失");
      expect(p.closedAt).toBeInstanceOf(Date);
      const log = await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId: id, toResult: "线索流失" } });
      expect(log.reason).toBe("无效原因：联系方式无效；市场复核判无效；确认空号");
      expect(log.userId).toBe(市场.id);
      expect(await 状态(id)).toMatchObject({ verdict: "无效线索", finalResult: "无效线索", reviewResult: "无效", pending: null });
      expect((await 痕(id)).map((l) => `${l.step}:${l.verdict}`)).toEqual(["销售初判:无效", "市场复核:无效"]);
      // 判死以后再复核：作废
      expect((await 市场复核(市场, id, true)).ok).toBe(false);
    });

    it("总管理终判判无效：线索流失，判定 无效线索", async () => {
      const id = await 项目();
      await 判无效(id);
      await 市场复核(市场, id, true);
      await 销售终验(乙, id, false, "坚持无效");
      expect((await 总管理终判(总管, id, false, "同意")).ok).toBe(true);
      expect((await 现(id)).result).toBe("线索流失");
      expect(await 状态(id)).toMatchObject({ verdict: "无效线索", finalResult: "无效线索", finalById: 总管.id, pending: null });
      expect((await 痕(id)).map((l) => `${l.step}:${l.verdict}`)).toEqual(["销售初判:无效", "市场复核:有效", "销售终验:提交异议", "总管理终判:无效"]);
    });
  });

  describe("最终判无效 → 负责人本月配额 +1", () => {
    it("设了配额的 +1，下个月是新的一格；没设配额的不加", async () => {
      await 设配额(乙.id, 5);
      const a = await 项目();
      await 判无效(a);
      await 市场复核(市场, a, false);
      expect(await 本月加额(乙.id)).toBe(1);
      expect(await 配额of(乙.id)).toBe(6);
      const 下月 = 月份(dayjs().add(1, "month").toDate());
      expect(await 本月加额(乙.id, 下月)).toBe(0);
      expect(await 配额of(乙.id, prisma, 下月)).toBe(5);
      // 同月第二条：+2
      const b = await 项目({ name: "二号" });
      await 判无效(b);
      await 市场复核(市场, b, true);
      await 销售终验(乙, b, false, "坚持");
      await 总管理终判(总管, b, false);
      expect(await 配额of(乙.id)).toBe(7);
      // 丙没设配额：判死了也不加
      const c = await prisma.project.create({ data: { name: "丙的", customerId: 客户, ownerId: 丙.id, creatorId: 丙.id, node: "线索验证" } });
      await 判无效(c.id, 丙);
      await 市场复核(市场, c.id, false);
      expect(await 本月加额(丙.id)).toBe(0);
      expect(await 配额of(丙.id)).toBeNull();
    });

    it("复核判有效、接受复核：不加", async () => {
      await 设配额(乙.id, 5);
      const id = await 项目();
      await 记有效沟通(id);
      await 判无效(id);
      await 市场复核(市场, id, true);
      await 销售终验(乙, id, true);
      expect(await 本月加额(乙.id)).toBe(0);
    });
  });

  describe("两步走：没有市场复核", () => {
    it("规则「市场复核」关了：销售判无效直接交总管理终判；市场管理复核不了", async () => {
      await setSetting(规则.市场复核.key, false);
      invalidateSettingsCache();
      const id = await 项目();
      await 判无效(id);
      expect((await 状态(id))?.pending).toBe("总管理终判");
      expect((await 市场复核(市场, id, false)).ok).toBe(false);
      expect((await 总管理终判(老板, id, false)).ok).toBe(true);
      expect((await 现(id)).result).toBe("线索流失");
      expect((await 痕(id)).map((l) => `${l.step}:${l.verdict}`)).toEqual(["销售初判:无效", "总管理终判:无效"]);
    });

    it("组织里没有市场管理：直接交总管理终判", async () => {
      await prisma.entMember.deleteMany({ where: { userId: 市场.id } });
      const id = await 项目();
      await 判无效(id);
      expect((await 状态(id))?.pending).toBe("总管理终判");
    });

    it("存着「市场复核」但规则后来关了：按总管理终判算，不卡死", async () => {
      const id = await 项目();
      await 判无效(id);
      expect((await 状态(id))?.pending).toBe("市场复核");
      await setSetting(规则.市场复核.key, false);
      invalidateSettingsCache();
      expect((await 总管理终判(总管, id, true)).ok).toBe(true);
      expect((await 状态(id))?.pending).toBe("销售认领");
      expect(实际待("市场复核", "总管理终判")).toBe("总管理终判");
      expect(实际待("销售终验", "总管理终判")).toBe("销售终验");
      expect(实际待(null, "市场复核")).toBeNull();
    });
  });

  describe("谁能拍板（越权拦下，一行不写）", () => {
    it("初判：别的业务员、市场管理判不了；老板、销售经理（主管）这种能改节点的能", async () => {
      const id = await 项目();
      expect(await 判无效(id, 丙)).toEqual({ ok: false, error: "只有项目负责人、老板或主管能判这条线索" });
      expect((await 判无效(id, 市场)).ok).toBe(false);
      expect(await 痕(id)).toHaveLength(0);
      expect((await 判无效(id, 老板)).ok).toBe(true);
    });

    it("市场复核只给市场管理：业务员、负责人、老板、总管理员都不行", async () => {
      const id = await 项目();
      await 判无效(id);
      for (const 谁 of [乙, 丙, 老板, 总管, 销售经理]) {
        expect(await 市场复核(谁, id, false)).toEqual({ ok: false, error: "只有市场管理能复核这条线索" });
      }
      expect(await 痕(id)).toHaveLength(1);
      expect((await 现(id)).result).toBeNull();
    });

    it("总管理终判只给老板、总管理员：市场管理、销售经理、负责人不行", async () => {
      const id = await 项目();
      await 判无效(id);
      await 市场复核(市场, id, true);
      await 销售终验(乙, id, false, "坚持");
      for (const 谁 of [市场, 销售经理, 乙, 丙]) {
        expect(await 总管理终判(谁, id, false)).toEqual({ ok: false, error: "只有老板或总管理员能终判" });
      }
      expect((await 现(id)).result).toBeNull();
      expect(await 痕(id)).toHaveLength(3);
    });

    it("终验、认领：别的业务员、市场管理不行；不是轮到的那步也不行", async () => {
      const id = await 项目();
      await 判无效(id);
      // 还在等市场复核：销售终验、认领、总管理终判都不是这步
      expect((await 销售终验(乙, id, false, "x")).ok).toBe(false);
      expect((await 销售认领(乙, id, true)).ok).toBe(false);
      expect(await 总管理终判(总管, id, true)).toEqual({ ok: false, error: "这条线索现在等的是市场复核，不是总管理终判" });
      await 市场复核(市场, id, true);
      expect(await 销售终验(丙, id, false, "x")).toEqual({ ok: false, error: "只有项目负责人、老板或主管能终验" });
      expect((await 销售终验(市场, id, false, "x")).ok).toBe(false);
      await 销售终验(乙, id, false, "坚持");
      await 总管理终判(总管, id, true);
      expect(await 销售认领(丙, id, true)).toEqual({ ok: false, error: "只有项目负责人、老板或主管能认领" });
      expect(await 痕(id)).toHaveLength(4);
    });

    it("没在等复核：复核直接拦", async () => {
      const id = await 项目();
      expect(await 市场复核(市场, id, true)).toEqual({ ok: false, error: "这条线索没在等复核，刷新看看" });
    });
  });

  describe("等着的时候别的入口拦住", () => {
    it("等复核：改节点、点结局、放回公海、判 MQL 都拦（老板也不行）；有结果等销售时也拦", async () => {
      const id = await 项目();
      await 记有效沟通(id);
      await 判无效(id);
      for (const 谁 of [乙, 老板]) {
        const r = await 改节点(谁, id, { phase: "线索", node: "线索推进" });
        expect(r).toMatchObject({ ok: false, error: "这条线索在等市场复核，复核完再动" });
        expect((await 改节点(谁, id, { phase: "线索", node: "线索验证", result: "线索流失" })).ok).toBe(false);
      }
      expect((await 放回公海(乙, id)).ok).toBe(false);
      expect((await 判MQL(乙, id, true)).ok).toBe(false);
      expect(await 现(id)).toMatchObject({ node: "线索验证", result: null, pooledAt: null });
      await 市场复核(市场, id, true);
      const r = await 改节点(乙, id, { phase: "线索", node: "线索推进" });
      expect(r.ok).toBe(false);
      expect(r.ok ? "" : r.error).toContain("先在详情页「线索验证」里处理");
    });

    it("没在等（判过有效、或没判过）：改节点照旧", async () => {
      const id = await 项目();
      await 记有效沟通(id);
      expect((await 改节点(乙, id, { phase: "线索", node: "线索推进" })).ok).toBe(true);
    });
  });

  describe("详情页、列表读", () => {
    it("读线索验证.我能：负责人初判；等市场复核时市场管理是「市场复核」，负责人、老板 null", async () => {
      const id = await 项目();
      const p = await 现(id);
      expect((await 读线索验证(乙, p))?.我能).toBe("初判");
      expect((await 读线索验证(丙, p))?.我能).toBeNull();
      expect(await 读线索验证(乙, p)).toMatchObject({ 判定: "暂未判定", 待: null, 痕: [] });
      await 判无效(id);
      expect(await 读线索验证(乙, p)).toMatchObject({ 判定: "初验无效", 待: "市场复核", 无效原因: "联系方式无效", 我能: null });
      expect((await 读线索验证(市场, p))?.我能).toBe("市场复核");
      expect((await 读线索验证(老板, p))?.我能).toBeNull();
      const v = await 读线索验证(乙, p);
      expect(v?.痕).toHaveLength(1);
      expect(v?.痕[0]).toMatchObject({ step: "销售初判", verdict: "无效", reason: "联系方式无效", note: "打了三次", 谁: "yi" });
      await 市场复核(市场, id, true);
      expect((await 读线索验证(乙, p))?.我能).toBe("销售终验");
      expect((await 读线索验证(市场, p))?.我能).toBeNull();
    });

    it("待我复核的：市场管理看到等市场复核的；总管看到等终判的；销售两步只给负责人本人", async () => {
      const id = await 项目();
      await 判无效(id);
      expect((await 待我复核的(市场)).map((r) => [r.projectId, r.步, r.无效原因])).toEqual([[id, "市场复核", "联系方式无效"]]);
      expect(await 待我复核的(总管)).toEqual([]);
      expect(await 待我复核的(乙)).toEqual([]);
      await 市场复核(市场, id, true, "有兴趣");
      expect(await 待我复核的(市场)).toEqual([]);
      expect((await 待我复核的(乙)).map((r) => [r.步, r.复核说明, r.负责人])).toEqual([["销售终验", "有兴趣", "yi"]]);
      expect(await 待我复核的(老板)).toEqual([]);
      await 销售终验(乙, id, false, "坚持");
      expect((await 待我复核的(总管)).map((r) => [r.步, r.异议说明])).toEqual([["总管理终判", "坚持"]]);
      expect((await 待我复核的(老板)).map((r) => r.步)).toEqual(["总管理终判"]);
      expect(await 待我复核的(乙)).toEqual([]);
      // 项目被超时收回到公海：列表里不再出现
      await prisma.project.update({ where: { id }, data: { pooledAt: new Date() } });
      expect(await 待我复核的(总管)).toEqual([]);
    });
  });

  it("不是企业版：一律拦、一行不写，读出来 null / 空", async () => {
    const id = await 项目();
    vi.stubEnv("CRM_ENTERPRISE", "");
    const 拦 = { ok: false, error: "线索验证只在企业版有" };
    expect(await 判无效(id)).toEqual(拦);
    expect(await 市场复核(市场, id, false)).toEqual(拦);
    expect(await 销售终验(乙, id, true)).toEqual(拦);
    expect(await 总管理终判(老板, id, false)).toEqual(拦);
    expect(await 销售认领(乙, id, true)).toEqual(拦);
    expect(await 读线索验证(乙, await 现(id))).toBeNull();
    expect(await 待我复核的(市场)).toEqual([]);
    expect(await prisma.entLeadVerify.count()).toBe(0);
    expect(await prisma.entLeadVerifyLog.count()).toBe(0);
  });
});
