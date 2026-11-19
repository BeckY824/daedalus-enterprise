/**
 * 节点推进规则定稿（客户 11-19 对《全周期节点必填清单》的回复：「除了第6点必须全员统一规则必须填齐，其他的均按建议进行」），真库：
 *   ① 备货状态要选到「已备货」、物流状态要选到「已签收」才算（已签收按字典默认项 id 认：改名后新名、改名前存的旧名都认；停用了已选的照认）
 *   ② 交付结清只能在「尾款结算」这一步点（改节点问题 服务端拦，首页 AI、看板、接口都走它）；跟「节点推进」开关一起生效（用户定）：
 *      开关关着照旧任一订单节点能点，开了才只在尾款结算；线索流失、丢单、异常不变
 *   ⑤ 同一列宽严两项（备货状态 / 已备货、物流状态 / 已签收）：设置页互斥、补填框去重（宽严互斥、去掉宽的）
 *   ⑥ 「仅上级推」下上级手动推到已齐的节点后停住：项目页给「存一下就推」（load.ts）
 *   ③ 全员统一必须填齐：总管理、销售管理、系统管理员缺必填也不能留空先推（看板预检不再回「能留空推」，项目页不再给「只能靠填齐」）
 *   ④ 填齐自动推进一次只推一格：保存项目字段、客户资料连带推、手动推之后都不连推
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
import { 改节点, 改项目, 客户项目按必填推进, 读必填数据, 终止进程 } from "@/lib/project/db";
import { 改项目画像 } from "@/lib/project/profile";
import { 还差, 宽严互斥, 去掉宽的 } from "@/lib/project/required";
import { 改节点问题, 交付不在尾款话, 企业版字典 } from "@/lib/project/nodes";
import { 看板推进预检 } from "@/app/(app)/projects/actions";
import { 读项目详情 } from "@/app/(app)/projects/[id]/load";
import { 企业字典, 改字典项, 加字典项, 已签收认法, 已签收物流状态 } from "@/lib/enterprise/dict";

const 开着 = (必填: Record<string, string[]>): 组织规则 => ({ ...默认组织规则, 节点推进: { 开: true, 必填 } });

describe("已签收认法（纯函数）", () => {
  const 行 = (id: string, name: string, active = true) => ({ id, name, active });
  it("没建过字典：只认默认名", () => {
    expect(已签收认法([])).toEqual({ 名们: ["已签收"], 现名: "已签收", 停用: false });
  });
  it("按默认项 id（dict-projLogistics-2）认：改了名，新名、改名前的默认名都认", () => {
    expect(已签收认法([行("dict-projLogistics-0", "待发货"), 行("dict-projLogistics-2", "已送达")])).toEqual({ 名们: ["已送达", "已签收"], 现名: "已送达", 停用: false });
  });
  it("改名后又新加了一项叫「已签收」：那是另一项，默认名不再认", () => {
    expect(已签收认法([行("dict-projLogistics-2", "已送达"), 行("x1", "已签收")]).名们).toEqual(["已送达"]);
  });
  it("停用了：照认（已经选上的不作废），标出停用", () => {
    expect(已签收认法([行("dict-projLogistics-2", "已签收", false)])).toEqual({ 名们: ["已签收"], 现名: "已签收", 停用: true });
  });
  it("自己加的同名项（不是默认那一项）不算", () => {
    expect(已签收认法([行("dict-projLogistics-2", "已送达"), 行("x2", "客户签了")]).名们).not.toContain("客户签了");
  });
});

describe("交付结清只在尾款结算（纯函数 改节点问题）", () => {
  const 两勾 = { balanceSettled: true, acceptancePassed: true };
  it("企业版：停在别的订单节点点交付结清被拦；尾款结算能点", () => {
    for (const node of ["生产备货", "物流运输", "安装实施", "交付验收"]) {
      expect(改节点问题({ phase: "订单", node, result: "交付结清" }, { phase: "订单", node, ...两勾 }, undefined, true, 企业版字典)).toBe("「交付结清」只能在「尾款结算」这一步点，先把进程推到「尾款结算」");
    }
    expect(改节点问题({ phase: "订单", node: "尾款结算", result: "交付结清" }, { phase: "订单", node: "尾款结算", ...两勾 }, undefined, true, 企业版字典)).toBeNull();
    // 停在交付验收、交上来的目标写成尾款结算（跳一步再定结局）：照拦
    expect(改节点问题({ phase: "订单", node: "尾款结算", result: "交付结清" }, { phase: "订单", node: "交付验收", ...两勾 }, undefined, true, 企业版字典)).toMatch(/只能在「尾款结算」/);
    // 停在尾款结算、目标节点写成别的：也拦
    expect(交付不在尾款话({ phase: "订单", node: "尾款结算" }, { phase: "订单", node: "安装实施" }, 企业版字典)).toMatch(/只能在「尾款结算」/);
  });
  it("企业版：先看节点再看两勾；尾款结算上缺勾照旧说缺勾", () => {
    expect(改节点问题({ phase: "订单", node: "尾款结算", result: "交付结清" }, { phase: "订单", node: "尾款结算", balanceSettled: false, acceptancePassed: true }, undefined, true, 企业版字典)).toMatch(/尾款结清/);
  });
  it("异常状态、丢单、线索流失不受影响", () => {
    expect(改节点问题({ phase: "订单", node: "物流运输", result: "异常状态" }, { phase: "订单", node: "物流运输", ...两勾 }, { categoryId: "c1" }, true, 企业版字典)).toBeNull();
    expect(改节点问题({ phase: "商机", node: "方案敲定", result: "丢单" }, { phase: "商机", node: "方案敲定", ...两勾 }, { 备注: "价格" }, true, 企业版字典)).toBeNull();
    expect(改节点问题({ phase: "线索", node: "潜客培育", result: "线索流失" }, { phase: "线索", node: "潜客培育", ...两勾 }, { 备注: "没需求" }, true, 企业版字典)).toBeNull();
  });
  it("不查尾款（节点推进开关关着，db.ts 传 false）：企业版订单任一节点两勾齐了照旧能点", () => {
    expect(改节点问题({ phase: "订单", node: "安装实施", result: "交付结清" }, { phase: "订单", node: "安装实施", ...两勾 }, undefined, true, 企业版字典, false)).toBeNull();
  });
  it("不是企业版（团队版字典）：照旧，订单任一节点两勾齐了能点成功交付", () => {
    expect(改节点问题({ phase: "订单", node: "生产备货", result: "成功交付" }, { phase: "订单", node: "生产备货", ...两勾 })).toBeNull();
  });
});

describe("宽严两项互斥 / 去重（纯函数）", () => {
  it("设置页：选了严的去掉宽的，选了宽的去掉严的；老配置两项都在留严的；别的项不动", () => {
    expect(宽严互斥(["备货状态", "场地现状", "已备货"], ["备货状态", "场地现状"])).toEqual(["场地现状", "已备货"]);
    expect(宽严互斥(["已签收", "物流单号", "物流状态"], ["已签收", "物流单号"])).toEqual(["物流单号", "物流状态"]);
    expect(宽严互斥(["物流状态", "已签收"], ["物流状态", "已签收"])).toEqual(["已签收"]);
    expect(宽严互斥(["备货状态", "物流单号"], [])).toEqual(["备货状态", "物流单号"]);
  });
  it("补填框：同一列宽严都缺只留严的；只缺宽的照留", () => {
    expect(去掉宽的(["备货状态", "已备货", "物流单号"])).toEqual(["已备货", "物流单号"]);
    expect(去掉宽的(["物流状态", "已签收"])).toEqual(["已签收"]);
    expect(去掉宽的(["备货状态", "物流状态"])).toEqual(["备货状态", "物流状态"]);
  });
});

describe("节点推进规则定稿（真库）", () => {
  let 乙: { id: string; role: string };
  let 老板: { id: string; role: string };
  let 客户: string;

  const 项目 = (补: Record<string, unknown> = {}) => prisma.project.create({ data: { name: "一号项目", customerId: 客户, ownerId: 乙.id, creatorId: 乙.id, phase: "订单", node: "生产备货", ...补 } });
  const 现 = (id: string) => prisma.project.findUniqueOrThrow({ where: { id } });
  const 详 = async (id: string) => {
    const r = await 读项目详情(mocks.user as never, id);
    if (r.种 !== "有") throw new Error("没读到");
    return r.props.p;
  };
  async function 人(email: string, role: string, bizRole: string) {
    const u = await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } });
    await prisma.entMember.create({ data: { userId: u.id, bizRole } });
    return { id: u.id, role };
  }

  beforeEach(async () => {
    await resetDb();
    invalidateSettingsCache();
    vi.stubEnv("CRM_ENTERPRISE", "1");
    await setSetting("business", { projectMode: true });
    乙 = await 人("yi", "SALES", "sales");
    老板 = await 人("boss", "ADMIN", "director");
    mocks.user = { ...mocks.user, id: 乙.id };
    客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "13800000001", salesOwnerId: 乙.id } })).id;
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  describe("① 已备货 / 已签收", () => {
    it("生产备货配「已备货」：未生产、生产中不推，手动推被拦；选到已备货自动推一格", async () => {
      await setSetting("orgRules", 开着({ 生产备货: ["已备货"] }));
      const p = await 项目();
      expect(await 改项目(乙, p.id, { stockStatus: "生产中" })).not.toHaveProperty("自动推到");
      const 拦 = await 改节点(乙, p.id, { phase: "订单", node: "物流运输" });
      expect(!拦.ok && 拦.error).toBe("「生产备货」还差必填：备货状态（已备货）；补齐再推");
      expect((await 详(p.id)).必填).toEqual({ 配了: ["已备货"], 还差: ["已备货"] });
      expect(await 改项目(乙, p.id, { stockStatus: "已备货" })).toMatchObject({ ok: true, 自动推到: ["物流运输"] });
    });

    it("物流运输配「已签收」+ 物流单号：待发货、运输中不算；已签收 + 单号才推；单号照旧必填", async () => {
      await setSetting("orgRules", 开着({ 物流运输: ["已签收", "物流单号"] }));
      const p = await 项目({ node: "物流运输" });
      expect(await 改项目(乙, p.id, { logisticsStatus: "运输中", trackingNo: "SF1" })).not.toHaveProperty("自动推到");
      expect((await 详(p.id)).必填?.还差).toEqual(["已签收"]);
      expect(await 改项目(乙, p.id, { logisticsStatus: "已签收", trackingNo: null })).not.toHaveProperty("自动推到");
      expect((await 详(p.id)).必填?.还差).toEqual(["物流单号"]);
      expect(await 改项目(乙, p.id, { trackingNo: "SF1" })).toMatchObject({ ok: true, 自动推到: ["安装实施"] });
    });

    it("「已签收」改名成「已送达」：选新名算；改名前已经存了「已签收」的项目照算；别的选项照不算", async () => {
      await setSetting("orgRules", 开着({ 物流运输: ["已签收"] }));
      // 改名前就选了已签收、还停在物流运输（比如那时还没配必填）
      const 旧 = await 项目({ node: "物流运输", logisticsStatus: "已签收" });
      const 签收项 = (await 企业字典("projLogistics")).find((x) => x.name === "已签收")!;
      expect(签收项.id).toBe("dict-projLogistics-2");
      expect(await 改字典项(老板, 签收项.id, { name: "已送达" })).toMatchObject({ ok: true });
      expect(await 已签收物流状态()).toEqual({ 名们: ["已送达", "已签收"], 现名: "已送达", 停用: false });
      // 新项目选新名
      const 新 = await 项目({ name: "二号", node: "物流运输" });
      expect(await 改项目(乙, 新.id, { logisticsStatus: "运输中" })).not.toHaveProperty("自动推到");
      expect(await 改项目(乙, 新.id, { logisticsStatus: "已送达" })).toMatchObject({ ok: true, 自动推到: ["安装实施"] });
      // 旧值「已签收」不在下拉里了（字典里没这个名），项目上存着照算
      expect(还差(开着({ 物流运输: ["已签收"] }), await 读必填数据(prisma as never, await 现(旧.id)))).toEqual([]);
      expect(await 改项目(乙, 旧.id, { remark: "存一下" })).toMatchObject({ ok: true, 自动推到: ["安装实施"] });
      // 项目页给完成节点框的：算数的名字 + 现名
      const 三号 = await 项目({ name: "三号", node: "物流运输" });
      expect((await 详(三号.id)).备货物流?.已签收).toEqual({ 名们: ["已送达", "已签收"], 现名: "已送达", 能选: true });
    });

    it("改名后又新加一项叫「已签收」：那是另一项，选它不算", async () => {
      await setSetting("orgRules", 开着({ 物流运输: ["已签收"] }));
      const 签收项 = (await 企业字典("projLogistics")).find((x) => x.name === "已签收")!;
      await 改字典项(老板, 签收项.id, { name: "已送达" });
      expect(await 加字典项(老板, "projLogistics", "已签收")).toMatchObject({ ok: true });
      const p = await 项目({ node: "物流运输" });
      expect(await 改项目(乙, p.id, { logisticsStatus: "已签收" })).not.toHaveProperty("自动推到");
      expect(await 改项目(乙, p.id, { logisticsStatus: "已送达" })).toMatchObject({ ok: true, 自动推到: ["安装实施"] });
    });

    it("「已签收」停用了：已经选上的照算；没选的项目下拉里选不到，项目页标出选不上", async () => {
      await setSetting("orgRules", 开着({ 物流运输: ["已签收"] }));
      const 已选 = await 项目({ node: "物流运输", logisticsStatus: "已签收" });
      const 签收项 = (await 企业字典("projLogistics")).find((x) => x.name === "已签收")!;
      expect(await 改字典项(老板, 签收项.id, { active: false })).toMatchObject({ ok: true });
      invalidateSettingsCache();
      expect((await 详(已选.id)).备货物流?.已签收).toMatchObject({ 能选: true });
      expect(await 改项目(乙, 已选.id, { remark: "存一下" })).toMatchObject({ ok: true, 自动推到: ["安装实施"] });
      const 没选 = await 项目({ name: "二号", node: "物流运输" });
      expect((await 详(没选.id)).备货物流?.已签收).toEqual({ 名们: ["已签收"], 现名: "已签收", 能选: false });
      expect(await 改项目(乙, 没选.id, { logisticsStatus: "已签收" })).toMatchObject({ ok: false });
    });
  });

  describe("② 交付结清只在尾款结算（跟节点推进开关一起生效）", () => {
    beforeEach(async () => { await setSetting("orgRules", 开着({})); invalidateSettingsCache(); });
    it("开关关着：照旧，订单中间节点两勾齐了就能点交付结清；项目页不查尾款", async () => {
      await setSetting("orgRules", { ...默认组织规则, 节点推进: { 开: false, 必填: {} } });
      invalidateSettingsCache();
      const p = await 项目({ node: "安装实施", balanceSettled: true, acceptancePassed: true });
      expect((await 详(p.id)).交付只在尾款).toBe(false);
      expect(await 改节点(乙, p.id, { phase: "订单", node: "安装实施", result: "交付结清" })).toMatchObject({ ok: true, 变了: true });
      expect((await 现(p.id)).result).toBe("交付结清");
    });
    it("开关开着、范围只管新建的：生效之前建的存量项目照旧能在中间节点点（和节点推进管同一个判断）", async () => {
      await setSetting("orgRules", { ...默认组织规则, 节点推进: { 开: true, 必填: {}, 范围: "新建", 生效于: new Date().toISOString() } });
      invalidateSettingsCache();
      const 老 = await 项目({ node: "交付验收", balanceSettled: true, acceptancePassed: true, createdAt: new Date(Date.now() - 86400_000) });
      expect((await 详(老.id)).交付只在尾款).toBe(false);
      expect(await 改节点(乙, 老.id, { phase: "订单", node: "交付验收", result: "交付结清" })).toMatchObject({ ok: true });
    });
    it("开关开着：两勾都齐，停在交付验收点交付结清被拦（目标写尾款结算也拦）；推到尾款结算再点才成", async () => {
      const p = await 项目({ node: "交付验收", balanceSettled: true, acceptancePassed: true });
      const 拦 = await 改节点(乙, p.id, { phase: "订单", node: "交付验收", result: "交付结清" });
      expect(!拦.ok && 拦.error).toBe("「交付结清」只能在「尾款结算」这一步点，先把进程推到「尾款结算」");
      expect(await 改节点(乙, p.id, { phase: "订单", node: "尾款结算", result: "交付结清" })).toMatchObject({ ok: false });
      expect(await 现(p.id)).toMatchObject({ node: "交付验收", result: null });
      expect(await 改节点(乙, p.id, { phase: "订单", node: "尾款结算" })).toMatchObject({ ok: true });
      expect(await 改节点(乙, p.id, { phase: "订单", node: "尾款结算", result: "交付结清" })).toMatchObject({ ok: true, 变了: true });
      expect((await 现(p.id)).result).toBe("交付结清");
    });

    it("异常状态停在生产备货：不能直接改成交付结清；异常停在尾款结算能", async () => {
      const 类 = await prisma.projectExceptionCategory.create({ data: { name: "纠纷取消" } });
      const p = await 项目({ node: "生产备货", balanceSettled: true, acceptancePassed: true });
      expect(await 终止进程(乙, p.id, { categoryId: 类.id })).toMatchObject({ ok: true });
      expect(await 改节点(乙, p.id, { phase: "订单", node: "生产备货", result: "交付结清" })).toMatchObject({ ok: false });
      const q = await 项目({ name: "二号", node: "尾款结算", balanceSettled: true, acceptancePassed: true });
      expect(await 终止进程(乙, q.id, { categoryId: 类.id })).toMatchObject({ ok: true });
      expect(await 改节点(乙, q.id, { phase: "订单", node: "尾款结算", result: "交付结清" })).toMatchObject({ ok: true });
    });

    it("项目页：开关开着给 交付只在尾款，停在别的订单节点交付卡写清要先推到尾款结算", async () => {
      const p = await 项目({ node: "安装实施" });
      const x = await 详(p.id);
      expect(x).toMatchObject({ phase: "订单", node: "安装实施", 交付只在尾款: true });
      expect(交付不在尾款话(x, null, 企业版字典)).toMatch(/先把进程推到「尾款结算」/);
    });
  });

  describe("③ 全员统一必须填齐", () => {
    const 规则 = () => 开着({ 生产备货: ["已备货"] });
    it("销售管理推自己负责的、系统管理员推别人的、总管理推自己负责的：缺必填都拦", async () => {
      await setSetting("orgRules", 规则());
      const 经理 = await 人("mgr", "MANAGER", "sales_mgr");
      const 经理的 = await 项目({ ownerId: 经理.id, creatorId: 经理.id });
      expect(await 改节点(经理, 经理的.id, { phase: "订单", node: "物流运输" })).toMatchObject({ ok: false, error: expect.stringContaining("还差必填") });
      const 乙的 = await 项目({ name: "二号" });
      expect(await 改节点(老板, 乙的.id, { phase: "订单", node: "物流运输" })).toMatchObject({ ok: false, error: expect.stringContaining("还差必填") });
      const 总管理的 = await 项目({ name: "三号", ownerId: 老板.id, creatorId: 老板.id });
      expect(await 改节点(老板, 总管理的.id, { phase: "订单", node: "物流运输" })).toMatchObject({ ok: false, error: expect.stringContaining("还差必填") });
      for (const id of [经理的.id, 乙的.id, 总管理的.id]) expect((await 现(id)).node).toBe("生产备货");
      // 填齐了谁都能推（往后退照旧不看必填）
      await prisma.project.update({ where: { id: 经理的.id }, data: { stockStatus: "已备货" } });
      expect(await 改节点(经理, 经理的.id, { phase: "订单", node: "物流运输" })).toMatchObject({ ok: true, 变了: true });
      expect(await 改节点(经理, 经理的.id, { phase: "订单", node: "生产备货" })).toMatchObject({ ok: true, 变了: true });
    });

    it("看板预检只回还差（不再有能留空推）；项目页必填不再带只能靠填齐", async () => {
      await setSetting("orgRules", 规则());
      const p = await 项目();
      mocks.user = { ...mocks.user, id: 老板.id, role: "ADMIN" };
      expect(await 看板推进预检(p.id, { phase: "订单", node: "物流运输" })).toEqual({ ok: true, 还差: ["备货状态（已备货）"] });
      mocks.user = { ...mocks.user, id: 乙.id, role: "SALES" };
      expect((await 详(p.id)).必填).toEqual({ 配了: ["已备货"], 还差: ["已备货"] });
    });
  });

  describe("④ 一次只推一格", () => {
    // 生产备货、物流运输、安装实施都配了，后两个一开始就齐了
    const 规则 = () => 开着({ 生产备货: ["已备货"], 物流运输: ["物流单号"], 安装实施: ["场地现状"] });
    it("保存项目字段：填齐生产备货只推到物流运输，物流运输已齐也停着；之后每存一次推一格", async () => {
      await setSetting("orgRules", 规则());
      const p = await 项目({ trackingNo: "SF1", siteStatus: "已有场地" });
      expect(await 改项目(乙, p.id, { stockStatus: "已备货" })).toMatchObject({ ok: true, 自动推到: ["物流运输"] });
      expect((await 现(p.id)).node).toBe("物流运输");
      expect(await prisma.projectNodeLog.count({ where: { projectId: p.id } })).toBe(1);
      expect(await 改项目(乙, p.id, { remark: "存一下" })).toMatchObject({ ok: true, 自动推到: ["安装实施"] });
      expect(await 改项目(乙, p.id, { remark: "再存一下" })).toMatchObject({ ok: true, 自动推到: ["交付验收"] });
      // 交付验收没配：不推
      expect(await 改项目(乙, p.id, { remark: "又存一下" })).not.toHaveProperty("自动推到");
      expect((await 现(p.id)).node).toBe("交付验收");
    });

    it("手动推到一个已经齐了的节点：就停在那（手动推本身是这一格），不接着自动推", async () => {
      await setSetting("orgRules", 规则());
      const p = await 项目({ stockStatus: "已备货", trackingNo: "SF1", siteStatus: "已有场地" });
      const r = await 改节点(乙, p.id, { phase: "订单", node: "物流运输" });
      expect(r).toEqual({ ok: true, 变了: true });
      expect((await 现(p.id)).node).toBe("物流运输");
    });

    it("客户资料连带推：每个项目也只推一格", async () => {
      await setSetting("orgRules", 开着({ 痛点挖掘: ["国家"], 方案敲定: ["来源"] }));
      const p = await 项目({ phase: "商机", node: "痛点挖掘" });
      await prisma.customerExtra.create({ data: { customerId: 客户, country: "德国", source: "展会" } });
      expect(await 客户项目按必填推进(乙, 客户)).toEqual([{ id: p.id, name: "一号项目", 到: ["方案敲定"] }]);
      expect((await 现(p.id)).node).toBe("方案敲定");
      expect(await 客户项目按必填推进(乙, 客户)).toEqual([{ id: p.id, name: "一号项目", 到: ["成交推进"] }]);
    });

    it("退回的、已结束的、在公海的不推", async () => {
      await setSetting("orgRules", 规则());
      const p = await 项目({ node: "物流运输", trackingNo: "SF1", stockStatus: "已备货" });
      expect(await 改节点(乙, p.id, { phase: "订单", node: "生产备货" })).toMatchObject({ ok: true });
      expect(await 改项目(乙, p.id, { remark: "退回来存一下" })).not.toHaveProperty("自动推到");
      const 结 = await 项目({ name: "二号", stockStatus: "已备货", result: "异常状态" });
      expect(await 改项目(乙, 结.id, { remark: "存" })).not.toHaveProperty("自动推到");
      expect((await 现(结.id)).node).toBe("生产备货");
    });
  });

  describe("⑦ 项目画像补齐最后一项也自动推（不只需求状态）", () => {
    it("痛点挖掘配痛点标注 + 预算能力：先写痛点不推，画像选了预算能力推到方案敲定；同值再存不推、不连推", async () => {
      await setSetting("orgRules", 开着({ 痛点挖掘: ["痛点标注", "预算能力"], 方案敲定: ["决策链路"] }));
      const p = await 项目({ phase: "商机", node: "痛点挖掘", decisionChain: "多部门决策" });
      expect(await 改项目(乙, p.id, { painPoints: "排产慢" })).not.toHaveProperty("自动推到");
      expect((await 详(p.id)).必填?.还差).toEqual(["预算能力"]);
      expect(await 改项目画像(乙, p.id, { budgetLevel: "预算充足" })).toEqual({ ok: true, 变了: ["budgetLevel"], 自动推到: ["方案敲定"] });
      // 方案敲定的决策链路一开始就齐：一次一格，停在方案敲定
      expect((await 现(p.id)).node).toBe("方案敲定");
      // 没变的不算保存：不推
      expect(await 改项目画像(乙, p.id, { budgetLevel: "预算充足", decisionChain: "多部门决策" })).toEqual({ ok: true, 变了: [] });
      expect((await 现(p.id)).node).toBe("方案敲定");
      // 画像别的项变了：按必填再推一格
      expect(await 改项目画像(乙, p.id, { priceSense: "价格认可" })).toMatchObject({ ok: true, 自动推到: ["成交推进"] });
    });

    it("需求类型（多选）补齐也推；节点推进关着、项目在公海里不推", async () => {
      await setSetting("orgRules", 开着({ 痛点挖掘: ["需求类型"] }));
      const p = await 项目({ phase: "商机", node: "痛点挖掘" });
      expect(await 改项目画像(乙, p.id, { productNeeds: ["常规标品"] })).toMatchObject({ ok: true, 自动推到: ["方案敲定"] });
      await setSetting("orgRules", { ...默认组织规则, 节点推进: { 开: false, 必填: { 痛点挖掘: ["预算能力"] } } });
      invalidateSettingsCache();
      const q = await 项目({ name: "二号", phase: "商机", node: "痛点挖掘" });
      expect(await 改项目画像(乙, q.id, { budgetLevel: "预算充足" })).toEqual({ ok: true, 变了: ["budgetLevel"] });
      expect((await 现(q.id)).node).toBe("痛点挖掘");
      await setSetting("orgRules", 开着({ 痛点挖掘: ["预算能力"] }));
      invalidateSettingsCache();
      const 公海 = await 项目({ name: "三号", phase: "商机", node: "痛点挖掘", pooledAt: new Date() });
      // 公海里的项目先领取才能改：改不了也就推不了
      expect(await 改项目画像(乙, 公海.id, { budgetLevel: "预算充足" })).toMatchObject({ ok: false });
      expect((await 现(公海.id)).node).toBe("痛点挖掘");
    });
  });

  describe("跨阶段不自动推", () => {
    it("线索推进、首款到账填齐了：存了不推、停在本格，项目页没有存一下就推；手动点完成节点照推；同阶段照旧自动推一格", async () => {
      await setSetting("orgRules", 开着({ 线索推进: ["金额"], 首款到账: ["定金金额"], 痛点挖掘: ["痛点标注"] }));
      const 线 = await 项目({ phase: "线索", node: "线索推进", demandStatus: "明确需求" });
      expect(await 改项目(乙, 线.id, { amount: 1000 })).toEqual({ ok: true, 变了: ["amount"] });
      expect((await 现(线.id)).node).toBe("线索推进");
      expect((await 详(线.id)).必填).toEqual({ 配了: ["金额"], 还差: [] });
      // 客户资料连带推也不跨
      expect(await 客户项目按必填推进(乙, 客户)).toEqual([]);
      const 推 = await 改节点(乙, 线.id, { phase: "商机", node: "痛点挖掘" });
      expect(推, JSON.stringify(推)).toEqual({ ok: true, 变了: true });
      // 进了商机：同阶段照旧自动推一格
      expect(await 改项目(乙, 线.id, { painPoints: "排产慢" })).toMatchObject({ ok: true, 自动推到: ["方案敲定"] });
      const 款 = await 项目({ name: "二号", phase: "商机", node: "首款到账" });
      expect(await 改项目(乙, 款.id, { depositAmount: 500 })).not.toHaveProperty("自动推到");
      expect((await 现(款.id)).node).toBe("首款到账");
      expect(await 改节点(乙, 款.id, { phase: "订单", node: "生产备货" })).toMatchObject({ ok: true, 变了: true });
    });
  });

  describe("不给推时谁能点「完成节点」（load.ts 不给推谁能推，项目页必填齐了那句用）", () => {
    it("仅上级推：负责人 → 上级；负责人可推：组员 → 负责人（上级只看、只转让）、负责人能推没有；需求补全期 → 销售管理或总管理", async () => {
      const 组长 = await 人("lead", "MANAGER", "sales_mgr");
      const 丙 = await 人("bing", "SALES", "sales");
      await prisma.entMember.update({ where: { userId: 乙.id }, data: { managerId: 组长.id } });
      await setSetting("enterprise.rule.org_scope", true);
      const p = await 项目();
      await prisma.projectMember.create({ data: { projectId: p.id, userId: 丙.id, inviteStatus: "JOINED" } });
      await setSetting("orgRules", { ...默认组织规则, 阶段: { ...默认组织规则.阶段, 推进权限: "仅上级推" as const } });
      invalidateSettingsCache();
      expect(await 详(p.id)).toMatchObject({ 不给推: "往前推进程要由你的直属上级来推", 不给推谁能推: "上级" });
      await setSetting("orgRules", 默认组织规则);
      invalidateSettingsCache();
      expect(await 详(p.id)).toMatchObject({ 不给推: null, 不给推谁能推: null });
      mocks.user = { ...mocks.user, id: 丙.id };
      expect(await 详(p.id)).toMatchObject({ 不给推: "只有负责人能往前推进程", 不给推谁能推: "负责人" });
      mocks.user = { ...mocks.user, id: 乙.id };
      await setSetting("orgRules", { ...默认组织规则, 阶段: { ...默认组织规则.阶段, 需求补全期: true } });
      invalidateSettingsCache();
      expect(await 详(p.id)).toMatchObject({ 不给推谁能推: "销售管理或总管理" });
    });
  });

  describe("⑥ 仅上级推：上级推到已齐的节点停住，项目页说存一下就推", () => {
    it("直属上级手动推到齐了的物流运输：停住；负责人看项目页有 存一下就推，存一下推一格；没齐、负责人可推时都没有", async () => {
      const 组长 = await 人("lead", "MANAGER", "sales_mgr");
      await prisma.entMember.update({ where: { userId: 乙.id }, data: { managerId: 组长.id } });
      await setSetting("enterprise.rule.org_scope", true);
      const 仅上级 = { ...开着({ 生产备货: ["已备货"], 物流运输: ["物流单号"] }), 阶段: { ...默认组织规则.阶段, 推进权限: "仅上级推" as const } };
      await setSetting("orgRules", 仅上级);
      invalidateSettingsCache();
      const p = await 项目({ stockStatus: "已备货", trackingNo: "SF1" });
      // 生产备货已齐，负责人自己看：仅上级推下也能存一下推走，先看提示
      expect((await 详(p.id)).必填).toEqual({ 配了: ["已备货"], 还差: [], 存一下就推: true });
      expect(await 改节点(组长, p.id, { phase: "订单", node: "物流运输" })).toEqual({ ok: true, 变了: true });
      expect((await 现(p.id)).node).toBe("物流运输");
      expect((await 详(p.id)).必填).toEqual({ 配了: ["物流单号"], 还差: [], 存一下就推: true });
      // 提示写「值没变不算」：原样再存一遍不推
      expect(await 改项目(乙, p.id, { trackingNo: "SF1" })).toEqual({ ok: true, 变了: [] });
      expect((await 现(p.id)).node).toBe("物流运输");
      expect(await 改项目(乙, p.id, { remark: "存一下" })).toMatchObject({ ok: true, 自动推到: ["安装实施"] });
      // 没齐：没有
      const q = await 项目({ name: "二号" });
      expect((await 详(q.id)).必填).toEqual({ 配了: ["已备货"], 还差: ["已备货"] });
      // 负责人可推：没有（负责人自己点完成节点就行）
      await setSetting("orgRules", 开着({ 生产备货: ["已备货"] }));
      invalidateSettingsCache();
      const r = await 项目({ name: "三号", stockStatus: "已备货" });
      expect((await 详(r.id)).必填).toEqual({ 配了: ["已备货"], 还差: [] });
    });
  });
});
