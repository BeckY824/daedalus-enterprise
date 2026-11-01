/**
 * 企业版节点必填按客户「项目阶段字段配置矩阵」（11-01，lib/project/required.ts 建议必填 + db.ts 读必填数据）真库闭环：
 *   - 设置页「用建议清单」那一套（对到企业版节点名）存进组织规则，缺一样不推、补齐自动推、下一个也齐了接着推
 *   - 沟通三项：同一条沟通上发起主体、内容、方式都有才算；删了的沟通不算
 *   - 线索验证结果：判有效线索且没在等才算；等销售认领不算
 *   - 分配方式 / 所属客户 / 项目来源 / 项目所在地 / 项目级别 从库里读得到
 *   - 配了的节点销售手动推被拦、列的是中文叫法；老板能推；没配的节点不拦
 *   - 没开节点推进的组织（老组织）：一样不拦、不自动推
 *   - 矩阵里的结局原因（线索流失 / 商机丢单原因、异常类别、尾款结算两勾）：服务端 改节点问题 已经管，这里钉住
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 改节点, 改项目, 读必填数据 } from "@/lib/project/db";
import { 默认组织规则, type 组织规则 } from "@/lib/project/org-rules";
import { 建议必填, 还差 } from "@/lib/project/required";
import { 企业版字典, 本套节点名 } from "@/lib/project/stage-dict";
import { 改节点问题 } from "@/lib/project/nodes";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 记有效沟通 } from "./helpers/ent-valid-followup";

const 开着 = (必填: Record<string, string[]>, 开 = true): 组织规则 => ({ ...默认组织规则, 节点推进: { 开, 必填 } });
/** 设置页「用建议清单」一键填的那一套：节点名对到企业版 */
const 建议配置 = () => Object.fromEntries(Object.entries(建议必填).map(([n, v]) => [本套节点名(n, 企业版字典), [...v]]));

