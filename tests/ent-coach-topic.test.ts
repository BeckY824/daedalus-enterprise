/**
 * 企业版教练主题（11-17，销售教练角色 PR2）：判定（lib/enterprise/coach-topic.ts）+ 读写（coach-topic-db.ts）+ 动作。
 * 钉的是：
 *   - 谁能发：教练全部（第一版设了线也看全部）、系统管理员全部、条线总管理本线、实线上级整条下属链、虚线上级其虚线下属的项目；
 *     上级按关系认（市场管理是负责人的上级也能发）；负责人本人、同级、组员、没上下级关系的市场管理、只读管理员、没角色的不能；账号 ADMIN 不放行
 *   - 公海里的项目谁都不能发；项目进公海时没关的自动关、留痕；进回收站后冻结（不能回、不能关）
 *   - 填写人锁定当前登录人（动作传 authorId 不认）
 *   - 状态：待回复 → 负责人回 → 已回复 → 发起人追问 → 待回复 → 关闭；第三方回复不改状态；
 *     发起人、系统管理员能关，发起人停用后负责人也能关，发起人自己成了负责人也能关；教练只回自己发的
 *   - 发出后不能改删，只有系统管理员软删（只打记号，第一版不进回收站）
 *   - 读：看不到项目的人拿编号直接取，取不到（两张表不在限定层里）
 *   - 只读角色拿到表级白名单也写不进去（不经过判定的直接写一律拒）
 *   - 不是沟通记录：发、回、关之后沟通、三态钟、冷标、下一步、最近跟进、待办、计划全部不变
 *   - 通知：发起 → 负责人；负责人回 → 发起人；追问 → 负责人；第三方回 → 发起人和负责人；关闭 → 负责人；自己不通知自己；
 *     键带回复编号（第二次追问不被吞）；不带手机号、不带主题内容（飞书只推标题）
 *   - 转让后待回复跟到新负责人名下（首页待办）
 * 用拷出来的一份库、显式单连接，不碰共用的测试库。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-ent-coach-topic-"));
  fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db"), path.join(dir, "A.db"));
  if (fs.existsSync(path.resolve(__dirname, "../prisma/test.db-wal"))) fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db-wal"), path.join(dir, "A.db-wal"));
  return { dir };
});
const 登录 = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => 登录.user, getCurrentUser: async () => 登录.user }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@/generated/prisma");
  const { 加上限定 } = await import("@/lib/team-scope");
  const raw = new PrismaClient({ datasourceUrl: `file:${path.join(临时.dir, "A.db")}?connection_limit=1` });
  return { prisma: 加上限定(raw), defaultClient: raw };
});
// 飞书推送不出网
vi.mock("@/lib/enterprise/feishu-push", () => ({ 推通知们: async () => {} }));

import { prisma as db, defaultClient as raw } from "@/lib/prisma";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 读组织 } from "@/lib/enterprise/org";
import { 主题写 } from "@/lib/team-scope";
import { 发起身份of, 能发主题, 能看主题, 能回主题, 能关主题, 能删主题, 冻结了, 回复后状态, 发起通知谁, 回复通知谁, 关闭通知谁 } from "@/lib/enterprise/coach-topic";
import { 读项目主题, 读一条主题, 待回复主题of, 复盘主题of } from "@/lib/enterprise/coach-topic-db";
import { 放回公海 } from "@/lib/project/db";
import { 进公海关主题动作 } from "@/lib/project/pool-owner";
import { 发主题动作, 回复主题动作, 关闭主题动作, 删主题动作 } from "@/app/(app)/customers/[id]/coach-topic-actions";
import { 教练只读话 } from "@/lib/enterprise/permissions";
import { invalidateSettingsCache } from "@/lib/settings";

const 人 = {
  老板: "ct_boss", // director：系统管理员
  线总: "ct_line", // director + 外贸：条线总管理
  内线总: "ct_nline", // director + 内贸：别线的条线总管理
  大组长: "ct_big", // sales_mgr，组长的上级（隔一级）
  组长: "ct_mgr", // sales_mgr，销售甲的直属上级
  虚管: "ct_dot", // sales_mgr，销售甲的虚线上级
  甲: "ct_a", // sales，外贸，项目负责人
  乙: "ct_b", // sales，内贸，同级
  市场: "ct_mkt", // marketing_mgr，乙的直属上级（11-17 评估：按关系认，对乙的项目能发）
  市场2: "ct_mkt2", // marketing_mgr，跟谁都没有上下级关系：不能发
  管理员: "ct_adm", // admin：只读，看得到主题、不发
  教练: "ct_coach", // coach，账号 ADMIN
  内教练: "ct_ncoach", // coach + 内贸：第一版不按线，照样看全部、能发
  组员: "ct_ops", // project_ops，进了甲的项目组
  没角色: "ct_none", // 账号 ADMIN，没业务角色
} as const;
type 谁 = keyof typeof 人;
const 我 = (r: 谁) => ({ id: 人[r], role: r === "教练" || r === "没角色" ? "ADMIN" : "SALES" });
const 叫 = (r: 谁) => ({ ...登录.user, id: 人[r], name: r, role: 我(r).role });
const 当 = (r: 谁) => { 登录.user = 叫(r); };

let 客户: string;
let 项目: string;
let 乙项目: string;
let 公海项目: string;

async function 建() {
  for (const t of ["EntCoachReply", "EntCoachTopic", "EntNotice", "AuditLog", "EntCustomerClock", "EntProjectCold", "ProjectNodeLog", "ProjectMember", "FollowUpProject", "Project", "Setting", "Task", "FollowPlan", "FollowUpSource", "FollowUp", "Contact", "Lead", "CustomerPool", "CustomerClaim", "CustomerCreator", "EntMember", "EntDept"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`).catch(() => {});
  await raw.$executeRawUnsafe('UPDATE "Customer" SET referrerCustomerId = NULL, attributionCustomerId = NULL');
  await raw.$executeRawUnsafe('DELETE FROM "Customer"');
  await raw.$executeRawUnsafe('DELETE FROM "Channel"');
  await raw.$executeRawUnsafe('DELETE FROM "User"');
  for (const [名, id] of Object.entries(人)) await raw.user.create({ data: { id, email: `${id}@x.com`, name: 名, password: "x", role: 我(名 as 谁).role, active: true } });
  await raw.entMember.createMany({
    data: [
      { userId: 人.老板, bizRole: "director" },
      { userId: 人.线总, bizRole: "director", line: "外贸" },
      { userId: 人.内线总, bizRole: "director", line: "内贸" },
      { userId: 人.大组长, bizRole: "sales_mgr" },
      { userId: 人.组长, bizRole: "sales_mgr", managerId: 人.大组长 },
      { userId: 人.虚管, bizRole: "sales_mgr" },
      { userId: 人.甲, bizRole: "sales", line: "外贸", managerId: 人.组长, dottedManagerId: 人.虚管 },
      { userId: 人.乙, bizRole: "sales", line: "内贸", managerId: 人.市场 },
      { userId: 人.市场, bizRole: "marketing_mgr" },
      { userId: 人.市场2, bizRole: "marketing_mgr" },
      { userId: 人.管理员, bizRole: "admin" },
      { userId: 人.教练, bizRole: "coach" },
      { userId: 人.内教练, bizRole: "coach", line: "内贸" },
      { userId: 人.组员, bizRole: "project_ops" },
    ],
  });
  const 时 = new Date("2026-11-01T08:00:00Z");
  客户 = (await raw.customer.create({ data: { name: "甲的客户", phone: "13800001111", salesOwnerId: 人.甲, bizLine: "外贸", lastFollowAt: 时 } })).id;
  项目 = (await raw.project.create({ data: { name: "甲的项目", customerId: 客户, ownerId: 人.甲, creatorId: 人.甲, bizLine: "外贸", phase: "线索", node: "线索验证", nextStepAt: 时, nextStepText: "周三再打" } })).id;
  await raw.projectMember.create({ data: { projectId: 项目, userId: 人.组员, inviteStatus: "JOINED" } });
  const 乙客户 = (await raw.customer.create({ data: { name: "乙的客户", phone: "13800002222", salesOwnerId: 人.乙, bizLine: "内贸" } })).id;
  乙项目 = (await raw.project.create({ data: { name: "乙的项目", customerId: 乙客户, ownerId: 人.乙, creatorId: 人.乙, bizLine: "内贸", phase: "线索", node: "线索验证" } })).id;
  公海项目 = (await raw.project.create({ data: { name: "公海项目", customerId: 乙客户, ownerId: 人.乙, creatorId: 人.乙, bizLine: "内贸", phase: "线索", node: "线索验证", pooledAt: new Date() } })).id;
  await raw.setting.upsert({ where: { key: 规则.按组织看客户.key }, update: { value: "true" }, create: { key: 规则.按组织看客户.key, value: "true" } });
  invalidateSettingsCache();
  忘掉企业版范围();
}

beforeAll(async () => {
  process.env.CRM_ENTERPRISE = "1";
  delete process.env.DESKTOP_LOCAL;
}, 60_000);
beforeEach(async () => { await 建(); });
afterAll(async () => {
  delete process.env.CRM_ENTERPRISE;
  忘掉企业版范围();
  await raw.$disconnect();
  fs.rmSync(临时.dir, { recursive: true, force: true });
});

const 项目行 = (id: string) => raw.project.findUniqueOrThrow({ where: { id }, include: { members: true } }).then((p) => ({ ...p, 已加入: p.members.filter((m) => m.inviteStatus === "JOINED").map((m) => m.userId) }));
const 发 = async (r: 谁, projectId = 项目, x: Record<string, unknown> = {}) => { 当(r); return 发主题动作(projectId, { title: `${r}的主题`, body: "建议先问清预算", ...x }); };
const 一条 = () => raw.entCoachTopic.findFirstOrThrow({ orderBy: { createdAt: "desc" } });

describe("谁能发（纯判定，每类人）", () => {
  const 表: [谁, string | null][] = [
    ["教练", "销售教练"], ["老板", "系统管理员"], ["线总", "条线总管理"], ["组长", "实线上级"], ["大组长", "实线上级"], ["虚管", "虚线上级"],
    ["内教练", "销售教练"], ["甲", null], ["乙", null], ["市场", null], ["市场2", null], ["管理员", null], ["组员", null], ["没角色", null], ["内线总", null],
  ];
  for (const [r, 应] of 表) {
    it(`${r} 对甲的项目 → ${应 ?? "不能发"}`, async () => {
      const org = await 读组织();
      const p = await 项目行(项目);
      expect(发起身份of(我(r), p, org)).toBe(应);
      expect(能发主题(我(r), p, org)).toBe(应 !== null);
    });
  }

  it("Q4 按关系认：市场管理是乙的直属上级 → 对乙的项目能发（实线上级）；没关系的市场管理不能；教练、内贸教练、内线总能", async () => {
    const org = await 读组织();
    const p = await 项目行(乙项目);
    expect(发起身份of(我("市场"), p, org)).toBe("实线上级");
    expect(能发主题(我("市场2"), p, org)).toBe(false);
    expect(能发主题(我("教练"), p, org)).toBe(true);
    expect(能发主题(我("内教练"), p, org)).toBe(true);
    expect(能发主题(我("内线总"), p, org)).toBe(true);
  });

  it("公海里的项目谁都不能发（教练、系统管理员也不行）", async () => {
    const org = await 读组织();
    const p = await 项目行(公海项目);
    expect(冻结了(p)).toBe(true);
    for (const r of ["教练", "老板", "市场", "乙"] as 谁[]) expect(能发主题(我(r), p, org)).toBe(false);
  });

  it("已结束的项目也能发（复盘用）；进了回收站的不能", async () => {
    const org = await 读组织();
    const p = await 项目行(项目);
    expect(能发主题(我("教练"), { ...p, result: "赢单" }, org)).toBe(true);
    expect(能发主题(我("教练"), { ...p, deletedAt: new Date() }, org)).toBe(false);
  });
});

describe("谁看得到、回得了、关得了（纯判定）", () => {
  const 主题 = { authorId: 人.教练, status: "待回复" };
  it("看：发起人、负责人、能发的人、只读管理员；组员、市场、同级、没角色看不到；删了的谁都看不到", async () => {
    const org = await 读组织();
    const p = await 项目行(项目);
    for (const r of ["教练", "内教练", "甲", "老板", "线总", "组长", "大组长", "虚管", "管理员"] as 谁[]) expect([r, 能看主题(我(r), 主题, p, org)]).toEqual([r, true]);
    for (const r of ["组员", "市场", "市场2", "乙", "没角色"] as 谁[]) expect([r, 能看主题(我(r), 主题, p, org)]).toEqual([r, false]);
    expect(能看主题(我("老板"), { ...主题, deletedAt: new Date() }, p, org)).toBe(false);
  });

  it("回：负责人、发起人、能发的人；教练只回自己发的；管理员、组员不能；关了、冻结了谁都不能", async () => {
    const org = await 读组织();
    const p = await 项目行(项目);
    const 组长发的 = { authorId: 人.组长, status: "待回复" };
    expect(能回主题(我("甲"), 组长发的, p, org)).toBe(true);
    expect(能回主题(我("组长"), 组长发的, p, org)).toBe(true);
    expect(能回主题(我("虚管"), 组长发的, p, org)).toBe(true);
    expect(能回主题(我("老板"), 组长发的, p, org)).toBe(true);
    expect(能回主题(我("教练"), 组长发的, p, org)).toBe(false);
    expect(能回主题(我("教练"), 主题, p, org)).toBe(true);
    expect(能回主题(我("管理员"), 主题, p, org)).toBe(false);
    expect(能回主题(我("组员"), 主题, p, org)).toBe(false);
    expect(能回主题(我("甲"), { ...主题, status: "已关闭" }, p, org)).toBe(false);
    expect(能回主题(我("甲"), 主题, { ...p, pooledAt: new Date() }, org)).toBe(false);
  });

  it("关：发起人、系统管理员；负责人、别的上级、管理员不能；删：只有系统管理员", async () => {
    const org = await 读组织();
    const p = await 项目行(项目);
    expect(能关主题(我("教练"), 主题, p, org)).toBe(true);
    // 发起人自己接手成了负责人：能直接关
    expect(能关主题(我("组长"), { authorId: 人.组长, status: "待回复" }, { ...p, ownerId: 人.组长 }, org)).toBe(true);
    expect(能关主题(我("老板"), 主题, p, org)).toBe(true);
    for (const r of ["甲", "组长", "虚管", "管理员", "线总"] as 谁[]) expect([r, 能关主题(我(r), 主题, p, org)]).toEqual([r, false]);
    expect(能关主题(我("教练"), 主题, { ...p, deletedAt: new Date() }, org)).toBe(false);
    expect(能删主题(我("老板"), org)).toBe(true);
    for (const r of ["教练", "线总", "组长", "甲", "管理员"] as 谁[]) expect(能删主题(我(r), org)).toBe(false);
  });

  it("状态和通知的口径：负责人回 → 已回复；发起人追问 → 待回复；第三方回不改状态、通知发起人和负责人", () => {
    const p = { ownerId: 人.甲 };
    const 待 = { authorId: 人.教练, status: "待回复" };
    const 已 = { authorId: 人.教练, status: "已回复" };
    expect(回复后状态(人.甲, 待, p)).toBe("已回复");
    expect(回复后状态(人.教练, 已, p)).toBe("待回复");
    expect(回复后状态(人.组长, 待, p)).toBe("待回复");
    expect(回复后状态(人.组长, 已, p)).toBe("已回复");
    expect(发起通知谁(人.教练, p)).toEqual([人.甲]);
    expect(回复通知谁(人.甲, { authorId: 人.教练 }, p)).toEqual([人.教练]);
    expect(回复通知谁(人.教练, { authorId: 人.教练 }, p)).toEqual([人.甲]);
    expect(回复通知谁(人.老板, { authorId: 人.教练 }, p)).toEqual([人.甲, 人.教练]);
    expect(关闭通知谁(人.教练, p)).toEqual([人.甲]);
    expect(关闭通知谁(人.甲, p)).toEqual([]);
  });
});

describe("动作：发、回、关（服务端整条走一遍）", () => {
  it("教练发起 → 负责人回 → 已回复 → 教练追问 → 待回复 → 教练关闭；通知收件人对、不带号码", async () => {
    expect(await 发("教练")).toEqual({ ok: true });
    const t = await 一条();
    expect(t).toMatchObject({ authorId: 人.教练, projectId: 项目, node: "线索验证", status: "待回复", title: "教练的主题" });
    const 收 = async () => (await raw.entNotice.findMany({ orderBy: { createdAt: "asc" } })).map((n) => [n.userId, n.kind]);
    expect(await 收()).toEqual([[人.甲, "主题"]]);
    // 教练点评改版 PR1（11-21）：发起那条通知（铃铛、飞书同一句）说「发起了点评」，不再说「发起了主题」
    const 发起那条 = (await raw.entNotice.findFirstOrThrow()).title;
    expect(发起那条).toContain("发起了点评「教练的主题」");
    expect(发起那条).not.toContain("发起了主题");

    当("甲");
    expect(await 回复主题动作(t.id, "周三再电话确认预算")).toEqual({ ok: true });
    expect((await raw.entCoachTopic.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("已回复");
    当("教练");
    expect(await 回复主题动作(t.id, "预算范围问到了吗")).toEqual({ ok: true });
    expect((await raw.entCoachTopic.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("待回复");
    // 负责人关不了
    当("甲");
    expect((await 关闭主题动作(t.id)).ok).toBe(false);
    当("教练");
    expect(await 关闭主题动作(t.id)).toEqual({ ok: true });
    const 关后 = await raw.entCoachTopic.findUniqueOrThrow({ where: { id: t.id } });
    expect(关后).toMatchObject({ status: "已关闭", closedById: 人.教练 });
    expect(关后.closedAt).not.toBeNull();
    // 关了不能再回
    当("甲");
    expect(await 回复主题动作(t.id, "补一句")).toEqual({ ok: false, error: "这个主题已经关闭了" });
    expect(await raw.entCoachReply.count({ where: { topicId: t.id } })).toBe(2);

    expect(await 收()).toEqual([[人.甲, "主题"], [人.教练, "主题"], [人.甲, "主题"], [人.甲, "主题"]]);
    // 不带号码、不带主题内容和回复内容（飞书推标题 + 正文，正文只有一句「去哪看」）
    for (const n of await raw.entNotice.findMany()) expect(`${n.title}${n.body}`).not.toMatch(/1380000|建议先问清预算|周三再电话|预算范围问到/);
    // 留痕
    expect(await raw.auditLog.count({ where: { entity: "EntCoachTopic" } })).toBe(4);
  });

  it("填写人锁定当前登录人：传 authorId / userId 不认", async () => {
    expect(await 发("组长", 项目, { authorId: 人.老板, userId: 人.老板 })).toEqual({ ok: true });
    expect((await 一条()).authorId).toBe(人.组长);
  });

  it("不能发的人服务端挡住、库里没有：负责人本人、同级、没关系的市场管理、管理员、组员、没角色；公海项目", async () => {
    for (const r of ["甲", "乙", "市场", "市场2", "管理员", "组员", "没角色"] as 谁[]) {
      const x = await 发(r);
      expect([r, x.ok]).toEqual([r, false]);
    }
    const 公海 = await 发("教练", 公海项目);
    expect(公海).toEqual({ ok: false, error: "公海里的项目没有负责人，不能发主题" });
    expect(await raw.entCoachTopic.count()).toBe(0);
  });

  it("虚线上级能发、能关自己发的；虚线下属的别的数据照旧只读", async () => {
    expect(await 发("虚管")).toEqual({ ok: true });
    const t = await 一条();
    当("虚管");
    expect(await 关闭主题动作(t.id)).toEqual({ ok: true });
    await expect(以谁的身份(人.虚管, () => db.project.update({ where: { id: 项目 }, data: { name: "改" } }))).rejects.toThrow();
    expect((await raw.project.findUniqueOrThrow({ where: { id: 项目 } })).name).toBe("甲的项目");
  });

  it("标题、内容空的或超长的挡住", async () => {
    expect((await 发("教练", 项目, { title: "  " })).ok).toBe(false);
    expect((await 发("教练", 项目, { body: "" })).ok).toBe(false);
    expect((await 发("教练", 项目, { title: "长".repeat(41) })).ok).toBe(false);
    expect(await raw.entCoachTopic.count()).toBe(0);
  });

  it("项目进公海冻结：不能回、不能关（直接改库进公海、没走放回的情况也挡）", async () => {
    await 发("教练");
    const t = await 一条();
    await raw.project.update({ where: { id: 项目 }, data: { pooledAt: new Date() } });
    当("甲");
    expect((await 回复主题动作(t.id, "x")).ok).toBe(false);
    当("教练");
    expect((await 关闭主题动作(t.id)).ok).toBe(false);
  });

  it("放回公海：没关的主题自动关、留痕，已关的不动；领走的新负责人不背待回复", async () => {
    await 发("教练");
    const 开着 = await 一条();
    await 发("组长");
    const 关了的 = await 一条();
    当("组长");
    await 关闭主题动作(关了的.id);
    const 关的时间 = (await raw.entCoachTopic.findUniqueOrThrow({ where: { id: 关了的.id } })).closedAt;
    当("甲");
    expect(await 放回公海(叫("甲"), 项目)).toMatchObject({ ok: true });
    const 后 = await raw.entCoachTopic.findUniqueOrThrow({ where: { id: 开着.id } });
    expect(后).toMatchObject({ status: "已关闭", closedById: null });
    expect(后.closedAt).not.toBeNull();
    expect((await raw.entCoachTopic.findUniqueOrThrow({ where: { id: 关了的.id } })).closedAt).toEqual(关的时间);
    expect(await raw.auditLog.count({ where: { entity: "EntCoachTopic", action: 进公海关主题动作, entityId: 开着.id } })).toBe(1);
    // 乙领走：没有给前任的待回复
    await raw.project.update({ where: { id: 项目 }, data: { pooledAt: null, ownerId: 人.乙 } });
    expect((await 待回复主题of(人.乙)).条数).toBe(0);
  });

  it("转让后待回复跟到新负责人；首页待办只数没冻结的", async () => {
    await 发("教练");
    await 发("组长");
    expect((await 待回复主题of(人.甲)).条数).toBe(2);
    await raw.project.update({ where: { id: 项目 }, data: { ownerId: 人.乙 } });
    expect((await 待回复主题of(人.甲)).条数).toBe(0);
    expect((await 待回复主题of(人.乙)).条数).toBe(2);
    await raw.project.update({ where: { id: 项目 }, data: { deletedAt: new Date() } });
    expect((await 待回复主题of(人.乙)).条数).toBe(0);
  });
});

describe("改删：发出后不能改删，只有系统管理员软删（只打记号）", () => {
  it("教练、负责人删不了；系统管理员删了打记号、谁都看不到、按编号也取不到", async () => {
    await 发("教练");
    const t = await 一条();
    for (const r of ["教练", "甲", "线总"] as 谁[]) {
      当(r);
      expect([r, (await 删主题动作(t.id)).ok]).toEqual([r, false]);
    }
    当("老板");
    expect(await 删主题动作(t.id)).toEqual({ ok: true });
    expect((await raw.entCoachTopic.findUniqueOrThrow({ where: { id: t.id } })).deletedAt).not.toBeNull();
    expect((await 读项目主题(我("甲"), 项目))?.们 ?? []).toEqual([]);
    expect(await 读一条主题(我("老板"), t.id)).toBeNull();
  });

  it("留痕里的主题名打码（跟进 11-22）：删、关、回的留痕不带原号码，库里主题照存原文", async () => {
    const t = await raw.entCoachTopic.create({ data: { projectId: 项目, node: "线索验证", title: "回访 13812345678 报价", body: "x", authorId: 人.教练 } });
    当("教练");
    expect(await 回复主题动作(t.id, "补一句")).toEqual({ ok: true });
    expect(await 关闭主题动作(t.id)).toEqual({ ok: true });
    当("老板");
    expect(await 删主题动作(t.id)).toEqual({ ok: true });
    const 痕 = await raw.auditLog.findMany({ where: { entity: "EntCoachTopic", entityId: t.id }, select: { action: true, summary: true } });
    expect(痕.map((x) => x.action).sort()).toEqual(["close", "delete", "reply"]);
    for (const x of 痕) {
      expect(x.summary).toContain("回访 138****5678 报价");
      expect(x.summary).not.toContain("13812345678");
    }
    expect((await raw.entCoachTopic.findUniqueOrThrow({ where: { id: t.id } })).title).toBe("回访 13812345678 报价");
  });

  it("没有改主题、改回复的口子：只读角色、负责人直接写库都拒", async () => {
    await 发("教练");
    const t = await 一条();
    await expect(以谁的身份(人.教练, () => db.entCoachTopic.update({ where: { id: t.id }, data: { title: "改" } }))).rejects.toThrow(教练只读话);
    await expect(以谁的身份(人.教练, () => db.entCoachTopic.delete({ where: { id: t.id } }))).rejects.toThrow(教练只读话);
    expect((await raw.entCoachTopic.findUniqueOrThrow({ where: { id: t.id } })).title).toBe("教练的主题");
  });
});

describe("只读角色：表级白名单只放经过判定的写", () => {
  it("教练、管理员不经过 主题写 直接建主题、回复：拒", async () => {
    const 数据 = { projectId: 项目, node: "线索验证", title: "偷偷发", body: "x", authorId: 人.教练 };
    await expect(以谁的身份(人.教练, () => db.entCoachTopic.create({ data: 数据 }))).rejects.toThrow(教练只读话);
    await expect(以谁的身份(人.管理员, () => db.entCoachTopic.create({ data: { ...数据, authorId: 人.管理员 } }))).rejects.toThrow();
    expect(await raw.entCoachTopic.count()).toBe(0);
  });

  it("包在 主题写 里也只放这两张表：顺手写别的表照样拒", async () => {
    await expect(以谁的身份(人.教练, () => 主题写(() => db.project.update({ where: { id: 项目 }, data: { name: "改" } })))).rejects.toThrow(教练只读话);
    await expect(以谁的身份(人.教练, () => 主题写(() => db.followUp.create({ data: { customerId: 客户, content: "x", type: "电话" } as never })))).rejects.toThrow(教练只读话);
  });

  it("管理员动作也发不了（判定挡）", async () => {
    const x = await 发("管理员");
    expect(x.ok).toBe(false);
  });
});

describe("不是沟通记录：发、回、关之后什么都不动", () => {
  it("沟通、三态钟、冷标、下一步计划、最近跟进、待办、计划、节点全部不变", async () => {
    const 快照 = async () => ({
      客户: await raw.customer.findUniqueOrThrow({ where: { id: 客户 } }),
      项目: await raw.project.findUniqueOrThrow({ where: { id: 项目 } }),
      钟: await raw.entCustomerClock.findMany(),
      冷: await raw.entProjectCold.findMany(),
      沟通: await raw.followUp.count(),
      挂项目: await raw.followUpProject.count(),
      待办: await raw.task.count(),
      计划: await raw.followPlan.count(),
      节点痕: await raw.projectNodeLog.count(),
    });
    const 前 = await 快照();
    await 发("教练");
    const t = await 一条();
    当("甲");
    await 回复主题动作(t.id, "收到");
    当("教练");
    await 回复主题动作(t.id, "再问一句");
    await 关闭主题动作(t.id);
    const 后 = await 快照();
    expect(后).toEqual(前);
  });
});

describe("读给界面", () => {
  it("负责人看到能回、不能关；教练看到能回能关；组员拿不到这一块", async () => {
    await 发("教练");
    const 甲看 = await 读项目主题(我("甲"), 项目);
    expect(甲看?.能发).toBe(false);
    expect(甲看?.们[0]).toMatchObject({ 能回: true, 能关: false, 能删: false, 作者: { name: "教练", 身份: "销售教练" } });
    const 教练看 = await 读项目主题(我("教练"), 项目);
    expect(教练看).toMatchObject({ 能发: true, 填写人: { id: 人.教练, 身份: "销售教练" }, 负责人: { id: 人.甲 }, 待回复数: 1, 冻结: false });
    expect(教练看?.们[0]).toMatchObject({ 能回: true, 能关: true });
    const 组员看 = await 读项目主题(我("组员"), 项目);
    expect(组员看?.们).toEqual([]);
    expect(组员看?.能发).toBe(false);
  });
});

describe("读入口：先判能不能看项目（两张表不在限定层里）", () => {
  it("没权限的人拿编号直接取，取不到；整块也不给", async () => {
    await 发("教练");
    const t = await 一条();
    for (const r of ["乙", "市场", "市场2", "组员", "没角色"] as 谁[]) {
      expect([r, await 读一条主题(我(r), t.id)]).toEqual([r, null]);
    }
    // 乙看不到甲的项目：整块 null（不是空列表）
    expect(await 读项目主题(我("乙"), 项目)).toBeNull();
    expect(await 读一条主题(我("甲"), t.id)).toMatchObject({ id: t.id, title: "教练的主题" });
    expect(await 读一条主题(我("组长"), t.id)).toMatchObject({ id: t.id });
    expect(await 读一条主题(我("甲"), "没有这个编号")).toBeNull();
  });
});

describe("收尾：发起人不在了、第三方回复、第二次追问", () => {
  it("发起人停用后：负责人能关（系统管理员一直能关）；没停用时负责人关不了", async () => {
    await 发("教练");
    const t = await 一条();
    当("甲");
    expect((await 关闭主题动作(t.id)).ok).toBe(false);
    await raw.user.update({ where: { id: 人.教练 }, data: { active: false } });
    当("甲");
    expect(await 关闭主题动作(t.id)).toEqual({ ok: true });
    expect(await raw.entCoachTopic.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ status: "已关闭", closedById: 人.甲 });
    // 别人（组长）还是关不了别人发的
    await raw.user.update({ where: { id: 人.教练 }, data: { active: true } });
    await 发("教练");
    const t2 = await 一条();
    await raw.user.update({ where: { id: 人.教练 }, data: { active: false } });
    当("组长");
    expect((await 关闭主题动作(t2.id)).ok).toBe(false);
  });

  it("第三方（组长）在教练的主题下回复：状态不变，通知发起人和负责人", async () => {
    await 发("教练");
    const t = await 一条();
    await raw.entNotice.deleteMany();
    当("组长");
    expect(await 回复主题动作(t.id, "我也看看")).toEqual({ ok: true });
    expect((await raw.entCoachTopic.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("待回复");
    expect((await raw.entNotice.findMany()).map((n) => n.userId).sort()).toEqual([人.教练, 人.甲].sort());
    当("甲");
    await 回复主题动作(t.id, "收到");
    当("组长");
    await 回复主题动作(t.id, "补一句");
    expect((await raw.entCoachTopic.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("已回复");
  });

  it("同一主题第二次追问、第二次回复各来一条通知（键带回复编号）", async () => {
    await 发("教练");
    const t = await 一条();
    for (let i = 0; i < 2; i++) {
      当("甲");
      await 回复主题动作(t.id, `回复${i}`);
      当("教练");
      await 回复主题动作(t.id, `追问${i}`);
    }
    expect(await raw.entNotice.count({ where: { userId: 人.甲 } })).toBe(3); // 发起 1 + 追问 2
    expect(await raw.entNotice.count({ where: { userId: 人.教练 } })).toBe(2); // 回复 2
  });
});

describe("署名按发起身份（11-23：写点评框、沟通卡、复盘列表三处一致）", () => {
  const 沟通卡身份 = async (r: 谁) => (await 读项目主题(我(r), 项目))?.们[0]?.作者.身份;
  const 复盘身份 = async (r: 谁) => (await 复盘主题of(我(r), [人.甲], { 范围: "all" })).行[0]?.身份;

  it("组长（主业务角色销售管理）发起：存发起身份「实线上级」，写点评框、沟通卡、复盘列表都写实线上级，不写销售管理", async () => {
    expect((await 读项目主题(我("组长"), 项目))?.填写人?.身份).toBe("实线上级");
    expect(await 发("组长")).toMatchObject({ ok: true });
    expect((await 一条()).authorRole).toBe("实线上级");
    expect(await 沟通卡身份("甲")).toBe("实线上级");
    expect(await 沟通卡身份("组长")).toBe("实线上级");
    expect(await 复盘身份("甲")).toBe("实线上级");
    // 发起后关系变了（甲换了上级）：署名照发起时存的写
    await raw.entMember.update({ where: { userId: 人.甲 }, data: { managerId: null } });
    expect(await 沟通卡身份("甲")).toBe("实线上级");
    expect(await 复盘身份("甲")).toBe("实线上级");
  });

  it("老主题（没存发起身份）：照现有规则推断；推不出退回主业务角色", async () => {
    expect(await 发("组长")).toMatchObject({ ok: true });
    await raw.entCoachTopic.updateMany({ data: { authorRole: null } });
    expect(await 沟通卡身份("甲")).toBe("实线上级");
    expect(await 复盘身份("甲")).toBe("实线上级");
    await raw.entMember.update({ where: { userId: 人.甲 }, data: { managerId: null } });
    expect(await 沟通卡身份("甲")).toBe("销售管理");
    expect(await 复盘身份("甲")).toBe("销售管理");
  });

  it("存的不是认得的发起身份（存坏了）：当没存，照推断", async () => {
    expect(await 发("教练")).toMatchObject({ ok: true });
    await raw.entCoachTopic.updateMany({ data: { authorRole: "乱写的" } });
    expect(await 沟通卡身份("甲")).toBe("销售教练");
  });
});

describe("复盘「沟通」页签的「主题」一档（PR3b）", () => {
  it("我发起的 / 待我回复 / 全部 + 状态；每条过 能看主题，圈外、组员、看不到项目的拿不到", async () => {
    await 发("教练");
    await 发("组长");
    await 发("市场", 乙项目);
    const 组长的 = await raw.entCoachTopic.findFirstOrThrow({ where: { authorId: 人.组长 } });
    当("甲");
    await 回复主题动作(组长的.id, "收到");
    const 名 = (d: { 行: { 标题: string }[] }) => d.行.map((x) => x.标题).sort();
    // 教练：全部 = 看得到的全部（圈不限）
    expect(名(await 复盘主题of(我("教练"), undefined, { 范围: "all" }))).toEqual(["组长的主题", "教练的主题", "市场的主题"].sort());
    expect(名(await 复盘主题of(我("教练"), undefined, { 范围: "mine" }))).toEqual(["教练的主题"]);
    // 甲：待我回复只剩教练那条；状态筛已回复 = 组长那条
    expect(名(await 复盘主题of(我("甲"), [人.甲], { 范围: "wait" }))).toEqual(["教练的主题"]);
    expect(名(await 复盘主题of(我("甲"), [人.甲], { 范围: "all", 状态: "已回复" }))).toEqual(["组长的主题"]);
    // 乙：圈不限也只看到自己项目上的（甲的项目他看不到）
    expect(名(await 复盘主题of(我("乙"), undefined, { 范围: "all" }))).toEqual(["市场的主题"]);
    // 组员：看得到项目、但不在 Q6 名单里 → 一条都没有
    expect((await 复盘主题of(我("组员"), undefined, { 范围: "all" })).总数).toBe(0);
    const 行 = (await 复盘主题of(我("教练"), undefined, { 范围: "mine" })).行[0];
    expect(行).toMatchObject({ projectId: 项目, 项目: "甲的项目", 状态: "待回复", 发起人: "教练", 身份: "销售教练", 回复数: 0 });
  });

  it("项目进了回收站的不列；删了的主题不列", async () => {
    await 发("教练");
    const t = await 一条();
    await raw.project.update({ where: { id: 项目 }, data: { deletedAt: new Date() } });
    expect((await 复盘主题of(我("教练"), undefined, { 范围: "all" })).总数).toBe(0);
    await raw.project.update({ where: { id: 项目 }, data: { deletedAt: null } });
    await raw.entCoachTopic.update({ where: { id: t.id }, data: { deletedAt: new Date() } });
    expect((await 复盘主题of(我("教练"), undefined, { 范围: "all" })).总数).toBe(0);
  });
});
