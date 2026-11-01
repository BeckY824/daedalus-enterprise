/**
 * 企业版卡点（2026-10-26，11-01 定稿改版 B1–B16）：
 *   - 三态：待接受 → 处理中 → 已解决；看得到就能认领，一人一行，进度 x/y；各自点「我已完成」，最后一位写解决方案和结果 → 已解决、锁定
 *   - 没有指认 / 转让 / 退回 / 撤回认领 / 移除认领人
 *   - 老数据改版：看板 → 待接受；待接受 → 待接受、清指认；处理中 → 处理中、经手人 = 第一位认领人；重跑不多出行
 *   - 谁看得到：按业务角色两个开关（启用、只看自己 / 可看全部）；只看自己 = 创建人、项目负责人（不在公海时）、组员、认领人，
 *     加上创建人 / 负责人的上级链（实线整条链 + 虚线，同项目列表的组织范围「读」）；没设业务角色 = 没有任何卡点权限
 *   - 管理员（业务角色 admin，不兼总管理）只读：看全部，发、认领、完成、改、删、原因管理都拒；删卡点、删原因只有总管理（director）
 *   - 离职交接：给交接人 → 没交接人给直属上级（实线）→ 都没有就从 x/y 去掉并记日志
 *   - 项目换人（B5）：公海领取 / 分配、改负责人、客户转让带着走 → 原负责人没完成的认领行给新负责人；移出组员 → 他的给项目负责人；
 *     进公海时原样留着，历史负责人在公海期间凭认领行、创建人都看不到（C-01）
 *   - 老数据（B9）：老阻碍主体不归类，老卡点不挂原因，详情显示原阻碍主体，统计进「未分类（老数据）」
 *   - 暂无卡点不生成；编号 BLK-YYYYMMDD-NNN（北京日子）；沟通彻底删了卡点还在
 *   - 阻碍原因字典：11 个种子、增删改停合并，前台新加的进待审核
 * 测试数据全是虚构的人名
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import dayjs from "dayjs";
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 记项目沟通, 放回公海, 领取公海项目, 改项目, 移出组员 } from "@/lib/project/db";
import { 转项目 } from "@/lib/carry-over-db";
import { 领客户带走公海项目 } from "@/lib/enterprise/pool-link";
import { 公海规则 } from "@/lib/enterprise/pool-rules";
import * as 卡点模块 from "@/lib/project/blocker";
import {
  发布卡点, 认领卡点, 完成卡点, 交接卡点, 卡点随项目换人, 项目的卡点, 我的卡点, 能发卡点, 卡点看板, 卡点权限,
  存卡点默认, 读卡点默认, 存卡点角色开关, 离职交接理由, 离职转上级理由, 离职去掉理由, 卡点脱离沟通, 删卡点,
  原因字典, 可选原因们, 新增原因, 改原因名, 改原因状态, 删原因, 合并原因,
  公海领走接手理由, 转让接手理由, 移出组员接手理由,
} from "@/lib/project/blocker";
import { 卡点改版, 卡点改版记号键 } from "@/lib/project/blocker-migrate";
import {
  时限提醒of, 编号日, 规整发布, 默认卡点默认, 改版后, 原因种子们, 会签进度, 默认卡点角色开关, 卡点权限of,
  卡点只读, 能管卡点, 未分类原因id, 未分类原因名,
} from "@/lib/project/blocker-rules";
import { 清过期 } from "@/lib/enterprise/soft-delete";
import { 读组织 } from "@/lib/enterprise/org";
import { 组织范围of } from "@/lib/enterprise/visibility";
import { 看已删 } from "@/lib/enterprise/soft-delete-core";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";

type 人 = { id: string; role: string };
const 天 = 24 * 3600_000;

describe("企业版卡点", () => {
  // 老板 = 总管理员（director）；组长 = 销售的直属上级；虚 = 销售的虚线上级；散 / 散主管 = 别组；没角色 = 账号是 ADMIN 但没设业务角色
  let 老板: 人, 组长: 人, 虚: 人, 销售: 人, 组员: 人, 散: 人, 散主管: 人, 没角色: 人;
  let 客户: string, 项目: string;
  const now = new Date();
  // 按本地（测试 TZ=Asia/Shanghai）的日子算
  const 今天 = dayjs(now).format("YYYY-MM-DD");

  async function 建(email: string, role = "SALES"): Promise<人> {
    const u = await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } });
    return { id: u.id, role };
  }
  async function 沟通(me: 人 = 销售, pid = 项目) {
    const r = await 记项目沟通(me, pid, { type: "PHONE", content: "对方说预算要等下月", occurredAt: 今天, 下一步时间: 今天, 阶段: "线索", 明确回复: true }, now);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    return r.followUpId!;
  }
  const 卡 = { title: "预算没批", reasons: ["价格预算分歧"], description: "报价比别家高一成，财务卡着" };
  async function 发(me: 人 = 销售, input: Parameters<typeof 发布卡点>[2] = 卡, when: Date = now, pid = 项目) {
    const r = await 发布卡点(me, await 沟通(me, pid), input, when);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.id).toBeTruthy();
    return r as { ok: true; id: string; code: string; projectId: string };
  }
  const 行 = (id: string) => prisma.entBlocker.findUniqueOrThrow({ where: { id } });
  const 认领行们 = (blockerId: string) => prisma.entBlockerClaim.findMany({ where: { blockerId }, orderBy: { createdAt: "asc" } });
  const 流转 = (blockerId: string) => prisma.entBlockerLog.findMany({ where: { blockerId }, orderBy: { at: "asc" } });

  beforeEach(async () => {
    await resetDb();
    invalidateSettingsCache();
    老板 = await 建("boss");
    组长 = await 建("lead");
    虚 = await 建("dotted");
    销售 = await 建("sales");
    组员 = await 建("member");
    散 = await 建("loose");
    散主管 = await 建("loose-mgr");
    没角色 = await 建("no-role", "ADMIN");
    await prisma.entMember.createMany({
      data: [
        { userId: 老板.id, bizRole: "director" },
        { userId: 组长.id, bizRole: "sales_mgr" },
        { userId: 虚.id, bizRole: "sales_mgr" },
        { userId: 销售.id, bizRole: "sales", managerId: 组长.id, dottedManagerId: 虚.id },
        { userId: 组员.id, bizRole: "sales", managerId: 组长.id },
        { userId: 散主管.id, bizRole: "sales_mgr" },
        { userId: 散.id, bizRole: "sales", managerId: 散主管.id },
        { userId: 没角色.id, bizRole: "" }, // 库里默认是 sales，这里明着清空
      ],
    });
    客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "", salesOwnerId: 销售.id } })).id;
    项目 = (await prisma.project.create({ data: { name: "一期", customerId: 客户, ownerId: 销售.id, creatorId: 销售.id } })).id;
    await prisma.projectMember.create({ data: { projectId: 项目, userId: 组员.id, inviteStatus: "JOINED" } });
    vi.stubEnv("CRM_ENTERPRISE", "1");
    await setSetting("enterprise.rule.org_scope", true);
    invalidateSettingsCache();
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("发布 → 待接受；认领 → 处理中；多人认领 x/y；各点我已完成，最后一位写方案和结果 → 已解决、锁定", async () => {
    const b = await 发();
    let row = await 行(b.id);
    expect(row).toMatchObject({ status: "待接受", creatorId: 销售.id, type: "中度卡点", impact: "短期不影响", title: "预算没批", projectId: 项目, assigneeId: null });
    expect((await prisma.entBlockerReasonLink.findMany({ where: { blockerId: b.id }, include: { reason: true } })).map((l) => l.reason.name)).toEqual(["价格预算分歧"]);

    expect(await 认领卡点(组员, b.id)).toMatchObject({ ok: true, code: b.code });
    expect((await 行(b.id)).status).toBe("处理中");
    expect(await 认领卡点(组员, b.id)).toMatchObject({ ok: false, error: "你已经认领了" });
    expect(await 认领卡点(组长, b.id)).toMatchObject({ ok: true });

    let v = (await 项目的卡点(销售, 项目)).find((x) => x.id === b.id)!;
    expect(v.进度).toEqual({ 完成: 0, 共: 2 });
    expect(v.认领.map((c) => c.名字)).toEqual(["member", "lead"]);
    expect(v.能).toEqual({ 认领: true, 完成: false, 最后一个: false, 删: false });
    expect(v.原阻碍主体).toBeNull(); // 新卡点挂了原因，不显示原阻碍主体
    expect((await 项目的卡点(老板, 项目)).find((x) => x.id === b.id)!.能.删).toBe(true);

    // 我已完成只给认领人自己：没认领的点不了
    expect(await 完成卡点(销售, b.id, {})).toMatchObject({ ok: false, error: "你没认领这个卡点" });
    expect(await 完成卡点(组员, b.id, { note: "跟财务对过了" }, now)).toMatchObject({ ok: true, 解决了: false });
    expect(await 完成卡点(组员, b.id, {})).toMatchObject({ ok: false, error: "你已经点过完成了" });
    v = (await 项目的卡点(组长, 项目)).find((x) => x.id === b.id)!;
    expect(v.进度).toEqual({ 完成: 1, 共: 2 });
    expect(v.能).toEqual({ 认领: false, 完成: true, 最后一个: true, 删: false });

    // 没解决前还能再加人
    expect(await 认领卡点(销售, b.id)).toMatchObject({ ok: true });
    expect(await 完成卡点(组长, b.id, { note: "批了" })).toMatchObject({ ok: true, 解决了: false });
    // 最后一位：方案、结果必填
    expect(await 完成卡点(销售, b.id, { solution: "分两期付" })).toMatchObject({ ok: false, error: expect.stringContaining("解决结果") });
    expect(await 完成卡点(销售, b.id, { note: "我这边也好了", solution: "分两期付", result: "签了" }, now)).toMatchObject({ ok: true, 解决了: true });
    row = await 行(b.id);
    expect(row).toMatchObject({ status: "已解决", solution: "分两期付", result: "签了" });
    expect(row.resolvedAt?.getTime()).toBe(now.getTime());
    // 每个人的处理说明都留着
    expect((await 认领行们(b.id)).map((c) => [c.done, c.note])).toEqual([[true, "跟财务对过了"], [true, "批了"], [true, "我这边也好了"]]);

    // 锁定：不能再认领、不能再点完成
    expect(await 认领卡点(散主管, b.id)).toMatchObject({ ok: false });
    expect(await 认领卡点(老板, b.id)).toMatchObject({ ok: false, error: expect.stringContaining("已经解决") });
    expect(await 完成卡点(销售, b.id, { solution: "x", result: "y" })).toMatchObject({ ok: false, error: expect.stringContaining("已经解决") });
    expect((await 流转(b.id)).map((l) => l.action)).toEqual(["publish", "claim", "claim", "done", "claim", "done", "done", "resolve"]);
  });

  it("同时点：同一人连点两次只算一次；最后两位同时点只解决一次", async () => {
    const b = await 发();
    await 认领卡点(组员, b.id);
    await 认领卡点(组长, b.id);
    const 两下 = await Promise.all([完成卡点(组员, b.id, { note: "a" }), 完成卡点(组员, b.id, { note: "b" })]);
    expect(两下.filter((r) => r.ok)).toHaveLength(1);
    expect(两下.find((r) => !r.ok)).toMatchObject({ error: "你已经点过完成了" });

    // 再加一位，剩两位同时点（都带方案结果）
    await 认领卡点(销售, b.id);
    const 同时 = await Promise.all([
      完成卡点(组长, b.id, { solution: "方案一", result: "结果一" }),
      完成卡点(销售, b.id, { solution: "方案二", result: "结果二" }),
    ]);
    expect(同时.every((r) => r.ok)).toBe(true);
    expect(同时.filter((r) => r.ok && r.解决了)).toHaveLength(1);
    expect((await 流转(b.id)).filter((l) => l.action === "resolve")).toHaveLength(1);
    expect((await 行(b.id)).status).toBe("已解决");
    expect(会签进度(await 认领行们(b.id))).toEqual({ 完成: 3, 共: 3, 齐了: true });
  });

  it("没有撤回认领、移除认领人、指认、转让、退回：模块里就没有这些动作", () => {
    const 名们 = Object.keys(卡点模块);
    for (const 不该有 of ["指认卡点", "接受卡点", "转让卡点", "返回卡点", "改卡点进度", "解决卡点", "撤回认领", "取消认领", "移除认领人"]) {
      expect(名们).not.toContain(不该有);
    }
    expect(名们.filter((k) => /撤|退|移除|取消/.test(k))).toEqual([]);
  });

  it("暂无卡点：不生成记录、不占编号", async () => {
    const r = await 发布卡点(销售, await 沟通(), { type: "暂无卡点", description: "" }, now);
    expect(r).toEqual({ ok: true });
    expect(await prisma.entBlocker.count()).toBe(0);
    const b = await 发();
    expect(b.code).toBe(`BLK-${编号日(now)}-001`);
  });

  it("编号：BLK-YYYYMMDD-NNN，按北京日子当天往下排，隔天从 001；老编号不动也不干扰", async () => {
    const d1 = new Date("2026-11-01T03:00:00Z"); // 北京 11-01 11:00
    const d2 = new Date("2026-11-01T17:00:00Z"); // 伦敦还是 11-01，北京已经 11-02 01:00
    await prisma.entBlocker.create({
      data: { code: "BLK20261101999", projectId: 项目, followUpId: await 沟通(), customerId: 客户, phase: "线索", type: "中度卡点", impact: "短期不影响", obstacle: "价格", description: "老数据", dueDays: 3, dueAt: d1, status: "待接受", creatorId: 销售.id },
    });
    expect((await 发(销售, 卡, d1)).code).toBe("BLK-20261101-001");
    expect((await 发(组员, 卡, d1)).code).toBe("BLK-20261101-002");
    expect((await 发(销售, 卡, d1)).code).toBe("BLK-20261101-003");
    expect((await 发(销售, 卡, d2)).code).toBe("BLK-20261102-001");
    expect(await prisma.entBlocker.count({ where: { code: "BLK20261101999" } })).toBe(1);
  });

  it("发布：要从项目沟通来；负责人、组员、负责人的直属上级、总管理员能发，无关的人、虚线上级不能；标题没填取描述前 20 字", async () => {
    expect(await 发布卡点(销售, "nope", 卡)).toMatchObject({ ok: false, error: expect.stringContaining("沟通") });
    const f = await 沟通();
    expect(await 发布卡点(散, f, 卡)).toMatchObject({ ok: false });
    expect(await 发布卡点(虚, f, 卡)).toMatchObject({ ok: false });
    expect(await 能发卡点(组员, 项目)).toBe(true);
    expect(await 能发卡点(组长, 项目)).toBe(true);
    expect(await 能发卡点(老板, 项目)).toBe(true);
    expect(await 能发卡点(散, 项目)).toBe(false);
    expect(await 发布卡点(销售, f, { description: "" })).toMatchObject({ ok: false, error: "写一句卡在哪" });
    const r = await 发布卡点(组长, f, { description: "一二三四五六七八九十一二三四五六七八九十多出来的字" }, now);
    expect(r.ok).toBe(true);
    const row = await 行(r.id!);
    expect(row.title).toBe("一二三四五六七八九十一二三四五六七八九十");
    // 一个原因没选：落「其他」
    expect((await prisma.entBlockerReasonLink.findMany({ where: { blockerId: r.id! }, include: { reason: true } })).map((l) => l.reason.name)).toEqual(["其他"]);
  });

  describe("谁看得到（只认业务角色）", () => {
    it("默认：总管理员可看全部；其余只看自己——创建人、负责人、组员、认领人和他们的上级（实线、虚线）看得到，别人按 id 点也是不在了", async () => {
      const b = await 发();
      for (const p of [老板, 组长, 虚, 销售, 组员]) expect((await 项目的卡点(p, 项目)).map((x) => x.id), p.id).toEqual([b.id]);
      for (const p of [散, 散主管]) expect(await 项目的卡点(p, 项目)).toEqual([]);
      expect(await 认领卡点(散, b.id)).toMatchObject({ ok: false, error: expect.stringContaining("不在了") });
      expect(await 认领卡点(散主管, b.id)).toMatchObject({ ok: false, error: expect.stringContaining("不在了") });
      // 看得到就能认领：总管理员、直属上级、虚线上级都能认领
      expect(await 认领卡点(老板, b.id)).toMatchObject({ ok: true });
      expect(await 认领卡点(组长, b.id)).toMatchObject({ ok: true });
      expect(await 认领卡点(虚, b.id)).toMatchObject({ ok: true });
    });

    it("账号是 ADMIN 但没设业务角色：什么都没有", async () => {
      const b = await 发();
      expect(await 卡点权限(没角色)).toEqual({ 开: false, 全部: false, 能写: false, 能管: false });
    expect(await 发布卡点(没角色, await 沟通(), 卡)).toMatchObject({ ok: false, error: expect.stringContaining("业务角色") });
    expect(await 删卡点(没角色, b.id)).toMatchObject({ ok: false });
    expect(await 新增原因(没角色, "随便")).toMatchObject({ ok: false });
      expect(await 项目的卡点(没角色, 项目)).toEqual([]);
      expect(await 认领卡点(没角色, b.id)).toMatchObject({ ok: false, error: expect.stringContaining("业务角色") });
      expect(await 存卡点角色开关(没角色, { 范围: { sales: "全部" } })).toMatchObject({ ok: false, error: "只有总管理员能改" });
    });

    it("角色开关：总管理员改；销售主管改成可看全部 → 别组主管也看得到、能认领；销售停用 → 发不了也看不到", async () => {
      const b = await 发();
      const 留着的沟通 = await 沟通();
      expect(await 存卡点角色开关(组长, { 范围: { sales_mgr: "全部" } })).toMatchObject({ ok: false, error: "只有总管理员能改" });
      expect(await 存卡点角色开关(老板, { 范围: { sales_mgr: "奇怪" } })).toMatchObject({ ok: false });
      expect(await 存卡点角色开关(老板, { 范围: { sales_mgr: "全部" } })).toMatchObject({ ok: true });
      invalidateSettingsCache();
      expect((await 项目的卡点(散主管, 项目)).map((x) => x.id)).toEqual([b.id]);
      expect(await 认领卡点(散主管, b.id)).toMatchObject({ ok: true });
      // 看板上可看全部的人能切「只看自己」
      expect((await 卡点看板(散主管, { 只看自己: true })).栏.处理中.map((x) => x.id)).toEqual([b.id]); // 认领了，算自己的
      expect((await 卡点看板(虚, {})).栏.处理中.map((x) => x.id)).toEqual([b.id]);
      // 只看自己也有上级链：虚 是负责人的虚线上级，照样在
      expect((await 卡点看板(虚, { 只看自己: true })).栏.处理中.map((x) => x.id)).toEqual([b.id]);

      expect(await 存卡点角色开关(老板, { 启用: { sales: false } })).toMatchObject({ ok: true });
      invalidateSettingsCache();
      expect(await 项目的卡点(销售, 项目)).toEqual([]);
      expect(await 发布卡点(销售, 留着的沟通, 卡)).toMatchObject({ ok: false, error: expect.stringContaining("业务角色没开卡点") });
    });

    it("规矩：多个业务角色——任一启用就开，启用的里任一可看全部就全部", () => {
      expect(默认卡点角色开关.范围.director).toBe("全部");
      expect(默认卡点角色开关.范围.admin).toBe("全部");
      expect(默认卡点角色开关.范围.sales).toBe("自己");
      expect(卡点权限of([], 默认卡点角色开关)).toEqual({ 开: false, 全部: false });
      expect(卡点权限of(["sales", "admin"], 默认卡点角色开关)).toEqual({ 开: true, 全部: true });
      const 停 = { ...默认卡点角色开关, 启用: { ...默认卡点角色开关.启用, admin: false } };
      expect(卡点权限of(["sales", "admin"], 停)).toEqual({ 开: true, 全部: false });
    });

    it("项目负责人的直属上级看得到（不在公海时）；进公海后负责人、负责人上级都看不到", async () => {
      const 散的项目 = (await prisma.project.create({ data: { name: "四期", customerId: 客户, ownerId: 散.id, creatorId: 散.id } })).id;
      const b = await 发(散, 卡, now, 散的项目);
      // 创建人换成组员：散主管 只剩「负责人的直属上级」这一条线
      await prisma.entBlocker.update({ where: { id: b.id }, data: { creatorId: 组员.id } });
      for (const p of [散主管, 散, 组员, 组长]) expect((await 项目的卡点(p, 散的项目)).map((x) => x.id), p.id).toEqual([b.id]);
      expect((await 卡点看板(散主管)).栏.待接受.map((x) => x.id)).toEqual([b.id]);
      expect(await 项目的卡点(虚, 散的项目)).toEqual([]);
      expect(await 认领卡点(散主管, b.id)).toMatchObject({ ok: true });
      await prisma.project.update({ where: { id: 散的项目 }, data: { pooledAt: new Date() } });
      expect((await 项目的卡点(散主管, 散的项目)).map((x) => x.id)).toEqual([b.id]); // 他认领了，按认领人看得到
      await prisma.entBlockerClaim.deleteMany({ where: { blockerId: b.id } });
      expect(await 项目的卡点(散主管, 散的项目)).toEqual([]);
      expect(await 项目的卡点(散, 散的项目)).toEqual([]);
      expect(await 卡点看板(散主管).then((d) => [...d.栏.待接受, ...d.栏.处理中])).toEqual([]);
      // 创建人、创建人直属上级照旧
      expect((await 项目的卡点(组员, 散的项目)).map((x) => x.id)).toEqual([b.id]);
      expect((await 项目的卡点(组长, 散的项目)).map((x) => x.id)).toEqual([b.id]);
    });

    it("上级链（11-01 复盘范围）：间接上级、虚线上级、虚线下属的实线下属都看得到，和项目列表的组织范围一致；进公海后不凭负责人这条线看", async () => {
      // 大主管 → 组长 → 销售（实线两级）；虚2 虚线管 组长；虚上 是 虚 的实线上级
      const 大主管 = await 建("big-mgr");
      const 虚2 = await 建("dotted-2");
      const 虚上 = await 建("dotted-up");
      await prisma.entMember.createMany({ data: [
        { userId: 大主管.id, bizRole: "sales_mgr" }, { userId: 虚2.id, bizRole: "sales_mgr" }, { userId: 虚上.id, bizRole: "sales_mgr" },
      ] });
      await prisma.entMember.update({ where: { userId: 组长.id }, data: { managerId: 大主管.id, dottedManagerId: 虚2.id } });
      await prisma.entMember.update({ where: { userId: 虚.id }, data: { managerId: 虚上.id } });
      const b = await 发(); // 销售 发、销售 负责
      for (const p of [大主管, 组长, 虚, 虚2]) {
        expect((await 项目的卡点(p, 项目)).map((x) => x.id), p.id).toEqual([b.id]);
        expect((await 卡点看板(p)).栏.待接受.map((x) => x.id), p.id).toEqual([b.id]);
      }
      expect((await 我的卡点(大主管)).map((x) => x.id)).toEqual([b.id]);
      // 虚线只往下走一跳再顺实线：虚 的实线上级不因此看到 虚 的虚线下属；别组主管看不到
      for (const p of [虚上, 散主管]) expect(await 项目的卡点(p, 项目), p.id).toEqual([]);
      // 和项目列表同一套：组织范围of 的「读」里有负责人 ⇔ 卡点看得到
      const org = await 读组织();
      for (const p of [大主管, 组长, 虚, 虚2, 虚上, 散主管]) {
        const 范围 = 组织范围of(org, "SALES", p.id)!;
        expect((范围.读 ?? 范围.写).includes(销售.id), p.id).toBe((await 项目的卡点(p, 项目)).length > 0);
      }
      expect(await 认领卡点(大主管, b.id)).toMatchObject({ ok: true });
      expect(await 认领卡点(虚上, b.id)).toMatchObject({ ok: false, error: expect.stringContaining("不在了") });

      // 第二条：创建人换成别组的人，只剩负责人这条线；进公海后上级们（实线、虚线）都看不到，创建人的上级照旧
      const b2 = await 发();
      await prisma.entBlocker.update({ where: { id: b2.id }, data: { creatorId: 散.id } });
      for (const p of [大主管, 虚2, 散主管]) expect((await 项目的卡点(p, 项目)).map((x) => x.id), p.id).toContain(b2.id);
      await prisma.project.update({ where: { id: 项目 }, data: { pooledAt: new Date() } });
      for (const p of [大主管, 组长, 虚, 虚2]) expect((await 项目的卡点(p, 项目)).map((x) => x.id), p.id).not.toContain(b2.id);
      expect((await 项目的卡点(散主管, 项目)).map((x) => x.id)).toEqual([b2.id]);
      // 大主管 认领过的那条照样凭认领行看得到
      expect((await 项目的卡点(大主管, 项目)).map((x) => x.id)).toContain(b.id);
    });

    it("管理员（业务角色 admin）只读：看全部，发、认领、完成、改设置、管原因、删都拒；兼总管理就能写", async () => {
      const 管 = await 建("admin-only");
      const 兼 = await 建("admin-director");
      await prisma.entMember.createMany({ data: [{ userId: 管.id, bizRole: "admin" }, { userId: 兼.id, bizRole: "admin,director" }] });
      expect(卡点只读(["admin"])).toBe(true);
      expect(卡点只读(["admin", "director"])).toBe(false);
      expect(卡点只读(["sales"])).toBe(false);
      expect(能管卡点(["admin"])).toBe(false);
      expect(能管卡点(["director"])).toBe(true);
      expect(await 卡点权限(管)).toEqual({ 开: true, 全部: true, 能写: false, 能管: false });
      expect(await 卡点权限(兼)).toEqual({ 开: true, 全部: true, 能写: true, 能管: true });

      const b = await 发();
      const v = (await 项目的卡点(管, 项目)).find((x) => x.id === b.id)!;
      expect(v.能).toEqual({ 认领: false, 完成: false, 最后一个: false, 删: false });
      expect((await 卡点看板(管)).栏.待接受.map((x) => x.id)).toEqual([b.id]);
      const 只读 = expect.stringContaining("管理员只能看卡点");
      expect(await 能发卡点(管, 项目)).toBe(false);
      expect(await 发布卡点(管, await 沟通(), 卡)).toMatchObject({ ok: false, error: 只读 });
      expect(await 认领卡点(管, b.id)).toMatchObject({ ok: false, error: 只读 });
      expect(await 完成卡点(管, b.id, { solution: "s", result: "r" })).toMatchObject({ ok: false, error: 只读 });
      expect(await 存卡点默认(管, { 默认类型: "轻度卡点" })).toMatchObject({ ok: false });
      expect(await 存卡点角色开关(管, { 范围: { sales: "全部" } })).toMatchObject({ ok: false, error: "只有总管理员能改" });
      expect(await 新增原因(管, "管理员加的")).toMatchObject({ ok: false });
      const 其他 = (await 原因字典()).find((r) => r.name === "其他")!;
      expect(await 改原因状态(管, 其他.id, "停用")).toMatchObject({ ok: false });
      expect(await 删原因(管, 其他.id)).toMatchObject({ ok: false });
      expect(await 删卡点(管, b.id)).toMatchObject({ ok: false, error: "只有总管理员能删卡点" });
      expect(await prisma.entBlocker.count()).toBe(1);
      expect(await 认领卡点(兼, b.id)).toMatchObject({ ok: true });
    });

    it("删卡点：只有总管理（director）；认领行、流转、原因挂接一起删；删了就没了", async () => {
      const b = await 发();
      await 认领卡点(组员, b.id);
      expect(await 删卡点(组长, b.id)).toMatchObject({ ok: false, error: "只有总管理员能删卡点" });
      expect(await 删卡点(销售, b.id)).toMatchObject({ ok: false, error: "只有总管理员能删卡点" });
      expect(await 删卡点(老板, "没有这条")).toMatchObject({ ok: false, error: expect.stringContaining("不在了") });
      expect(await 删卡点(老板, b.id)).toMatchObject({ ok: true, code: b.code, projectId: 项目 });
      expect(await prisma.entBlocker.count({ where: { id: b.id } })).toBe(0);
      expect(await prisma.entBlockerClaim.count({ where: { blockerId: b.id } })).toBe(0);
      expect(await prisma.entBlockerLog.count({ where: { blockerId: b.id } })).toBe(0);
      expect(await prisma.entBlockerReasonLink.count({ where: { blockerId: b.id } })).toBe(0);
      // 删原因也只有总管理
      const 没用的 = (await 原因字典()).find((r) => r.name === "合同条款争议")!;
      expect(await 删原因(组长, 没用的.id)).toMatchObject({ ok: false });
      expect(await 删原因(老板, 没用的.id)).toMatchObject({ ok: true });
    });

    it("复盘页卡点列表和项目详情走同一个可见规矩：只看自己的人，看板里的卡点 = 各项目详情里的并起来；看不到的认领也是不在了", async () => {
      const 散的项目 = (await prisma.project.create({ data: { name: "五期", customerId: 客户, ownerId: 散.id, creatorId: 散.id } })).id;
      const 公海项目 = (await prisma.project.create({ data: { name: "六期", customerId: 客户, ownerId: 组员.id, creatorId: 组员.id } })).id;
      const 们 = [await 发(), await 发(组员), await 发(散, 卡, now, 散的项目), await 发(组员, 卡, now, 公海项目)];
      await 认领卡点(散主管, 们[2].id);
      await prisma.entBlocker.update({ where: { id: 们[3].id }, data: { creatorId: 老板.id } });
      await prisma.project.update({ where: { id: 公海项目 }, data: { pooledAt: new Date() } });
      for (const p of [组长, 虚, 销售, 组员, 散, 散主管]) {
        expect((await 卡点权限(p)).全部, p.id).toBe(false);
        const 板 = await 卡点看板(p);
        const 板ids = [...板.栏.待接受, ...板.栏.处理中, ...板.栏.已解决].map((x) => x.id).sort();
        const 详情ids = (await Promise.all([项目, 散的项目, 公海项目].map((pid) => 项目的卡点(p, pid)))).flat().map((x) => x.id).sort();
        expect(板ids, p.id).toEqual(详情ids);
        expect((await 我的卡点(p)).every((x) => 详情ids.includes(x.id)), p.id).toBe(true);
        for (const b of 们) if (!详情ids.includes(b.id)) expect(await 认领卡点(p, b.id), `${p.id} ${b.id}`).toMatchObject({ ok: false, error: expect.stringContaining("不在了") });
      }
      // 公海项目：负责人（组员）不再凭负责人身份看到；组员也不是创建人 → 看不到
      expect(await 项目的卡点(组员, 公海项目)).toEqual([]);
    });

    it("项目进公海：负责人不再算相关人（不公开），创建人、认领人照旧", async () => {
      const 散的项目 = (await prisma.project.create({ data: { name: "二期", customerId: 客户, ownerId: 散.id, creatorId: 散.id } })).id;
      const b = await 发(散, 卡, now, 散的项目);
      await 认领卡点(组员, b.id).then((r) => expect(r.ok).toBe(false)); // 组员不在这个项目组
      await prisma.project.update({ where: { id: 散的项目 }, data: { pooledAt: new Date() } });
      expect((await 项目的卡点(散, 散的项目)).map((x) => x.id)).toEqual([b.id]); // 他是创建人
      await prisma.entBlocker.update({ where: { id: b.id }, data: { creatorId: 组长.id } });
      expect(await 项目的卡点(散, 散的项目)).toEqual([]);
      expect(await 项目的卡点(组员, 散的项目)).toEqual([]);
    });
  });

  it("离职交接：有交接人给交接人（和已有行合并时退回未完成）；进公海的项目给直属上级；已解决的不动；都记一行", async () => {
    const 项目乙 = (await prisma.project.create({ data: { name: "三期", customerId: 客户, ownerId: 销售.id, creatorId: 销售.id } })).id;
    await prisma.projectMember.create({ data: { projectId: 项目乙, userId: 组员.id, inviteStatus: "JOINED" } });
    const 甲 = await 发();
    const 乙 = await 发(销售, 卡, now, 项目乙);
    const 丙 = await 发();
    const 丁 = await 发();
    for (const b of [甲, 乙, 丙, 丁]) await 认领卡点(组员, b.id);
    await 认领卡点(销售, 丙.id);
    await 完成卡点(销售, 丙.id, { note: "我这边好了" });
    // 丁 已解决
    await 完成卡点(组员, 丁.id, { solution: "s", result: "r" });

    // 组员 走，交接人 = 销售；项目乙 跟着进公海 → 组员的直属上级（组长）接
    const n = await prisma.$transaction((tx) => 交接卡点(tx, 组员.id, 销售.id, 老板.id, [项目乙]));
    expect(n).toBe(3);
    expect((await 认领行们(甲.id)).map((c) => [c.userId, c.done])).toEqual([[销售.id, false]]);
    expect((await 认领行们(乙.id)).map((c) => [c.userId, c.done])).toEqual([[组长.id, false]]);
    // 接手人已认领且点过完成：组员那行并进来，接手人那行退回未完成（多了一份活）
    expect((await 认领行们(丙.id)).map((c) => [c.userId, c.done])).toEqual([[销售.id, false]]);
    expect((await 认领行们(丁.id)).map((c) => [c.userId, c.done])).toEqual([[组员.id, true]]);
    expect((await 流转(甲.id)).at(-1)).toMatchObject({ action: "handover", userId: 老板.id, fromUserId: 组员.id, toUserId: 销售.id, note: 离职交接理由 });
    expect((await 流转(乙.id)).at(-1)).toMatchObject({ action: "handover", fromUserId: 组员.id, toUserId: 组长.id, note: 离职转上级理由 });
    expect((await 行(甲.id)).status).toBe("处理中");
  });

  it("离职交接：没交接人 → 直属上级（实线，虚线不算）；上级也停用了 → 认领行去掉、记日志，一个不剩的回待接受", async () => {
    const 甲 = await 发();
    const 乙 = await 发();
    await 认领卡点(组员, 甲.id);
    await 认领卡点(组员, 乙.id);
    await 认领卡点(散, 乙.id).then((r) => expect(r.ok).toBe(false)); // 散 看不到
    await 认领卡点(老板, 乙.id);

    // 销售 有实线上级 组长、虚线上级 虚：没交接人 → 组长
    await 认领卡点(销售, 甲.id);
    expect(await prisma.$transaction((tx) => 交接卡点(tx, 销售.id, null, 老板.id, []))).toBe(1);
    expect((await 认领行们(甲.id)).map((c) => c.userId)).toEqual([组员.id, 组长.id]);

    // 组员 的上级 组长 也停用了 → 去掉
    await prisma.user.update({ where: { id: 组长.id }, data: { active: false } });
    expect(await prisma.$transaction((tx) => 交接卡点(tx, 组员.id, null, 老板.id, []))).toBe(2);
    expect((await 认领行们(甲.id)).map((c) => c.userId)).toEqual([组长.id]);
    expect((await 行(甲.id)).status).toBe("处理中");
    expect((await 认领行们(乙.id)).map((c) => c.userId)).toEqual([老板.id]);
    expect((await 流转(乙.id)).at(-1)).toMatchObject({ action: "handover", fromUserId: 组员.id, toUserId: null, note: 离职去掉理由 });

    // 只剩一个认领人的走了、没人接 → 回待接受，进度 0/0
    const 丙 = await 发();
    await 认领卡点(组员, 丙.id);
    await prisma.$transaction((tx) => 交接卡点(tx, 组员.id, null, 老板.id, []));
    expect(await 认领行们(丙.id)).toEqual([]);
    expect((await 行(丙.id)).status).toBe("待接受");
    expect((await 项目的卡点(老板, 项目)).find((x) => x.id === 丙.id)!.进度).toEqual({ 完成: 0, 共: 0 });
  });

  describe("B5 项目换人：卡点认领行跟着走", () => {
    afterEach(() => {
      公海规则.项目能单独领 = false;
      公海规则.原负责人看得到公海项目 = false;
    });
    const 谁认领 = async (blockerId: string) => (await 认领行们(blockerId)).map((c) => c.userId);
    const 看到 = async (me: 人) => ({
      项目里: (await 项目的卡点(me, 项目)).map((x) => x.id).sort(),
      我的: (await 我的卡点(me)).map((x) => x.id).sort(),
      看板: Object.values((await 卡点看板(me, { 只看自己: true })).栏).flat().map((x) => x.id).sort(),
    });

    it("进公海：认领行原样留着；历史负责人凭认领行、创建人都看不到（C-01），总管理员和组员照看；从公海领走 → 认领行给领走的人", async () => {
      const 甲 = await 发(); // 销售发的
      const 乙 = await 发(组员); // 组员发的，销售认领
      await 认领卡点(销售, 甲.id);
      await 认领卡点(销售, 乙.id);
      const 两条 = [甲.id, 乙.id].sort();
      expect(await 看到(销售)).toEqual({ 项目里: 两条, 我的: 两条, 看板: 两条 });

      expect(await 放回公海(销售, 项目)).toEqual({ ok: true });
      expect((await prisma.project.findUniqueOrThrow({ where: { id: 项目 } })).ownerId).toBe("");
      expect(await 谁认领(甲.id)).toEqual([销售.id]);
      expect(await 谁认领(乙.id)).toEqual([销售.id]);
      // 历史负责人：列表、我的、看板都没有，单条认领 / 完成也当不在了
      expect(await 看到(销售)).toEqual({ 项目里: [], 我的: [], 看板: [] });
      expect(await 完成卡点(销售, 乙.id, { solution: "x", result: "y" })).toMatchObject({ ok: false, error: "这个卡点已经不在了，刷新看看" });
      expect(await 认领卡点(销售, 乙.id)).toMatchObject({ ok: false, error: "这个卡点已经不在了，刷新看看" });
      // 组员（项目组还在）、总管理员照看；不公开：别组的看不到
      expect((await 项目的卡点(组员, 项目)).map((x) => x.id).sort()).toEqual([甲.id, 乙.id].sort());
      expect((await 项目的卡点(老板, 项目)).length).toBe(2);
      expect(await 项目的卡点(散, 项目)).toEqual([]);
      // 规则改成原负责人看得到公海项目：回到凭认领行 / 创建人看
      公海规则.原负责人看得到公海项目 = true;
      expect((await 看到(销售)).项目里).toEqual([甲.id, 乙.id].sort());
      公海规则.原负责人看得到公海项目 = false;

      公海规则.项目能单独领 = true;
      expect(await 领取公海项目(散, 项目)).toEqual({ ok: true });
      expect(await 谁认领(甲.id)).toEqual([散.id]);
      expect(await 谁认领(乙.id)).toEqual([散.id]);
      expect((await 流转(乙.id)).at(-1)).toMatchObject({ action: "takeover", userId: 散.id, fromUserId: 销售.id, toUserId: 散.id, note: 公海领走接手理由 });
      // 项目不在公海了：销售照旧凭创建人看甲，乙（组员发的、认领行已给出去）看不到
      expect((await 项目的卡点(销售, 项目)).map((x) => x.id)).toEqual([甲.id]);
    });

    it("领客户带走公海里的项目：历史负责人的认领行一起给领走的人", async () => {
      const 甲 = await 发();
      await 认领卡点(销售, 甲.id);
      expect(await 放回公海(销售, 项目)).toEqual({ ok: true });
      await prisma.customer.update({ where: { id: 客户 }, data: { salesOwnerId: 散.id } });
      expect(await 领客户带走公海项目([客户], 散.id, 散主管.id)).toEqual([项目]);
      expect(await 谁认领(甲.id)).toEqual([散.id]);
      expect((await 流转(甲.id)).at(-1)).toMatchObject({ action: "takeover", userId: 散主管.id, fromUserId: 销售.id, toUserId: 散.id, note: 公海领走接手理由 });
    });

    it("改项目换负责人 → 认领行给新负责人；移出组员 → 他的认领行给项目负责人；客户转让带着走跟着，离职那条不跟（交接卡点管）", async () => {
      const 甲 = await 发();
      const 乙 = await 发();
      await 认领卡点(组员, 甲.id);
      await 认领卡点(销售, 乙.id);
      expect(await 改项目(销售, 项目, { name: "一期", ownerId: 组长.id })).toMatchObject({ ok: true });
      expect(await 谁认领(乙.id)).toEqual([组长.id]);
      expect(await 谁认领(甲.id)).toEqual([组员.id]); // 别人的不动
      expect((await 流转(乙.id)).at(-1)).toMatchObject({ action: "takeover", userId: 销售.id, fromUserId: 销售.id, toUserId: 组长.id, note: 转让接手理由 });

      const m = await prisma.projectMember.findFirstOrThrow({ where: { projectId: 项目, userId: 组员.id } });
      expect(await 移出组员(组长, m.id)).toEqual({ ok: true });
      expect(await 谁认领(甲.id)).toEqual([组长.id]);
      expect((await 流转(甲.id)).at(-1)).toMatchObject({ action: "takeover", userId: 组长.id, fromUserId: 组员.id, toUserId: 组长.id, note: 移出组员接手理由 });

      // 离职那条（转项目 卡点跟着 = false）：项目转了，认领行不动
      await prisma.$transaction((tx) => 转项目(tx, { id: 项目 }, 散.id, 老板.id, false));
      expect(await 谁认领(乙.id)).toEqual([组长.id]);
      // 客户转让带着走（默认跟着）
      await prisma.$transaction((tx) => 转项目(tx, { id: 项目 }, 散主管.id, 老板.id));
      expect(await 谁认领(乙.id)).toEqual([组长.id]); // 从 散 转过来的，组长 的行不归 散，不动
      await prisma.project.update({ where: { id: 项目 }, data: { ownerId: 组长.id } });
      await prisma.$transaction((tx) => 转项目(tx, { id: 项目 }, 散.id, 老板.id));
      expect(await 谁认领(乙.id)).toEqual([散.id]);
      expect(await 谁认领(甲.id)).toEqual([散.id]);
    });

    it("公海里移出组员：没负责人，认领行原样留着；不是企业版什么都不挪", async () => {
      const 甲 = await 发();
      await 认领卡点(组员, 甲.id);
      expect(await 放回公海(销售, 项目)).toEqual({ ok: true });
      const m = await prisma.projectMember.findFirstOrThrow({ where: { projectId: 项目, userId: 组员.id } });
      expect(await prisma.$transaction(async (tx) => { await tx.projectMember.delete({ where: { id: m.id } }); return 卡点随项目换人(tx, 项目, 组员.id, "", 老板.id); })).toBe(0);
      expect(await 谁认领(甲.id)).toEqual([组员.id]);
      vi.stubEnv("CRM_ENTERPRISE", "");
      expect(await prisma.$transaction((tx) => 卡点随项目换人(tx, 项目, 组员.id, 散.id))).toBe(0);
      expect(await 谁认领(甲.id)).toEqual([组员.id]);
    });
  });

  it("沟通记录彻底删了（回收站到期清掉）：卡点还在，只是不再挂着沟通", async () => {
    const b = await 发();
    const f = (await 行(b.id)).followUpId!;
    await 看已删(() => prisma.followUp.update({ where: { id: f }, data: { deletedAt: new Date(Date.now() - 40 * 天) } }));
    const 数 = await 清过期(new Date());
    expect(数.FollowUp).toBe(1);
    expect(await 看已删(() => prisma.followUp.count({ where: { id: f } }))).toBe(0);
    const row = await 行(b.id);
    expect(row.followUpId).toBeNull();
    expect(row.code).toBe(b.code);
    expect((await 项目的卡点(销售, 项目)).map((x) => x.id)).toEqual([b.id]);
    // 没挂卡点的沟通：照常
    expect((await prisma.$transaction((tx) => 卡点脱离沟通(tx, ["没有这条"]))).size).toBe(0);
  });

  describe("阻碍原因字典", () => {
    it("11 个种子；只有总管理员能增删改停合并；用过的只能停用；合并把卡点挪过去", async () => {
      const 字典 = await 原因字典();
      expect(字典.map((r) => r.name)).toEqual([...原因种子们]);
      expect(字典.every((r) => r.status === "启用")).toBe(true);
      expect(await 新增原因(组长, "场地没定")).toMatchObject({ ok: false, error: "只有总管理员能改" });
      const 新 = await 新增原因(老板, "场地没定");
      expect(新).toMatchObject({ ok: true });
      expect(await 新增原因(老板, "场地没定")).toMatchObject({ ok: false });
      expect(await 改原因名(老板, 新.id!, "场地还没定")).toMatchObject({ ok: true });
      expect(await 可选原因们()).toContain("场地还没定");

      const b = await 发(销售, { ...卡, reasons: ["场地还没定", "需求变更"] });
      expect(await 删原因(老板, 新.id!)).toMatchObject({ ok: false, error: expect.stringContaining("只能停用") });
      const 没用的 = (await 原因字典()).find((r) => r.name === "合同条款争议")!;
      expect(await 删原因(老板, 没用的.id)).toMatchObject({ ok: true });

      const 需求 = (await 原因字典()).find((r) => r.name === "需求变更")!;
      expect(await 改原因状态(老板, 需求.id, "停用")).toMatchObject({ ok: true });
      expect(await 可选原因们()).not.toContain("需求变更");
      // 停用的不能当合并目标
      expect(await 合并原因(老板, 新.id!, 需求.id)).toMatchObject({ ok: false });
      const 其他 = (await 原因字典()).find((r) => r.name === "其他")!;
      expect(await 合并原因(老板, 新.id!, 其他.id)).toMatchObject({ ok: true, 挪了: 1 });
      const 挂的 = await prisma.entBlockerReasonLink.findMany({ where: { blockerId: b.id }, include: { reason: true } });
      expect(挂的.map((l) => l.reason.name).sort()).toEqual(["其他", "需求变更"].sort());
      expect((await 原因字典()).find((r) => r.id === 新.id)).toMatchObject({ status: "停用", 并入: "其他" });
      // 发布选了被并走的原因 → 落到并入的那个；单纯停用的报错
      const c = await 发(销售, { ...卡, reasons: ["场地还没定"] });
      expect((await prisma.entBlockerReasonLink.findMany({ where: { blockerId: c.id }, include: { reason: true } })).map((l) => l.reason.name)).toEqual(["其他"]);
      expect(await 发布卡点(销售, await 沟通(), { ...卡, reasons: ["需求变更"] })).toMatchObject({ ok: false, error: expect.stringContaining("已停用") });
    });

    it("前台新加的原因 → 待审核，挂在卡点上、进统计；总管理员启用 = 审核通过", async () => {
      const b = await 发(销售, { ...卡, reasons: ["对方换了领导"] });
      const r = (await 原因字典()).find((x) => x.name === "对方换了领导")!;
      expect(r).toMatchObject({ status: "待审核", 用了: 1 });
      expect(await 可选原因们()).not.toContain("对方换了领导");
      const 看板 = await 卡点看板(老板);
      expect(看板.统计.按原因).toContainEqual({ id: r.id, 名: "对方换了领导", 状态: "待审核", 数: 1 });
      expect((await 卡点看板(老板, { 原因: r.id })).栏.待接受.map((x) => x.id)).toEqual([b.id]);
      expect(await 改原因状态(老板, r.id, "启用")).toMatchObject({ ok: true });
      expect(await 可选原因们()).toContain("对方换了领导");
    });
  });

  it("复盘看板：三栏、筛选（我的认领、类型、影响、项目）、统计（未解决 / 已解决、按影响）", async () => {
    const a = await 发(销售, { ...卡, impact: "项目暂停" });
    const b = await 发(销售, { ...卡, type: "重要卡点" });
    const c = await 发();
    await 认领卡点(组员, b.id);
    await 认领卡点(组员, c.id);
    await 完成卡点(组员, c.id, { solution: "s", result: "r" });
    const 全 = await 卡点看板(老板);
    expect(全).toMatchObject({ 开: true, 全部: true, 已解决共: 1 });
    expect(全.栏.待接受.map((x) => x.id)).toEqual([a.id]);
    expect(全.栏.处理中.map((x) => x.id)).toEqual([b.id]);
    expect(全.栏.已解决.map((x) => x.id)).toEqual([c.id]);
    expect(全.统计).toMatchObject({ 未解决: 2, 已解决: 1 });
    expect(全.统计.按影响.find((x) => x.名 === "项目暂停")?.数).toBe(1);
    expect(全.项目们).toEqual([{ id: 项目, name: "一期" }]);
    expect((await 卡点看板(组员, { 我的认领: true })).栏.处理中.map((x) => x.id)).toEqual([b.id]);
    expect((await 卡点看板(老板, { 类型: "重要卡点" })).统计.未解决).toBe(1);
    expect((await 卡点看板(老板, { 影响: "项目暂停" })).栏.待接受.map((x) => x.id)).toEqual([a.id]);
    expect((await 卡点看板(老板, { 项目: "别的" })).统计).toMatchObject({ 未解决: 0, 已解决: 0 });
    // 我的卡点：我认领了没完成的 + 我相关的待接受
    expect((await 我的卡点(组员)).map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("卡点默认：总管理员能改，坏值报错；发布按新默认", async () => {
    expect(await 存卡点默认(组长, { 默认类型: "轻度卡点" })).toMatchObject({ ok: false });
    expect(await 存卡点默认(老板, { 默认类型: "乱写" })).toMatchObject({ ok: false });
    expect(await 存卡点默认(老板, { 默认类型: "轻度卡点", 默认影响: "可能丢单" })).toMatchObject({ ok: true });
    invalidateSettingsCache();
    expect(await 读卡点默认()).toEqual({ 默认类型: "轻度卡点", 默认影响: "可能丢单" });
    const b = await 发(销售, { description: "x" });
    expect(await 行(b.id)).toMatchObject({ type: "轻度卡点", impact: "可能丢单" });
  });

  it("老数据改版：看板 / 待接受 / 处理中 / 已解决 按规矩改，标题补上；老阻碍主体不归类（不挂原因、显示原阻碍主体、统计进未分类）；重跑不多出行", async () => {
    const f = await 沟通();
    const 老 = async (code: string, status: string, assigneeId: string | null, obstacle: string, description: string) =>
      (await prisma.entBlocker.create({
        data: { code, projectId: 项目, followUpId: f, customerId: 客户, phase: "线索", type: "中度卡点", impact: "短期不影响", obstacle, description, dueDays: 3, dueAt: now, status, assigneeId, creatorId: 销售.id, ...(status === "已解决" ? { solution: "s", result: "r", resolvedAt: now } : {}) },
      })).id;
    const 看板 = await 老("BLK20261020001", "看板", null, "价格", "老卡点一的描述写得比较长要截前二十个字的多余部分");
    const 待接受 = await 老("BLK20261020002", "待接受", 组员.id, "竞品", "老卡点二");
    const 处理中 = await 老("BLK20261020003", "处理中", 组员.id, "客户", "老卡点三");
    const 没人处理中 = await 老("BLK20261020004", "处理中", null, "技术", "老卡点四");
    const 解决 = await 老("BLK20261020005", "已解决", 组长.id, "老板拍板", "老卡点五");

    expect(await 卡点改版()).toBe(5);
    expect(await 行(看板)).toMatchObject({ status: "待接受", assigneeId: null, title: "老卡点一的描述写得比较长要截前二十个字的" });
    expect(await 认领行们(看板)).toEqual([]);
    expect(await 行(待接受)).toMatchObject({ status: "待接受", assigneeId: null });
    expect(await 认领行们(待接受)).toEqual([]);
    expect(await 行(处理中)).toMatchObject({ status: "处理中", assigneeId: null });
    expect((await 认领行们(处理中)).map((c) => [c.userId, c.done])).toEqual([[组员.id, false]]);
    expect((await 行(没人处理中)).status).toBe("待接受");
    expect(await 行(解决)).toMatchObject({ status: "已解决", code: "BLK20261020005" });
    expect((await 认领行们(解决)).map((c) => [c.userId, c.done])).toEqual([[组长.id, true]]);
    // B9：老卡点一个原因都不挂，也不从老值生成待审核原因（「客户」也不映射）
    expect(await prisma.entBlockerReasonLink.count()).toBe(0);
    expect((await 原因字典()).map((r) => r.name)).toEqual([...原因种子们]);
    const 视图们 = await 项目的卡点(老板, 项目);
    expect(视图们.find((x) => x.id === 处理中)?.原阻碍主体).toBe("客户");
    expect(视图们.find((x) => x.id === 解决)?.原阻碍主体).toBe("老板拍板");
    // 统计：全进「未分类（老数据）」；按它筛 = 没挂原因的
    const 新 = await 发();
    expect(视图们.length + 1).toBe((await 项目的卡点(老板, 项目)).length);
    expect((await 项目的卡点(老板, 项目)).find((x) => x.id === 新.id)?.原阻碍主体).toBeNull();
    const 板 = await 卡点看板(老板);
    expect(板.统计.按原因).toContainEqual({ id: 未分类原因id, 名: 未分类原因名, 状态: "未分类", 数: 5 });
    expect(板.原因们.at(-1)).toEqual({ id: 未分类原因id, name: 未分类原因名, status: "未分类" });
    const 筛 = await 卡点看板(老板, { 原因: 未分类原因id });
    expect([...筛.栏.待接受, ...筛.栏.处理中, ...筛.栏.已解决].map((x) => x.id).sort()).toEqual([看板, 待接受, 处理中, 没人处理中, 解决].sort());

    // 记号在：不再跑；记号丢了重跑：不多出行
    expect(await 卡点改版()).toBe(0);
    await prisma.setting.deleteMany({ where: { key: 卡点改版记号键 } });
    invalidateSettingsCache();
    const [认领数, 链数] = [await prisma.entBlockerClaim.count(), await prisma.entBlockerReasonLink.count()];
    expect(await 卡点改版()).toBe(0);
    expect([await prisma.entBlockerClaim.count(), await prisma.entBlockerReasonLink.count()]).toEqual([认领数, 链数]);
    // 改版后的卡点照新流程走
    expect(await 认领卡点(组长, 处理中)).toMatchObject({ ok: true });
  });

  it("不是企业版：发不了、一行不写，交接、改版什么都不做", async () => {
    const f = await 沟通();
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 发布卡点(销售, f, 卡)).toMatchObject({ ok: false, error: "卡点是企业版的功能" });
    expect(await 项目的卡点(销售, 项目)).toEqual([]);
    expect((await 卡点看板(老板)).开).toBe(false);
    expect(await 原因字典()).toEqual([]);
    expect(await prisma.$transaction((tx) => 交接卡点(tx, 销售.id, 组长.id, 老板.id, []))).toBe(0);
    expect(await 卡点改版()).toBe(0);
    expect(await prisma.entBlocker.count()).toBe(0);
    expect(await prisma.entBlockerReason.count()).toBe(0);
  });
});

describe("卡点规矩", () => {
  it("改版映射：看板 → 待接受；待接受 → 待接受、清指认；处理中 → 处理中、经手人第一位认领人；已解决 → 经手人已完成", () => {
    expect(改版后("看板", null)).toEqual({ status: "待接受", 认领: null });
    expect(改版后("看板", "u1")).toEqual({ status: "待接受", 认领: null });
    expect(改版后("待接受", "u1")).toEqual({ status: "待接受", 认领: null });
    expect(改版后("处理中", "u1")).toEqual({ status: "处理中", 认领: { userId: "u1", done: false } });
    expect(改版后("处理中", null)).toEqual({ status: "待接受", 认领: null });
    expect(改版后("已解决", "u1")).toEqual({ status: "已解决", 认领: { userId: "u1", done: true } });
    expect(改版后("已解决", null)).toEqual({ status: "已解决", 认领: null });
  });

  it("老阻碍主体不归类：规则里没有映射表；默认卡点角色开关里总管理、管理员可看全部；只读 / 能管的判定", () => {
    expect(Object.keys(卡点模块)).not.toContain("老主体to原因");
    expect(未分类原因名).toBe("未分类（老数据）");
    expect(默认卡点角色开关.范围.director).toBe("全部");
    expect(默认卡点角色开关.范围.admin).toBe("全部");
    expect(卡点只读([])).toBe(false);
    expect(能管卡点([])).toBe(false);
  });

  it("会签进度 x/y", () => {
    expect(会签进度([])).toEqual({ 完成: 0, 共: 0, 齐了: false });
    expect(会签进度([{ done: true }, { done: false }])).toEqual({ 完成: 1, 共: 2, 齐了: false });
    expect(会签进度([{ done: true }, { done: true }])).toEqual({ 完成: 2, 共: 2, 齐了: true });
  });

  it("规整发布：没填类型、影响按默认；暂无卡点 = null；没有时限这回事", () => {
    expect(规整发布({ description: "x" }, 默认卡点默认)).toMatchObject({ type: "中度卡点", impact: "短期不影响", title: "x", reasons: ["其他"] });
    expect(规整发布({ type: "暂无卡点", description: "" }, 默认卡点默认)).toBeNull();
    // 老调用方还传单个阻碍主体：不再换成原因（B9），没选原因照样落「其他」
    expect(规整发布({ description: "x", obstacle: "竞品" } as never, 默认卡点默认)).toMatchObject({ reasons: ["其他"] });
    expect(规整发布({ description: "x" }, 默认卡点默认)).not.toHaveProperty("dueDays");
    expect(规整发布({ description: "x", type: "乱写" }, 默认卡点默认)).toHaveProperty("error");
  });

  it("编号日按北京", () => {
    expect(编号日(new Date("2026-11-01T17:00:00Z"))).toBe("20261102");
    expect(编号日(new Date("2026-11-01T15:59:00Z"))).toBe("20261101");
  });

  it("沟通记录时限提醒（按下一步时间，和卡点无关）：没填 / 没到 → 稳；过了 3 天内 → 拿捏；再久 → 超时", () => {
    const t = new Date("2026-10-26T10:00:00Z");
    expect(时限提醒of(null, t).级别).toBe("稳");
    expect(时限提醒of(new Date(t.getTime() + 天), t).级别).toBe("稳");
    expect(时限提醒of(new Date(t.getTime() - 天), t).级别).toBe("拿捏");
    expect(时限提醒of(new Date(t.getTime() - 3 * 天 - 1), t).级别).toBe("超时");
  });
});