describe("节点必填按矩阵（真库）", () => {
  let 老板: { id: string; role: string };
  let 乙: { id: string; role: string };
  let 客户: string;
  let 次 = 0;

  async function 人(email: string, role: string) {
    const u = await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } });
    return { id: u.id, role };
  }
  const 项目 = (补: Record<string, unknown> = {}) => prisma.project.create({ data: { name: "一号项目", customerId: 客户, ownerId: 乙.id, creatorId: 乙.id, ...补 } });
  const 现 = (id: string) => prisma.project.findUniqueOrThrow({ where: { id } });
  /** 随便存一下（改备注）触发按必填推进 */
  const 存一下 = (id: string, who = 乙) => 改项目(who, id, { name: "一号项目", remark: `第${++次}次` });
  async function 沟通(projectId: string, f: { initiator?: string | null; content?: string; method?: string | null; deleted?: boolean; node?: string }) {
    const p = await 现(projectId);
    const x = await prisma.followUp.create({
      data: { type: "PHONE", title: "沟通", content: f.content ?? "聊了", initiator: f.initiator ?? null, method: f.method ?? null, customerId: p.customerId, ownerId: p.ownerId, deletedAt: f.deleted ? new Date() : null },
    });
    await prisma.followUpProject.create({ data: { followUpId: x.id, projectId, node: f.node ?? p.node } });
  }
  const 下一步 = { nextStepText: "约下周演示", nextStepAt: new Date(Date.now() + 3 * 86400_000) };

  beforeEach(async () => {
    await resetDb();
    invalidateSettingsCache();
    vi.stubEnv("CRM_ENTERPRISE", "1");
    老板 = await 人("boss", "ADMIN");
    乙 = await 人("yi", "SALES");
    客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "", salesOwnerId: 乙.id } })).id;
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("用建议清单：订单阶段生产备货 → 物流运输只要下一步计划 / 时间；推一步清一次下一步，每个节点得重写才推；缺场地现状停住，补上接着推到交付验收", async () => {
    await setSetting("orgRules", 开着(建议配置()));
    const p = await 项目({ phase: "订单", node: "生产备货", ...下一步 });
    const r = await 存一下(p.id);
    // 推到物流运输就停：生产备货写的下一步清掉了，不算物流运输的
    expect(r).toMatchObject({ ok: true, 自动推到: ["物流运输"] });
    expect(await 现(p.id)).toMatchObject({ node: "物流运输", nextStepText: null, nextStepAt: null });
    expect(await 存一下(p.id)).not.toHaveProperty("自动推到");
    // 物流运输写了自己的下一步才推
    await prisma.project.update({ where: { id: p.id }, data: 下一步 });
    expect(await 存一下(p.id)).toMatchObject({ ok: true, 自动推到: ["安装实施"] });
    // 安装实施：场地现状填占位不算（下一步也得在这儿重写）
    await prisma.project.update({ where: { id: p.id }, data: { siteStatus: "暂未确认", ...下一步 } });
    expect(await 存一下(p.id)).not.toHaveProperty("自动推到");
    await prisma.project.update({ where: { id: p.id }, data: { siteStatus: "已有场地" } });
    expect(await 存一下(p.id)).toMatchObject({ ok: true, 自动推到: ["交付验收"] });
    // 交付验收差验收通过
    expect((await 现(p.id)).node).toBe("交付验收");
  });

  it("带着上个节点的下一步进生产备货（手动推进来）：不自动推；在生产备货写了下一步才推，且只推一步", async () => {
    await setSetting("orgRules", 开着(建议配置()));
    // 商机最后一个节点首款到账：老板手动推过来，带着上个节点的下一步
    const p = await 项目({ phase: "商机", node: "首款到账", ...下一步 });
    expect(await 改节点(老板, p.id, { phase: "订单", node: "生产备货" })).toMatchObject({ ok: true, 变了: true });
    expect(await 现(p.id)).toMatchObject({ node: "生产备货", nextStepText: null, nextStepAt: null });
    expect(await 存一下(p.id)).not.toHaveProperty("自动推到");
    expect((await 现(p.id)).node).toBe("生产备货");
    // 老值不丢：记在这次节点变更里
    const 那行 = await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId: p.id, toNode: "生产备货" } });
    expect(那行.reason).toContain("原下一步：约下周演示");
    // 在生产备货写了下一步：推到物流运输就停（物流运输还没写自己的）
    await prisma.project.update({ where: { id: p.id }, data: 下一步 });
    expect(await 存一下(p.id)).toMatchObject({ ok: true, 自动推到: ["物流运输"] });
    expect((await 现(p.id)).node).toBe("物流运输");
    const 自动 = await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId: p.id, toNode: "物流运输" } });
    expect(自动.reason).toMatch(/^必填齐了，自动推进\n原下一步：约下周演示 · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("销售带着上个节点的下一步手动推不过生产备货：下一步被清，还差下一步计划 / 时间", async () => {
    await setSetting("orgRules", 开着(建议配置()));
    const p = await 项目({ phase: "商机", node: "首款到账", ...下一步 });
    expect(await 改节点(老板, p.id, { phase: "订单", node: "生产备货" })).toMatchObject({ ok: true });
    const r = await 改节点(乙, p.id, { phase: "订单", node: "物流运输" });
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? "" : r.error).toContain("下一步");
  });

  it("往后退也清下一步；只改结局（丢单）不清", async () => {
    await setSetting("orgRules", 开着({}));
    const p = await 项目({ phase: "商机", node: "方案敲定", ...下一步 });
    expect(await 改节点(老板, p.id, { phase: "商机", node: "痛点挖掘" })).toMatchObject({ ok: true, 变了: true });
    expect(await 现(p.id)).toMatchObject({ nextStepText: null, nextStepAt: null });
    const 退 = await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId: p.id, toNode: "痛点挖掘" } });
    expect(退.reason).toContain("原下一步：约下周演示");
    await prisma.project.update({ where: { id: p.id }, data: 下一步 });
    expect(await 改节点(老板, p.id, { phase: "商机", node: "痛点挖掘", result: "丢单" }, { 备注: "预算砍了" })).toMatchObject({ ok: true, 变了: true });
    expect(await 现(p.id)).toMatchObject({ nextStepText: "约下周演示" });
  });

  it("用建议清单：下一步计划只写占位（待定）不算，下一步时间没填也不算", async () => {
    await setSetting("orgRules", 开着(建议配置()));
    const p = await 项目({ phase: "订单", node: "生产备货", nextStepText: "待定", nextStepAt: 下一步.nextStepAt });
    expect(await 存一下(p.id)).not.toHaveProperty("自动推到");
    await prisma.project.update({ where: { id: p.id }, data: { nextStepText: "排产", nextStepAt: null } });
    expect(await 存一下(p.id)).not.toHaveProperty("自动推到");
    expect((await 现(p.id)).node).toBe("生产备货");
  });

  it("沟通三项：缺方式、缺发起主体、删了的、记在别的节点的都不算；三样齐的一条就推", async () => {
    await setSetting("orgRules", 开着({ 首款到账: ["沟通三项"] }));
    const p = await 项目({ phase: "商机", node: "首款到账" });
    await 沟通(p.id, { initiator: "我方", method: null });
    await 沟通(p.id, { initiator: null, method: "电话沟通" });
    await 沟通(p.id, { initiator: "我方", method: "电话沟通", content: "暂无" });
    await 沟通(p.id, { initiator: "我方", method: "电话沟通", deleted: true });
    await 沟通(p.id, { initiator: "我方", method: "电话沟通", node: "签订合同" });
    expect(await 存一下(p.id)).not.toHaveProperty("自动推到");
    expect(还差(开着({ 首款到账: ["沟通三项"] }), await 读必填数据(prisma as never, await 现(p.id)))).toEqual(["沟通三项"]);
    await 沟通(p.id, { initiator: "客户", method: "微信沟通", content: "确认首款已打" });
    expect(await 存一下(p.id)).toMatchObject({ ok: true, 自动推到: ["生产备货"] });
    expect(await 现(p.id)).toMatchObject({ phase: "订单", node: "生产备货" });
  });

  it("潜客培育那几样从库里读：所属客户、项目来源（渠道）、项目所在地、分配方式（分配记录或客户上的）、需求类型", async () => {
    const r = 开着({ 潜客培育: ["所属客户", "项目来源", "项目所在地", "分配方式", "需求类型", "项目名称"] });
    const p = await 项目();
    expect(还差(r, await 读必填数据(prisma as never, await 现(p.id)))).toEqual(["项目来源", "项目所在地", "分配方式", "需求类型"]);
    const 渠道 = await prisma.channel.create({ data: { name: "展会渠道", channelOwnerId: 老板.id } });
    await prisma.project.update({ where: { id: p.id }, data: { channelId: 渠道.id, addrCountry: "德国", productNeeds: JSON.stringify(["常规标品"]) } });
    expect(还差(r, await 读必填数据(prisma as never, await 现(p.id)))).toEqual(["分配方式"]);
    await prisma.entLeadAssign.create({ data: { projectId: p.id, toUserId: 乙.id, byUserId: 老板.id, month: "2026-11", way: "指定分配" } });
    expect(还差(r, await 读必填数据(prisma as never, await 现(p.id)))).toEqual([]);
    // 没有分配记录，客户上有分配方式也算
    const q = await 项目({ channelId: 渠道.id, addrCountry: "德国", productNeeds: JSON.stringify(["常规标品"]) });
    await prisma.customer.update({ where: { id: 客户 }, data: { assignWay: "自持" } });
    expect(还差(r, await 读必填数据(prisma as never, await 现(q.id)))).toEqual([]);
  });

  it("线索验证结果：等销售认领不算；判有效线索、没在等才算，齐了推过线索验证", async () => {
    await setSetting("orgRules", 开着({ 线索验证: ["线索验证结果", "有效沟通"] }));
    const p = await 项目({ node: "线索验证" });
    await 记有效沟通(p.id);
    await prisma.entLeadVerify.create({ data: { projectId: p.id, verdict: "有效线索", pending: "销售认领" } });
    expect(await 存一下(p.id)).not.toHaveProperty("自动推到");
    await prisma.entLeadVerify.update({ where: { projectId: p.id }, data: { pending: null } });
    expect(await 存一下(p.id)).toMatchObject({ ok: true, 自动推到: ["线索推进"] });
  });

  it("配了的节点：销售手动往前推被拦，还差用中文叫法列；老板能推；没配的节点不拦", async () => {
    await setSetting("orgRules", 开着(建议配置()));
    const p = await 项目({ phase: "商机", node: "首款到账" });
    const r = await 改节点(乙, p.id, { phase: "订单", node: "生产备货" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("还差必填：当前回款、当前进程沟通（发起主体、沟通内容、沟通方式）、下一步计划、下一步时间");
    expect(await 改节点(老板, p.id, { phase: "订单", node: "生产备货" })).toMatchObject({ ok: true });
    // 只配一个节点：别的节点照旧手动推
    await setSetting("orgRules", 开着({ 交付验收: ["验收通过"] }));
    invalidateSettingsCache();
    const q = await 项目({ phase: "订单", node: "生产备货" });
    expect(await 改节点(乙, q.id, { phase: "订单", node: "物流运输" })).toMatchObject({ ok: true });
  });

  it("老组织（节点推进没开，必填里存着建议清单）：不拦手动推、不自动推", async () => {
    await setSetting("orgRules", 开着(建议配置(), false));
    const p = await 项目({ phase: "订单", node: "生产备货", ...下一步 });
    expect(await 存一下(p.id)).not.toHaveProperty("自动推到");
    expect(await 改节点(乙, p.id, { phase: "订单", node: "物流运输" })).toMatchObject({ ok: true });
  });
});

