/**
 * 客户 11-19 最新口径（真库）：
 *   - 「推进节点，不需要每个节点都需要记一条沟通，用每个节点的必填字段去做推进的兜底」
 *   - 「「生产备货」新增「备货状态」字段，枚举值为未生产、生产中、已备货」；「「物流运输」新增「物流状态」「物流单号」字段」
 *   - 「不论是存量项目还是新增项目都需要按这一规则执行」：节点推进范围默认「全部」，存量项目不再豁免（我们的理解：存量、新建都管，待客户确认）
 * 钉住：
 *   - 三个新字段经 改项目 读写、规整、校验，编辑项目 留操作日志
 *   - 物流状态对字典 projLogistics（默认 待发货 / 运输中 / 已签收），字典改名、加项、停用后跟着变
 *   - 节点必填配新字段：缺着拦手动推、填齐自动推；项目页「还差」、完成节点框的料（备货物流）都有
 *   - 节点推进开着（默认全部）：存量项目被要求补齐、填齐自动推、看板预检报还差、客户资料齐了连带推进；关着不拦
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "乙", email: "yi", role: "SALES", title: "", avatar: null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 默认组织规则, type 组织规则 } from "@/lib/project/org-rules";
import { 改节点, 改项目, 客户项目按必填推进 } from "@/lib/project/db";
import { 看板推进预检, 编辑项目 } from "@/app/(app)/projects/actions";
import { 读项目详情 } from "@/app/(app)/projects/[id]/load";
import { 企业字典, 改字典项, 加字典项 } from "@/lib/enterprise/dict";

/** 开着、范围不写（= 全部，客户 11-19）；生效时刻记在一小时前，全部时不看它 */
const 开着 = (必填: Record<string, string[]>, 开 = true): 组织规则 => ({ ...默认组织规则, 节点推进: { 开, 必填, 生效于: new Date(Date.now() - 3600_000).toISOString() } });

