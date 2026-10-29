/**
 * 企业版项目关联客户 / 联系人（2026-10-29 P17，迁移 094 / 095，src/lib/project/relate.ts），真库 + 企业字典：
 *   - 加关联客户：带身份存成 JSON 数组；重复加报已关联；主客户不让加（它总在第一行）
 *   - 改客户身份：主客户第一次勾时 upsert 一行；没变不写（变了=false）；新选的得启用着，已存的停用了照留
 *   - 解除：普通的删掉那行；主客户解不了
 *   - 联系人：角色多选 + 立场单选；立场不在字典里拦下；主联系人第一次改时 upsert
 *   - 上限 30（不含主的）
 *   - 谁能改同改项目：同事改不了，公海里的先领取；不是企业版不认
 *   - 读：项目关联们 主的排第一、其余按挂上的先后；客户参与的项目 带 主 标记、概览名称
 * 可见范围（同事看不到、占位名）见 ent-project-relate-scope.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 企业字典 } from "@/lib/enterprise/dict";
import { 团队版字典 } from "@/lib/project/stage-dict";
import { 读产品需求 as 读多选 } from "@/lib/project/profile-rules";
import {
  加关联客户, 改客户身份, 解除关联客户, 加关联联系人, 改联系人角色立场, 解除关联联系人, 项目关联们, 客户参与的项目, 关联上限,
} from "@/lib/project/relate";

type 人 = { id: string; role: string };

describe("项目关联客户 / 联系人（真库、企业字典）", () => {
  let 老板: 人;
  let 乙: 人;
  let 丙: 人;
  let 主客户id: string;
  let 总包id: string;
  let 监理id: string;
  let 项目id: string;
  let 主联系人id: string;
  let 张三id: string;

  const 人 = async (email: string, role: string): Promise<人> => ({ id: (await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } })).id, role });
  const 停用 = async (kind: Parameters<typeof 企业字典>[0], name: string) => {
    await 企业字典(kind);
    await prisma.entDictItem.update({ where: { kind_name: { kind, name } }, data: { active: false } });
  };
  const 客户行 = (customerId: string) => prisma.projectCustomer.findFirst({ where: { projectId: 项目id, customerId } });
  const 人行 = (contactId: string) => prisma.projectContact.findFirst({ where: { projectId: 项目id, contactId } });

  beforeEach(async () => {
    vi.stubEnv("CRM_ENTERPRISE", "1");
    await resetDb();
    老板 = await 人("p17-boss", "ADMIN");
    乙 = await 人("p17-yi", "SALES");
    丙 = await 人("p17-bing", "SALES");
    主客户id = (await prisma.customer.create({ data: { name: "QA-主客户有限公司", shortName: "QA主客户", phone: "13800001701", salesOwnerId: 乙.id } })).id;
    总包id = (await prisma.customer.create({ data: { name: "QA-总包有限公司", phone: "13800001702", salesOwnerId: 乙.id } })).id;
    监理id = (await prisma.customer.create({ data: { name: "QA-监理有限公司", shortName: "QA监理", phone: "13800001703", salesOwnerId: 乙.id } })).id;
    主联系人id = (await prisma.contact.create({ data: { name: "李四", gender: "女", customerId: 主客户id } })).id;
    张三id = (await prisma.contact.create({ data: { name: "张三", gender: "男", customerId: 总包id } })).id;
    项目id = (await prisma.project.create({ data: { name: "QA-关联项目", customerId: 主客户id, contactId: 主联系人id, ownerId: 乙.id, creatorId: 乙.id } })).id;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("加关联客户：带身份存 JSON 数组；重复加报已关联；主客户不让加；客户不在报不在", async () => {
    expect(await 加关联客户(乙, 项目id, 总包id, ["总包方", "垫资方"])).toEqual({ ok: true, 名: "QA-总包有限公司" });
    expect(读多选((await 客户行(总包id))?.roles)).toEqual(["总包方", "垫资方"]);
    expect(await 加关联客户(乙, 项目id, 监理id)).toEqual({ ok: true, 名: "QA监理" });
    expect((await 客户行(监理id))?.roles).toBeNull();
    expect(await 加关联客户(乙, 项目id, 总包id, ["分包方"])).toMatchObject({ ok: false, error: expect.stringContaining("已经关联过了") });
    expect(await 加关联客户(乙, 项目id, 主客户id, ["业主方"])).toMatchObject({ ok: false, error: expect.stringContaining("主客户") });
    expect(await 客户行(主客户id)).toBeNull();
    expect(await 加关联客户(乙, 项目id, "no-such")).toMatchObject({ ok: false, error: expect.stringContaining("不在了") });
    expect(await 加关联客户(乙, "no-such", 总包id)).toMatchObject({ ok: false, error: expect.stringContaining("项目已经不在了") });
    expect(await 加关联客户(乙, 项目id, 监理id, ["瞎编的"])).toMatchObject({ ok: false });
  });

  it("改客户身份：主客户第一次勾 upsert 一行；没变不写；别的没关联的报不在关联里", async () => {
    expect(await 改客户身份(乙, 项目id, 主客户id, ["业主方"])).toEqual({ ok: true, 名: "QA主客户", 变了: true });
    expect(读多选((await 客户行(主客户id))?.roles)).toEqual(["业主方"]);
    expect(await 改客户身份(乙, 项目id, 主客户id, ["业主方"])).toEqual({ ok: true, 名: "QA主客户", 变了: false });
    expect(await 改客户身份(乙, 项目id, 主客户id, ["业主方", "投资方"])).toMatchObject({ ok: true, 变了: true });
    expect(await 改客户身份(乙, 项目id, 主客户id, [])).toMatchObject({ ok: true, 变了: true });
    expect((await 客户行(主客户id))?.roles).toBeNull();
    expect(await 改客户身份(乙, 项目id, 监理id, ["监理方"])).toMatchObject({ ok: false, error: expect.stringContaining("不在关联里") });
    expect(await 客户行(监理id)).toBeNull();
  });

  it("同一家在不同项目里身份各记各的", async () => {
    const 项目2 = (await prisma.project.create({ data: { name: "QA-另一个项目", customerId: 监理id, ownerId: 乙.id, creatorId: 乙.id } })).id;
    await 加关联客户(乙, 项目id, 总包id, ["总包方"]);
    await 加关联客户(乙, 项目2, 总包id, ["业主方"]);
    expect(读多选((await 客户行(总包id))?.roles)).toEqual(["总包方"]);
    expect(读多选((await prisma.projectCustomer.findFirst({ where: { projectId: 项目2, customerId: 总包id } }))?.roles)).toEqual(["业主方"]);
  });

  it("身份停用了：已存的照留、改别的项不受影响；新勾停用的拦下", async () => {
    await 加关联客户(乙, 项目id, 总包id, ["总包方"]);
    await 停用("projCustRole", "总包方");
    expect(await 改客户身份(乙, 项目id, 总包id, ["总包方", "垫资方"])).toMatchObject({ ok: true, 变了: true });
    expect(读多选((await 客户行(总包id))?.roles)).toEqual(["总包方", "垫资方"]);
    expect(await 加关联客户(乙, 项目id, 监理id, ["总包方"])).toMatchObject({ ok: false, error: expect.stringContaining("「总包方」不在项目身份里") });
    expect(await 客户行(监理id)).toBeNull();
  });

  it("解除：普通的删掉那行；主客户解不了；再解报不在关联里", async () => {
    await 加关联客户(乙, 项目id, 总包id, ["总包方"]);
    await 改客户身份(乙, 项目id, 主客户id, ["业主方"]);
    expect(await 解除关联客户(乙, 项目id, 总包id)).toEqual({ ok: true, 名: "QA-总包有限公司" });
    expect(await 客户行(总包id)).toBeNull();
    expect(await 解除关联客户(乙, 项目id, 总包id)).toMatchObject({ ok: false, error: expect.stringContaining("不在关联里") });
    expect(await 解除关联客户(乙, 项目id, 主客户id)).toMatchObject({ ok: false, error: expect.stringContaining("主客户解除不了") });
    expect(await 客户行(主客户id)).not.toBeNull();
  });

  it("联系人：角色多选 + 立场单选；立场不在字典里拦下；主联系人第一次改 upsert；没变不写", async () => {
    expect(await 加关联联系人(乙, 项目id, 张三id, { roles: ["决策人", "审批人"], stance: "盟友" })).toEqual({ ok: true, 名: "QA-总包有限公司|张先生" });
    expect(await 人行(张三id)).toMatchObject({ stance: "盟友" });
    expect(读多选((await 人行(张三id))?.roles)).toEqual(["决策人", "审批人"]);
    expect(await 加关联联系人(乙, 项目id, 张三id)).toMatchObject({ ok: false, error: expect.stringContaining("已经关联过了") });
    expect(await 加关联联系人(乙, 项目id, 主联系人id)).toMatchObject({ ok: false, error: expect.stringContaining("主联系人") });

    expect(await 改联系人角色立场(乙, 项目id, 张三id, { stance: "瞎编的" })).toMatchObject({ ok: false });
    expect(await 改联系人角色立场(乙, 项目id, 张三id, { stance: "盟友" })).toMatchObject({ ok: true, 变了: false });
    // 只传立场不动角色
    expect(await 改联系人角色立场(乙, 项目id, 张三id, { stance: "线人" })).toMatchObject({ ok: true, 变了: true });
    expect(await 人行(张三id)).toMatchObject({ stance: "线人" });
    expect(读多选((await 人行(张三id))?.roles)).toEqual(["决策人", "审批人"]);
    expect(await 改联系人角色立场(乙, 项目id, 张三id, { stance: null })).toMatchObject({ ok: true, 变了: true });
    expect((await 人行(张三id))?.stance).toBeNull();

    expect(await 改联系人角色立场(乙, 项目id, 主联系人id, { roles: ["使用人"] })).toEqual({ ok: true, 名: "QA主客户|李女士", 变了: true });
    expect(读多选((await 人行(主联系人id))?.roles)).toEqual(["使用人"]);
    expect(await 解除关联联系人(乙, 项目id, 主联系人id)).toMatchObject({ ok: false, error: expect.stringContaining("主联系人解除不了") });
    expect(await 解除关联联系人(乙, 项目id, 张三id)).toMatchObject({ ok: true });
    expect(await 人行(张三id)).toBeNull();
  });

  it("立场停用了：已存的照留，新换成停用的拦下", async () => {
    await 加关联联系人(乙, 项目id, 张三id, { stance: "军师" });
    await 停用("projStance", "军师");
    expect(await 改联系人角色立场(乙, 项目id, 张三id, { stance: "军师", roles: ["经办人"] })).toMatchObject({ ok: true, 变了: true });
    expect(await 人行(张三id)).toMatchObject({ stance: "军师" });
    await 改联系人角色立场(乙, 项目id, 张三id, { stance: "中立" });
    expect(await 改联系人角色立场(乙, 项目id, 张三id, { stance: "军师" })).toMatchObject({ ok: false });
    expect((await 人行(张三id))?.stance).toBe("中立");
  });

  it(`上限 ${关联上限}（不含主的）：满了再加拦下`, async () => {
    const 一堆 = await Promise.all(Array.from({ length: 关联上限 }, (_, i) => prisma.customer.create({ data: { name: `QA-一堆${i}`, phone: `1390000${String(i).padStart(4, "0")}`, salesOwnerId: 乙.id } })));
    await prisma.projectCustomer.createMany({ data: 一堆.map((c) => ({ projectId: 项目id, customerId: c.id })) });
    // 主客户那行不占名额
    expect(await 改客户身份(乙, 项目id, 主客户id, ["业主方"])).toMatchObject({ ok: true });
    expect(await 加关联客户(乙, 项目id, 总包id)).toMatchObject({ ok: false, error: `一个项目最多关联 ${关联上限} 家客户` });
    expect(await 客户行(总包id)).toBeNull();
  });

  it("谁能改同改项目：同事改不了、老板能改；公海里的先领取；库里不动", async () => {
    expect(await 加关联客户(丙, 项目id, 总包id)).toMatchObject({ ok: false, error: expect.stringContaining("项目负责人") });
    expect(await 客户行(总包id)).toBeNull();
    expect(await 加关联客户(老板, 项目id, 总包id, ["总包方"])).toMatchObject({ ok: true });
    expect(await 改客户身份(丙, 项目id, 总包id, ["分包方"])).toMatchObject({ ok: false });
    expect(await 解除关联客户(丙, 项目id, 总包id)).toMatchObject({ ok: false });
    expect(await 加关联联系人(丙, 项目id, 张三id)).toMatchObject({ ok: false });
    await prisma.project.update({ where: { id: 项目id }, data: { pooledAt: new Date() } });
    expect(await 改客户身份(乙, 项目id, 总包id, ["分包方"])).toMatchObject({ ok: false, error: expect.stringContaining("公海") });
    expect(读多选((await 客户行(总包id))?.roles)).toEqual(["总包方"]);
  });

  it("不是企业版不认，读也回 null", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 加关联客户(乙, 项目id, 总包id)).toEqual({ ok: false, error: "此版本没有项目关联" });
    expect(await 加关联联系人(乙, 项目id, 张三id)).toEqual({ ok: false, error: "此版本没有项目关联" });
    expect(await 项目关联们(乙, 项目id)).toBeNull();
    expect(await 客户参与的项目(总包id, 团队版字典)).toBeNull();
    expect(await prisma.projectCustomer.count()).toBe(0);
  });

  it("项目关联们：主的排第一、其余按挂上的先后；带三个字典的选项", async () => {
    await 加关联客户(乙, 项目id, 监理id, ["监理方"]);
    await 加关联客户(乙, 项目id, 总包id, ["总包方"]);
    await 加关联联系人(乙, 项目id, 张三id, { roles: ["影响人"], stance: "对手" });
    const r = (await 项目关联们(乙, 项目id))!;
    expect(r.客户们.map((c) => [c.名, c.主, c.身份])).toEqual([["QA主客户", true, []], ["QA监理", false, ["监理方"]], ["QA-总包有限公司", false, ["总包方"]]]);
    expect(r.客户们.every((c) => c.看得到)).toBe(true);
    expect(r.联系人们.map((c) => [c.名, c.主, c.角色, c.立场])).toEqual([["QA主客户|李女士", true, [], null], ["QA-总包有限公司|张先生", false, ["影响人"], "对手"]]);
    expect(r.选项.身份).toContain("业主方");
    expect(r.选项.角色).toContain("决策人");
    expect(r.选项.立场).toEqual(["待定", "中立", "对手", "线人", "军师", "盟友"]);
    expect(r.上限).toBe(关联上限);
  });

  it("客户参与的项目：挂在哪些项目、是哪一方；主客户勾过身份的那行带 主", async () => {
    const 项目2 = (await prisma.project.create({ data: { name: "QA-总包自己的项目", customerId: 总包id, ownerId: 乙.id, creatorId: 乙.id, node: "明确需求", phase: "商机" } })).id;
    await 加关联客户(乙, 项目id, 总包id, ["总包方", "垫资方"]);
    await 改客户身份(乙, 项目2, 总包id, ["业主方"]);
    const 行 = (await 客户参与的项目(总包id, 团队版字典))!;
    expect(行).toHaveLength(2);
    const 按 = Object.fromEntries(行.map((x) => [x.projectId, x]));
    expect(按[项目id]).toMatchObject({ 身份: ["总包方", "垫资方"], 主: false });
    expect(按[项目id].名).toContain("QA-关联项目");
    expect(按[项目2]).toMatchObject({ 名: "明确需求|QA-总包自己的项目", 身份: ["业主方"], 主: true });
  });
});