describe("矩阵里的结局原因：服务端 改节点问题 校验（企业版）", () => {
  const 项 = (phase: string, node: string, 勾: Partial<{ balanceSettled: boolean; acceptancePassed: boolean }> = {}) => ({ phase, node, balanceSettled: false, acceptancePassed: false, ...勾 });
  const 问 = (到: { phase: string; node: string; result?: string | null }, p: ReturnType<typeof 项>, 异常?: { categoryId?: string | null; 备注?: string | null }) => 改节点问题(到, p, 异常, true, 企业版字典);

  it("线索流失原因、商机丢单原因：不写拦，写了过", () => {
    expect(问({ phase: "线索", node: "线索验证", result: "线索流失" }, 项("线索", "线索验证"))).toContain("要写一句原因");
    expect(问({ phase: "线索", node: "线索验证", result: "线索流失" }, 项("线索", "线索验证"), { 备注: "  " })).toContain("要写一句原因");
    expect(问({ phase: "线索", node: "线索验证", result: "线索流失" }, 项("线索", "线索验证"), { 备注: "联系不上" })).toBeNull();
    expect(问({ phase: "商机", node: "方案敲定", result: "丢单" }, 项("商机", "方案敲定"))).toContain("要写一句原因");
    expect(问({ phase: "商机", node: "方案敲定", result: "丢单" }, 项("商机", "方案敲定"), { 备注: "价格没谈拢" })).toBeNull();
  });

  it("异常状态要选异常类别；交付结清要尾款结清 + 验收通过两勾", () => {
    expect(问({ phase: "订单", node: "安装实施", result: "异常状态" }, 项("订单", "安装实施"))).toContain("异常类别");
    expect(问({ phase: "订单", node: "安装实施", result: "异常状态" }, 项("订单", "安装实施"), { categoryId: "c1" })).toBeNull();
    expect(问({ phase: "订单", node: "尾款结算", result: "交付结清" }, 项("订单", "尾款结算", { acceptancePassed: true }))).toContain("尾款结清");
    expect(问({ phase: "订单", node: "尾款结算", result: "交付结清" }, 项("订单", "尾款结算", { balanceSettled: true }))).toContain("验收通过");
    expect(问({ phase: "订单", node: "尾款结算", result: "交付结清" }, 项("订单", "尾款结算", { balanceSettled: true, acceptancePassed: true }))).toBeNull();
  });
});