describe("备货状态、物流状态、物流单号 + 节点推进管全部项目（客户 11-19）", () => {
  let 乙: { id: string; name: string; role: string };
  let 老板: { id: string; role: string };
  let 客户: string;

  /** 存量项目：建在两天前（生效时刻之前） */
  const 老项目 = (补: Record<string, unknown> = {}) => prisma.project.create({
    data: { name: "老项目", customerId: 客户, ownerId: 乙.id, creatorId: 乙.id, phase: "订单", node: "生产备货", createdAt: new Date(Date.now() - 2 * 86400_000), ...补 },
  });
  const 现 = (id: string) => prisma.project.findUniqueOrThrow({ where: { id } });
  const 详 = async (id: string) => {
    const r = await 读项目详情(mocks.user as never, id);
    if (r.种 !== "有") throw new Error("没读到");
    return r.props.p;
  };

  beforeEach(async () => {
    await resetDb();
    invalidateSettingsCache();
    vi.stubEnv("CRM_ENTERPRISE", "1");
    await setSetting("business", { projectMode: true });
    const u = await prisma.user.create({ data: { email: "yi", name: "乙", title: "", role: "SALES", password: "x" } });
    乙 = { id: u.id, name: u.name, role: "SALES" };
    const b = await prisma.user.create({ data: { email: "boss", name: "老板", title: "", role: "ADMIN", password: "x" } });
    老板 = { id: b.id, role: "ADMIN" };
    await prisma.entMember.createMany({ data: [{ userId: 乙.id, bizRole: "sales" }, { userId: 老板.id, bizRole: "director" }] });
    mocks.user = { ...mocks.user, id: 乙.id };
    客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "13800000001", salesOwnerId: 乙.id } })).id;
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("三个新字段：改项目读写、空 / 「—」清掉、认不出报错、和现在一样不算改", async () => {
    const p = await 老项目();
    expect(await 改项目(乙, p.id, { stockStatus: "生产中", logisticsStatus: "待发货", trackingNo: "  SF100, SF101 " })).toMatchObject({ ok: true, 变了: expect.arrayContaining(["stockStatus", "logisticsStatus", "trackingNo"]) });
    expect(await 现(p.id)).toMatchObject({ stockStatus: "生产中", logisticsStatus: "待发货", trackingNo: "SF100, SF101" });
    expect(await 改项目(乙, p.id, { stockStatus: "生产中", logisticsStatus: "待发货", trackingNo: "SF100, SF101" })).toEqual({ ok: true, 变了: [] });
    // 认不出 / 不在字典里 / 换行 / 超长：报错，库里不动
    expect(await 改项目(乙, p.id, { stockStatus: "备好了" })).toMatchObject({ ok: false, error: expect.stringContaining("备货状态") });
    expect(await 改项目(乙, p.id, { logisticsStatus: "飞到了" })).toMatchObject({ ok: false });
    expect(await 改项目(乙, p.id, { trackingNo: "SF1\nSF2" })).toMatchObject({ ok: false, error: expect.stringContaining("一行") });
    expect(await 改项目(乙, p.id, { trackingNo: "x".repeat(101) })).toMatchObject({ ok: false });
    expect(await 现(p.id)).toMatchObject({ stockStatus: "生产中", logisticsStatus: "待发货", trackingNo: "SF100, SF101" });
    // 清掉
    expect(await 改项目(乙, p.id, { stockStatus: "__none__", logisticsStatus: null, trackingNo: " " })).toMatchObject({ ok: true });
    expect(await 现(p.id)).toMatchObject({ stockStatus: null, logisticsStatus: null, trackingNo: null });
  });

  it("编辑项目 留操作日志：改了备货状态、物流状态、物流单号", async () => {
    const p = await 老项目();
    expect(await 编辑项目(p.id, { stockStatus: "已备货", logisticsStatus: "运输中", trackingNo: "SF9" })).toMatchObject({ ok: true });
    const 日志 = await prisma.auditLog.findMany({ where: { entity: "Project", entityId: p.id }, select: { summary: true } });
    expect(日志.map((x) => x.summary)).toEqual(["编辑项目「老项目」：改了备货状态、物流单号、物流状态"]);
  });

  it("物流状态字典可改：默认三项；改名、加项后项目页下拉跟着变；停用的不能再选，已存着的照显示", async () => {
    expect((await 企业字典("projLogistics")).map((x) => x.name)).toEqual(["待发货", "运输中", "已签收"]);
    const p = await 老项目({ logisticsStatus: "运输中" });
    expect((await 详(p.id)).备货物流).toEqual({ 备货状态: null, 物流状态: { 值: "运输中", 选项: ["待发货", "运输中", "已签收"] }, 物流单号: null, 已签收: { 名们: ["已签收"], 现名: "已签收", 能选: true } });
    const 项们 = await 企业字典("projLogistics");
    const 签收 = 项们.find((x) => x.name === "已签收")!;
    const 运输 = 项们.find((x) => x.name === "运输中")!;
    expect(await 改字典项(老板, 签收.id, { name: "客户已签收" })).toMatchObject({ ok: true });
    expect(await 加字典项(老板, "projLogistics", "已退回")).toMatchObject({ ok: true });
    expect(await 改字典项(老板, 运输.id, { active: false })).toMatchObject({ ok: true });
    invalidateSettingsCache();
    // 停用的「运输中」这个项目存着：照显示、下拉末尾留着它；别的项目选不到
    expect((await 详(p.id)).备货物流?.物流状态.选项).toEqual(["待发货", "客户已签收", "已退回", "运输中"]);
    const q = await 老项目({ name: "另一个" });
    expect(await 改项目(乙, q.id, { logisticsStatus: "运输中" })).toMatchObject({ ok: false });
    expect(await 改项目(乙, q.id, { logisticsStatus: "客户已签收" })).toMatchObject({ ok: true });
    // 存着停用那项的项目，交回同一个值不算改、不拦
    expect(await 改项目(乙, p.id, { logisticsStatus: "运输中" })).toEqual({ ok: true, 变了: [] });
  });

  it("开着（默认全部）：存量项目缺备货状态被拦，项目页列还差；选了任一项（未生产也算）就自动推到物流运输", async () => {
    await setSetting("orgRules", 开着({ 生产备货: ["备货状态"], 物流运输: ["物流状态", "物流单号"] }));
    const p = await 老项目();
    const 拦 = await 改节点(乙, p.id, { phase: "订单", node: "物流运输" });
    expect(拦.ok).toBe(false);
    expect(!拦.ok && 拦.error).toContain("还差必填：备货状态");
    expect((await 详(p.id)).必填).toMatchObject({ 配了: ["备货状态"], 还差: ["备货状态"] });
    expect(await 改项目(乙, p.id, { stockStatus: "未生产" })).toMatchObject({ ok: true, 自动推到: ["物流运输"] });
    // 物流运输：两样都要
    expect(await 改项目(乙, p.id, { logisticsStatus: "待发货" })).not.toHaveProperty("自动推到");
    expect((await 详(p.id)).必填).toMatchObject({ 还差: ["物流单号"] });
    expect(await 改项目(乙, p.id, { trackingNo: "暂无" })).not.toHaveProperty("自动推到");
    expect(await 改项目(乙, p.id, { trackingNo: "SF123" })).toMatchObject({ ok: true, 自动推到: ["安装实施"] });
  });

  it("开着（默认全部）：存量项目看板拖动预检报还差；客户资料齐了的连带推进也推存量", async () => {
    await setSetting("orgRules", 开着({ 生产备货: ["备货状态"], 潜客培育: ["国家", "来源"] }));
    const p = await 老项目();
    const 预 = await 看板推进预检(p.id, { phase: "订单", node: "物流运输" });
    expect(预).toEqual({ ok: true, 还差: ["备货状态"] });
    const 线索 = await 老项目({ name: "老线索", phase: "线索", node: "潜客培育" });
    await prisma.customerExtra.create({ data: { customerId: 客户, country: "德国", source: "展会" } });
    expect((await 客户项目按必填推进(乙, 客户)).map((x) => x.id)).toEqual([线索.id]);
  });

  it("关着：新老项目都不拦、不自动推，项目页不列还差", async () => {
    await setSetting("orgRules", 开着({ 生产备货: ["备货状态"] }, false));
    const p = await 老项目();
    expect(await 改项目(乙, p.id, { stockStatus: "已备货" })).not.toHaveProperty("自动推到");
    expect((await 详(p.id)).必填).toBeNull();
    expect(await 改节点(乙, p.id, { phase: "订单", node: "物流运输" })).toMatchObject({ ok: true, 变了: true });
  });

  it("设置成只管开启之后新建的：存量照手动推（第 25 题那版还能选回去）", async () => {
    await setSetting("orgRules", { ...开着({ 生产备货: ["备货状态"] }), 节点推进: { ...开着({ 生产备货: ["备货状态"] }).节点推进, 范围: "新建" } });
    const p = await 老项目();
    expect(await 改节点(乙, p.id, { phase: "订单", node: "物流运输" })).toMatchObject({ ok: true, 变了: true });
  });
});
