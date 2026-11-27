/**
 * 联系人主号（12-15 第三批 B，P-合并-05）：主号 = 电话格，「设为主号」把选中的手机号写进电话格，原主号照样留着（两条都不删）。
 * 真库、真组织架构（同 ent-contact-link-scope.test.ts）：
 *   - 纯函数：是默认号、默认号排前；联系人号码们 带 id、主号排最前标 默认
 *   - 负责人 A 设主号：电话格换了、号码几行一行不少；再设一次没变；邮箱行、别人的号码行不收；电话格的号不在几行里时补一行
 *   - 销售 B（看不到）、虚线上级（只读）、销售教练、只读管理员、只看某人（切换视图）、只负责项目的人：一律拦，库里原样
 *   - 电话格是座机 / 乱填的字时设主号：补出的那行种类、格式状态照实（座机记座机、乱填的记验号码的状态）；号码记满了不补、主号照换
 *   - 编辑联系人（存联系人号码 带原电话）：主号还在就不按「第一个手机」换掉
 *   - 合成后把并进来那位的号设成主号、再撤回：留下那位的电话格换回合成时的号，并的那位号码回到他身上
 * 号码、名字都是编的。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-default-number-"));
  fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db"), path.join(dir, "A.db"));
  if (fs.existsSync(path.resolve(__dirname, "../prisma/test.db-wal"))) fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db-wal"), path.join(dir, "A.db-wal"));
  return { dir };
});
const 登录 = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), getCurrentUser: async () => 登录.user, requireUser: async () => 登录.user }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@/generated/prisma");
  const { 加上限定 } = await import("@/lib/team-scope");
  const raw = new PrismaClient<import("@/generated/prisma").Prisma.PrismaClientOptions>({ datasourceUrl: `file:${path.join(临时.dir, "A.db")}?connection_limit=1` });
  return { prisma: 加上限定(raw), defaultClient: raw };
});

import { defaultClient as raw } from "@/lib/prisma";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 设为主号 } from "@/app/(app)/customers/[id]/contact-link-actions";
import { 联系人号码们, 存联系人号码 } from "@/lib/enterprise/customer-v2-db";
import { 是默认号, 默认号排前 } from "@/lib/enterprise/default-number";
import { 合成一对, 拆开一对 } from "@/lib/enterprise/contact-merge";
import { 只看某人键 } from "@/lib/enterprise/org-core";
import { invalidateSettingsCache } from "@/lib/settings";

const 销售A = "dn_a";
const 销售B = "dn_b";
const 虚线上级 = "dn_dot";
const 教练 = "dn_coach";
const 只读管理员 = "dn_admin";
const 只看某人的 = "dn_viewas";
const 项目负责人 = "dn_proj";

const 作为 = <T,>(id: string, f: () => Promise<T>) => {
  登录.user = { ...登录.user, id, name: id, email: `${id}@x.com` };
  return 以谁的身份(id, f);
};
const 号 = (customerId: string, contactId: string, kind: string, value: string) =>
  raw.contactMethod.create({ data: { customerId, contactId, kind, value, numberKey: value.toLowerCase(), formatStatus: "ok" } });
const 几行 = async (contactId: string) => (await raw.contactMethod.findMany({ where: { contactId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).map((m) => `${m.kind}:${m.value}`).sort();
const 电话格 = async (id: string) => (await raw.contact.findUniqueOrThrow({ where: { id } })).phone;

let 甲: string;
let 人: string;
let 行1: string; // 13800003001（原主号）
let 行2: string; // 13800003002
let 邮箱行: string;

beforeAll(async () => {
  process.env.CRM_ENTERPRISE = "1";
  delete process.env.DESKTOP_LOCAL;
  for (const t of ["EntCustomerMerge", "ContactCustomer", "ContactMethod", "Attachment", "ProjectNodeLog", "ProjectContact", "Project", "AiConversation", "AiProject", "Setting", "AuditLog", "ImportBatch", "Task", "FollowPlan", "FollowUpSource", "FollowUp", "ContractOwner", "Contract", "Opportunity", "Contact", "UnassignedContact", "Lead", "CustomerPool", "CustomerClaim", "EntMember", "EntDept"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  await raw.$executeRawUnsafe('UPDATE "Customer" SET referrerCustomerId = NULL, attributionCustomerId = NULL');
  for (const t of ["Customer", "Channel", "User"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  for (const id of [销售A, 销售B, 虚线上级, 教练, 只读管理员, 只看某人的, 项目负责人]) await raw.user.create({ data: { id, email: `${id}@x.com`, name: id, password: "x", role: "SALES" } });
  await raw.entMember.createMany({ data: [{ userId: 虚线上级, bizRole: "sales_mgr" }, { userId: 销售A, dottedManagerId: 虚线上级 }, { userId: 销售B }, { userId: 教练, bizRole: "coach" }, { userId: 只读管理员, bizRole: "admin" }, { userId: 只看某人的, bizRole: "sales_mgr" }, { userId: 项目负责人 }] });
  甲 = (await raw.customer.create({ data: { name: "QA-主号客户甲", phone: "", salesOwnerId: 销售A } })).id;
  人 = (await raw.contact.create({ data: { customerId: 甲, name: "QA-主号联系人", phone: "13800003001", isPrimary: true } })).id;
  await raw.contactCustomer.create({ data: { contactId: 人, customerId: 甲 } });
  行1 = (await 号(甲, 人, "phone", "13800003001")).id;
  行2 = (await 号(甲, 人, "phone", "13800003002")).id;
  邮箱行 = (await 号(甲, 人, "email", "qa-dn@example.com")).id;
  // 只负责这位客户名下一个项目、不负责客户的人
  await raw.project.create({ data: { customerId: 甲, name: "QA-主号项目", phase: "线索", ownerId: 项目负责人, creatorId: 销售A } });
  // 切换视图：只看某人的那位设成只看销售 A
  await raw.setting.upsert({ where: { key: 只看某人键 }, update: { value: JSON.stringify({ [只看某人的]: 销售A }) }, create: { key: 只看某人键, value: JSON.stringify({ [只看某人的]: 销售A }) } });
  invalidateSettingsCache();
  await raw.setting.upsert({ where: { key: 规则.按组织看客户.key }, update: { value: "true" }, create: { key: 规则.按组织看客户.key, value: "true" } });
  忘掉企业版范围();
});

beforeEach(() => {
  process.env.CRM_ENTERPRISE = "1";
  忘掉企业版范围();
});

afterAll(async () => {
  delete process.env.CRM_ENTERPRISE;
  忘掉企业版范围();
  await raw.$disconnect();
  fs.rmSync(临时.dir, { recursive: true, force: true });
});

describe("主号纯函数", () => {
  it("是默认号：只认手机一类、规整后同号", () => {
    expect(是默认号("138 0000 3001", { kind: "phone", value: "13800003001" })).toBe(true);
    expect(是默认号("13800003001", { kind: "landline", value: "13800003001" })).toBe(false);
    expect(是默认号(null, { kind: "phone", value: "13800003001" })).toBe(false);
    expect(是默认号("13800003001", { kind: "phone", value: "13800003002" })).toBe(false);
  });
  it("默认号排前：主号那一行挪到最前，其余照原来先后；没有主号原样", () => {
    const 们 = [{ kind: "email", value: "a@b.c" }, { kind: "phone", value: "13800003001" }, { kind: "phone", value: "13800003002" }];
    expect(默认号排前("13800003002", 们).map((x) => x.value)).toEqual(["13800003002", "a@b.c", "13800003001"]);
    expect(默认号排前(null, 们)).toEqual(们);
  });
  it("联系人号码们：子表的几行带 id，主号排最前标 默认；老三格拼的照旧不带", () => {
    const r = 联系人号码们({ phone: "13800003002", email: null, wechat: null }, [{ id: "m1", kind: "phone", value: "13800003001" }, { id: "m2", kind: "phone", value: "13800003002" }]);
    expect(r).toEqual([{ id: "m2", kind: "phone", value: "13800003002", 默认: true }, { id: "m1", kind: "phone", value: "13800003001" }]);
    expect(联系人号码们({ phone: "13800003001", email: null, wechat: null }, [])).toEqual([{ kind: "phone", value: "13800003001" }]);
  });
});

describe("设为主号（真库、真组织架构）", () => {
  it("看不到的销售 B、只读的虚线上级、销售教练：都拦，库里原样", async () => {
    const 前 = await 几行(人);
    await 作为(销售B, async () => expect(await 设为主号(人, 行2)).toMatchObject({ ok: false, error: expect.stringMatching(/不在了（或你看不到）/) }));
    await 作为(虚线上级, async () => expect(await 设为主号(人, 行2)).toMatchObject({ ok: false }));
    await 作为(教练, async () => expect(await 设为主号(人, 行2)).toMatchObject({ ok: false, error: expect.stringMatching(/只能看/) }));
    expect(await 电话格(人)).toBe("13800003001");
    expect(await 几行(人)).toEqual(前);
  });

  it("只读管理员、切换视图（只看销售 A）、只负责项目不负责客户的人：都拦，库里原样", async () => {
    const 前 = await 几行(人);
    const 日志前 = await raw.auditLog.count();
    for (const [id, 话] of [[只读管理员, /管理员只能看/], [只看某人的, /只看某人/], [项目负责人, /不在了（或你看不到）/]] as const) {
      忘掉企业版范围();
      await 作为(id, async () => expect(await 设为主号(人, 行2)).toMatchObject({ ok: false, error: expect.stringMatching(话) }));
    }
    expect(await 电话格(人)).toBe("13800003001");
    expect(await 几行(人)).toEqual(前);
    expect(await raw.auditLog.count()).toBe(日志前);
  });

  it("负责人设主号：电话格换成选中的号，号码几行一行不少；再设一次没变；邮箱行、乱给的 id 不收", async () => {
    const 前 = await 几行(人);
    await 作为(销售A, async () => {
      expect(await 设为主号(人, 行2)).toEqual({ ok: true });
      expect(await 设为主号(人, 行2)).toEqual({ ok: true });
      expect(await 设为主号(人, 邮箱行)).toEqual({ ok: false, error: "只有手机号能设为主号" });
      expect(await 设为主号(人, "不存在的行")).toMatchObject({ ok: false });
    });
    expect(await 电话格(人)).toBe("13800003002");
    expect(await 几行(人)).toEqual(前);
    // 设了一次就记一笔（没变的那次不记）
    expect(await raw.auditLog.count({ where: { entity: "Contact", entityId: 人, summary: { contains: "主号换成" } } })).toBe(1);
    // 页面拿到的几行：新主号排最前
    const 子表 = await raw.contactMethod.findMany({ where: { contactId: 人 }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, kind: true, value: true } });
    expect(联系人号码们({ phone: await 电话格(人), email: null, wechat: null }, 子表)[0]).toMatchObject({ id: 行2, 默认: true });
    await 作为(销售A, async () => expect(await 设为主号(人, 行1)).toEqual({ ok: true }));
    expect(await 电话格(人)).toBe("13800003001");
  });

  it("电话格的号不在号码几行里（老数据）：设主号时补一行，两条都不删", async () => {
    const 老 = (await raw.contact.create({ data: { customerId: 甲, name: "QA-老数据联系人", phone: "13800003009" } })).id;
    const 新行 = (await 号(甲, 老, "phone", "13800003008")).id;
    await raw.contactMethod.create({ data: { customerId: 甲, contactId: 老, kind: "phone", value: "13800003007", numberKey: "13800003007", formatStatus: "ok" } });
    await 作为(销售A, async () => expect(await 设为主号(老, 新行)).toEqual({ ok: true }));
    expect(await 电话格(老)).toBe("13800003008");
    expect(await 几行(老)).toEqual(["phone:13800003007", "phone:13800003008", "phone:13800003009"]);
  });

  it("电话格是座机（老数据）：补出的那行记成座机、格式 ok、查重键照座机算；再设回去也不重复补", async () => {
    const 座 = (await raw.contact.create({ data: { customerId: 甲, name: "QA-座机联系人", phone: "010-62345678" } })).id;
    const 手机行 = (await 号(甲, 座, "phone", "13800006001")).id;
    await 作为(销售A, async () => expect(await 设为主号(座, 手机行)).toEqual({ ok: true }));
    expect(await 电话格(座)).toBe("13800006001");
    const 补 = await raw.contactMethod.findFirstOrThrow({ where: { contactId: 座, value: "010-62345678" } });
    expect(补).toMatchObject({ kind: "landline", formatStatus: "ok", numberKey: "01062345678", region: null });
    expect(await 几行(座)).toEqual(["landline:010-62345678", "phone:13800006001"]);
  });

  it("电话格是乱填的字：补出的那行照实记验号码的状态，不写成 ok", async () => {
    const 乱 = (await raw.contact.create({ data: { customerId: 甲, name: "QA-乱填联系人", phone: "问前台" } })).id;
    const 手机行 = (await 号(甲, 乱, "phone", "13800006002")).id;
    await 作为(销售A, async () => expect(await 设为主号(乱, 手机行)).toEqual({ ok: true }));
    expect(await 电话格(乱)).toBe("13800006002");
    const 补 = await raw.contactMethod.findFirstOrThrow({ where: { contactId: 乱, value: "问前台" } });
    expect(补.formatStatus).not.toBe("ok");
    expect(["格式错误", "无法识别"]).toContain(补.formatStatus);
    // 打了码的号：无法识别
    const 码 = (await raw.contact.create({ data: { customerId: 甲, name: "QA-打码联系人", phone: "138****6003" } })).id;
    const 码手机行 = (await 号(甲, 码, "phone", "13800006004")).id;
    await 作为(销售A, async () => expect(await 设为主号(码, 码手机行)).toEqual({ ok: true }));
    expect(await raw.contactMethod.findFirstOrThrow({ where: { contactId: 码, value: "138****6003" } })).toMatchObject({ formatStatus: "无法识别" });
  });

  it("电话格是带 +86 的手机：补出的那行是规整后的手机号、ok、有查重键", async () => {
    const 带 = (await raw.contact.create({ data: { customerId: 甲, name: "QA-带区号联系人", phone: "+86 138 0000 6005" } })).id;
    const 手机行 = (await 号(甲, 带, "phone", "13800006006")).id;
    await 作为(销售A, async () => expect(await 设为主号(带, 手机行)).toEqual({ ok: true }));
    expect(await raw.contactMethod.findFirstOrThrow({ where: { contactId: 带, value: "13800006005" } })).toMatchObject({ kind: "phone", formatStatus: "ok", numberKey: "13800006005" });
  });

  it("号码已记满 20 个：原号不补，主号照换，日志里留着原主号", async () => {
    const 满 = (await raw.contact.create({ data: { customerId: 甲, name: "QA-满号联系人", phone: "13800007000" } })).id;
    let 第一行 = "";
    for (let i = 1; i <= 20; i++) {
      const m = await 号(甲, 满, "phone", `138000070${String(i).padStart(2, "0")}`);
      if (i === 1) 第一行 = m.id;
    }
    await 作为(销售A, async () => expect(await 设为主号(满, 第一行)).toEqual({ ok: true }));
    expect(await 电话格(满)).toBe("13800007001");
    expect(await raw.contactMethod.count({ where: { contactId: 满 } })).toBe(20);
    expect(await raw.contactMethod.count({ where: { contactId: 满, value: "13800007000" } })).toBe(0);
    const 记 = await raw.auditLog.findFirstOrThrow({ where: { entity: "Contact", entityId: 满 } });
    expect(JSON.parse(String(记.detail))).toMatchObject({ 原主号: "13800007000", 新主号: "13800007001", 说明: expect.stringContaining("记满") });
  });

  it("编辑联系人：交回来的几行里主号还在就照旧是它，不按第一个手机换", async () => {
    const 三 = await raw.$transaction((tx) => 存联系人号码(tx, 甲, 人, [
      { kind: "phone", value: "13800003002", numberKey: "13800003002", region: null },
      { kind: "phone", value: "13800003001", numberKey: "13800003001", region: null },
    ], "13800003001"));
    expect(三.phone).toBe("13800003001");
    const 换了号 = await raw.$transaction((tx) => 存联系人号码(tx, 甲, 人, [
      { kind: "phone", value: "13800003002", numberKey: "13800003002", region: null },
      { kind: "phone", value: "13800003005", numberKey: "13800003005", region: null },
    ], "13800003001"));
    expect(换了号.phone).toBe("13800003002");
  });

  it("合成后把并进来那位的号设成主号、再撤回：留下那位换回合成时的电话，并的那位号码回去", async () => {
    const 留 = await raw.contact.create({ data: { customerId: 甲, name: "QA-留", phone: "13800004001" } });
    const 并 = await raw.contact.create({ data: { customerId: 甲, name: "QA-并", phone: "13800004002" } });
    await 号(甲, 留.id, "phone", "13800004001");
    const 并行 = (await 号(甲, 并.id, "phone", "13800004002")).id;
    const 明 = await raw.$transaction((tx) => 合成一对(tx, 留, 并, new Date()));
    expect(明.留原电话).toBe("13800004001");
    await 作为(销售A, async () => expect(await 设为主号(留.id, 并行)).toEqual({ ok: true }));
    expect(await 电话格(留.id)).toBe("13800004002");
    const 没还原 = await raw.$transaction((tx) => 拆开一对(tx, JSON.stringify(明), 留.id, 并.id));
    expect(没还原).toEqual([]);
    expect(await 电话格(留.id)).toBe("13800004001");
    expect(await 电话格(并.id)).toBe("13800004002");
    expect(await 几行(并.id)).toEqual(["phone:13800004002"]);
  });

  it("留下那位原来没电话（合成补的）、设了并进来的另一个号再撤回：电话格回到空，不记没还原", async () => {
    const 留 = await raw.contact.create({ data: { customerId: 甲, name: "QA-留2" } });
    const 并 = await raw.contact.create({ data: { customerId: 甲, name: "QA-并2", phone: "13800005001" } });
    await 号(甲, 并.id, "phone", "13800005001");
    const 并行2 = (await 号(甲, 并.id, "phone", "13800005002")).id;
    const 明 = await raw.$transaction((tx) => 合成一对(tx, 留, 并, new Date()));
    expect(await 电话格(留.id)).toBe("13800005001");
    await 作为(销售A, async () => expect(await 设为主号(留.id, 并行2)).toEqual({ ok: true }));
    const 没还原 = await raw.$transaction((tx) => 拆开一对(tx, JSON.stringify(明), 留.id, 并.id));
    expect(没还原).toEqual([]);
    expect(await 电话格(留.id)).toBeNull();
    expect(await 电话格(并.id)).toBe("13800005001");
  });
});
