/**
 * 企业版沟通记录 P3（10-31）：F-跟进-08 记沟通时顺手标卡点、F-跟进-07 沟通记录挂截图 / 录音、M-权限-09 谁能改删沟通。
 *
 * 钉的是：
 *   - 卡点（lib/project/blocker-rules.ts 沟通卡点）：没给、类型「暂无卡点」或没选且描述空 → 不生成；选了类型或写了描述 → 生成，
 *     影响没选按默认、阻碍主体落「其他」、描述空写占位；坏取值报错、一行不写
 *   - 记项目沟通Action 带卡点：生成的卡点挂在这条沟通上；暂无 + 空描述一个卡点都不建；客户页带的标题 / 状态 / 时长 / 参与人 / 联系人一次存好
 *   - 附件：?followUpId= 记这条的本人能传截图、录音（m4a 没类型按扩展名认），别的文件 415；同事传 403；
 *     删只有总管理员、经理能删，普通成员 403 附件原样；没挂项目的沟通、项目模式关着 404；沟通进回收站附件不当孤儿清
 *   - 权限：普通成员改沟通被拒、删老的沟通被拒（原样还在）；本人刚记的 10 分钟内能撤；
 *     经理（账号主管 / 组织里销售管理）能改能删，删了是软删、老板回收站里看得到
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "QA", email: "qa-p3", role: "SALES", title: "", avatar: null } as { id: string; name: string; email: string; role: string; title: string; avatar: null },
  项目模式: true,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => mocks.user, requireUser: async () => mocks.user }));
vi.mock("@/lib/shared-ws/current", async (原) => ({ ...(await 原<object>()), 当前是共享区: async () => false }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: mocks.项目模式 }) };
});

import { prisma, defaultClient as raw } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 记项目沟通Action, 改项目沟通, 删项目沟通 } from "@/app/(app)/projects/actions";
import { deleteFollowUp } from "@/app/(app)/customers/[id]/actions";
import { 沟通卡点, 沟通卡点占位描述, 默认卡点默认 } from "@/lib/project/blocker-rules";
import { 能删改沟通, 能删改沟通of, 刚记的能撤, 不能删改沟通话 } from "@/lib/enterprise/follow-perm";
import { 建组织 } from "@/lib/enterprise/org-core";
import { 回收站列表 } from "@/lib/enterprise/soft-delete";
import { 清孤儿 } from "@/lib/attachments";
import { POST as 传, GET as 列 } from "@/app/api/attachments/route";
import { DELETE as 删 } from "@/app/api/attachments/[id]/route";

const 附件夹 = fs.mkdtempSync(path.join(os.tmpdir(), "crm-p3fu-"));
const 原数据夹 = process.env.CRM_DATA_DIR;
process.env.CRM_DATA_DIR = 附件夹;
afterAll(async () => {
  if (原数据夹 === undefined) delete process.env.CRM_DATA_DIR;
  else process.env.CRM_DATA_DIR = 原数据夹;
  fs.rmSync(附件夹, { recursive: true, force: true });
  await prisma.$disconnect();
});

let 老板: string, 经理: string, 销管: string, 销售: string, 同事: string, 客户: string, 别的客户: string, 项目: string;
const 当 = (id: string, role = "SALES") => { mocks.user = { ...mocks.user, id, role, name: id }; };
const 沟通 = (x: Record<string, unknown> = {}) => ({ type: "PHONE", content: "电话聊了报价", occurredAt: "2026-10-20 10:00", 阶段: "线索", 明确回复: true, 下一步: "周五前发报价单", ...x });
const 记一条 = async (x: Record<string, unknown> = {}, 卡点?: Parameters<typeof 记项目沟通Action>[2]) => {
  const r = await 记项目沟通Action(项目, 沟通(x) as never, 卡点);
  if (!r.ok) throw new Error(r.error);
  return r;
};
/** 记下来超过撤销窗口了：本人也不能自己删 */
const 变老 = (id: string) => raw.followUp.update({ where: { id }, data: { createdAt: new Date(Date.now() - 60 * 60_000) } });

const 字节 = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;
const 传一个 = (followUpId: string, 名字 = "截图.png", 类型 = "image/png") => {
  const 体 = 字节(`\x89PNG ${名字}`);
  const headers: Record<string, string> = { "Content-Length": String(体.byteLength) };
  if (类型) headers["Content-Type"] = 类型;
  return 传(new Request(`http://x/api/attachments?followUpId=${followUpId}&name=${encodeURIComponent(名字)}`, { method: "POST", body: 体, headers }));
};
const 附件id = async (r: Response) => ((await r.json()) as { 附件: { id: string } }).附件.id;
const 删一个 = (id: string) => 删(new Request(`http://x/api/attachments/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });
const 还在 = async (id: string) => !!(await prisma.attachment.findUnique({ where: { id } }));

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  mocks.项目模式 = true;
  await resetDb();
  invalidateSettingsCache();
  const 人 = async (email: string, role = "SALES", bizRole?: string) => {
    const id = (await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } })).id;
    if (bizRole) await prisma.entMember.create({ data: { userId: id, bizRole } });
    return id;
  };
  老板 = await 人("p3-boss", "ADMIN");
  经理 = await 人("p3-mgr", "MANAGER");
  销管 = await 人("p3-smgr", "SALES", "sales_mgr");
  销售 = await 人("p3-s1", "SALES", "sales");
  同事 = await 人("p3-s2", "SALES", "sales");
  客户 = (await prisma.customer.create({ data: { name: "QA-沟通客户", phone: "13800001103", salesOwnerId: 销售 } })).id;
  别的客户 = (await prisma.customer.create({ data: { name: "QA-别的客户", phone: "13800001104", salesOwnerId: 销售 } })).id;
  项目 = (await prisma.project.create({ data: { customerId: 客户, ownerId: 销售, creatorId: 销售, name: "QA-沟通项目", phase: "线索", node: "潜客培育" } })).id;
  当(销售);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("F-跟进-08 卡点：生成 / 不生成", () => {
  const 默 = 默认卡点默认;
  it("没给、暂无卡点 + 描述空、什么都没选 → 不生成", () => {
    expect(沟通卡点(null, 默)).toBeNull();
    expect(沟通卡点(undefined, 默)).toBeNull();
    expect(沟通卡点({}, 默)).toBeNull();
    expect(沟通卡点({ type: "暂无卡点", impact: null, description: "" }, 默)).toBeNull();
    expect(沟通卡点({ type: "暂无卡点", impact: "项目暂停", description: "   " }, 默)).toBeNull();
  });
  it("选了类型或写了描述 → 生成；影响没选按默认，阻碍主体落「其他」，描述空写占位", () => {
    expect(沟通卡点({ type: "重要卡点" }, 默)).toEqual({ type: "重要卡点", impact: 默.默认影响, obstacle: "其他", description: 沟通卡点占位描述 });
    expect(沟通卡点({ type: "暂无卡点", description: "预算还没批" }, 默)).toEqual({ type: "暂无卡点", impact: 默.默认影响, obstacle: "其他", description: "预算还没批" });
    expect(沟通卡点({ description: "等对方技术评估" }, 默)).toMatchObject({ type: "暂无卡点", description: "等对方技术评估" });
    expect(沟通卡点({ type: "中度卡点", impact: "项目暂停", description: "x", obstacle: "价格" }, 默)).toMatchObject({ impact: "项目暂停", obstacle: "价格" });
    // 选项里没有「其他」：落第一个
    expect(沟通卡点({ type: "轻度卡点" }, { ...默, 阻碍主体们: ["客户", "技术"] })).toMatchObject({ obstacle: "客户" });
  });
  it("坏取值报错", () => {
    expect(沟通卡点({ type: "瞎填" }, 默)).toHaveProperty("error");
    expect(沟通卡点({ type: "重要卡点", impact: "瞎填" }, 默)).toHaveProperty("error");
    expect(沟通卡点("重要卡点" as never, 默)).toHaveProperty("error");
    expect(沟通卡点({ description: "字".repeat(501) }, 默)).toHaveProperty("error");
  });

  it("记沟通带卡点：暂无 + 空描述一个都不建；选了重要卡点建一个、挂在这条沟通上", async () => {
    const 没 = await 记一条({}, { type: "暂无卡点", impact: null, description: "" });
    expect(没).not.toHaveProperty("卡点");
    expect(没).not.toHaveProperty("卡点没发");
    expect(await prisma.entBlocker.count()).toBe(0);

    const 有 = await 记一条({}, { type: "重要卡点", impact: "项目暂停", description: "预算卡住了" });
    expect(有).toMatchObject({ ok: true, 卡点: expect.stringMatching(/^BLK/) });
    const 卡 = await prisma.entBlocker.findFirstOrThrow();
    expect(卡).toMatchObject({ followUpId: 有.followUpId, projectId: 项目, customerId: 客户, type: "重要卡点", impact: "项目暂停", obstacle: "其他", description: "预算卡住了", creatorId: 销售 });
    expect(await prisma.entBlocker.count()).toBe(1);
  });

  it("卡点取值坏的：整条不记（沟通、卡点都不建）", async () => {
    expect(await 记项目沟通Action(项目, 沟通() as never, { type: "瞎填" })).toMatchObject({ ok: false, error: expect.stringContaining("卡点") });
    expect(await prisma.followUpProject.count({ where: { projectId: 项目 } })).toBe(0);
    expect(await prisma.entBlocker.count()).toBe(0);
  });

  it("没开项目模式：不建沟通也不建卡点", async () => {
    mocks.项目模式 = false;
    expect(await 记项目沟通Action(项目, 沟通() as never, { type: "重要卡点" })).toMatchObject({ ok: false });
    expect(await prisma.followUp.count()).toBe(0);
    expect(await prisma.entBlocker.count()).toBe(0);
  });
});

describe("F-跟进-06 客户页「更多」里的格子一次存好（额外）", () => {
  it("标题、状态、时长、参与人、另选的联系人都落库", async () => {
    const 联系人 = (await prisma.contact.create({ data: { customerId: 客户, name: "对接人" } })).id;
    const r = await 记一条({ 额外: { title: "报价沟通", contactId: 联系人, status: "待处理", durationMinutes: 1.5, participants: "甲、乙" } });
    expect(await prisma.followUp.findUniqueOrThrow({ where: { id: r.followUpId } })).toMatchObject({
      title: "报价沟通", contactId: 联系人, status: "待处理", duration: 90, participants: "甲、乙", ownerId: 销售,
    });
  });
  it("别家客户的联系人、坏状态：挡下，一条不记", async () => {
    const 外人 = (await prisma.contact.create({ data: { customerId: 别的客户, name: "外人" } })).id;
    expect(await 记项目沟通Action(项目, 沟通({ 额外: { contactId: 外人 } }) as never)).toMatchObject({ ok: false, error: expect.stringContaining("联系人") });
    expect(await 记项目沟通Action(项目, 沟通({ 额外: { status: "瞎填" } }) as never)).toMatchObject({ ok: false });
    expect(await prisma.followUp.count()).toBe(0);
  });
});

describe("F-跟进-07 沟通记录挂截图、录音", () => {
  it("本人传截图、录音（m4a 没类型按扩展名认）挂在这条沟通上；别的文件 415", async () => {
    const { followUpId } = await 记一条();
    const 图 = await 传一个(followUpId!);
    expect(图.status).toBe(200);
    const 图id = await 附件id(图);
    expect(await prisma.attachment.findUniqueOrThrow({ where: { id: 图id } })).toMatchObject({ followUpId, projectId: null, mime: "image/png" });

    const 音 = await 传一个(followUpId!, "通话.m4a", "");
    expect(音.status).toBe(200);
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: await 附件id(音) } })).mime).toBe("audio/mp4");
    expect((await 传一个(followUpId!, "录音.mp3", "audio/mpeg")).status).toBe(200);

    expect((await 传一个(followUpId!, "合同.pdf", "application/pdf")).status).toBe(415);
    const 列表 = await 列(new Request(`http://x/api/attachments?followUpId=${followUpId}`));
    expect(列表.status).toBe(200);
    expect(((await 列表.json()) as { 附件: unknown[] }).附件).toHaveLength(3);
  });

  it("同事（不是记这条的）传 403；成员删 403、附件原样；经理删得掉", async () => {
    const { followUpId } = await 记一条();
    const id = await 附件id(await 传一个(followUpId!));
    当(同事);
    expect((await 传一个(followUpId!)).status).toBe(403);
    当(销售);
    expect((await 删一个(id)).status).toBe(403);
    expect(await 还在(id)).toBe(true);
    当(经理, "MANAGER");
    expect((await 删一个(id)).status).toBe(200);
    expect(await 还在(id)).toBe(false);
  });

  it("没挂项目的沟通、项目模式关着：404", async () => {
    const 光杆 = await prisma.followUp.create({ data: { customerId: 客户, ownerId: 销售, type: "PHONE", title: "", content: "客户页记的", status: "已完成", occurredAt: new Date() } });
    expect((await 传一个(光杆.id)).status).toBe(404);
    const { followUpId } = await 记一条();
    mocks.项目模式 = false;
    expect((await 传一个(followUpId!)).status).toBe(404);
    expect(await prisma.attachment.count()).toBe(0);
  });

  it("清孤儿：沟通进了回收站附件留着（能恢复），彻底删了才清", async () => {
    const { followUpId } = await 记一条();
    const id = await 附件id(await 传一个(followUpId!));
    await raw.followUp.update({ where: { id: followUpId! }, data: { deletedAt: new Date() } });
    await 清孤儿(raw, 附件夹, Date.now() + 48 * 3600 * 1000, true);
    expect(await raw.attachment.findUnique({ where: { id } })).not.toBeNull();
    await raw.followUpProject.deleteMany({ where: { followUpId: followUpId! } });
    await raw.followUp.delete({ where: { id: followUpId! } });
    // 第一次只记下「没了」的时间，满 1 天再清
    const 起 = Date.now();
    await 清孤儿(raw, 附件夹, 起, true);
    expect(await raw.attachment.findUnique({ where: { id } })).not.toBeNull();
    await 清孤儿(raw, 附件夹, 起 + 25 * 3600 * 1000, true);
    expect(await raw.attachment.findUnique({ where: { id } })).toBeNull();
  });
});

describe("M-权限-09 谁能改删沟通", () => {
  it("能删改沟通of：老板、主管账号，组织里总管理员、销售管理能；普通销售不能", () => {
    const org = 建组织(
      [{ id: "总", role: "SALES", active: true }, { id: "销管", role: "SALES", active: true }, { id: "销", role: "SALES", active: true }, { id: "市", role: "SALES", active: true }],
      [
        { userId: "总", deptId: null, bizRole: "director", line: null, managerId: null, dottedManagerId: null },
        { userId: "销管", deptId: null, bizRole: "sales_mgr", line: null, managerId: null, dottedManagerId: null },
        { userId: "销", deptId: null, bizRole: "sales", line: null, managerId: null, dottedManagerId: null },
        { userId: "市", deptId: null, bizRole: "marketing_mgr", line: null, managerId: null, dottedManagerId: null },
      ],
      [],
    );
    expect(能删改沟通of({ id: "x", role: "ADMIN" }, null)).toBe(true);
    expect(能删改沟通of({ id: "x", role: "MANAGER" }, null)).toBe(true);
    expect(能删改沟通of({ id: "x", role: "SALES" }, null)).toBe(false);
    expect(能删改沟通of({ id: "总", role: "SALES" }, org)).toBe(true);
    expect(能删改沟通of({ id: "销管", role: "SALES" }, org)).toBe(true);
    expect(能删改沟通of({ id: "销", role: "SALES" }, org)).toBe(false);
    expect(能删改沟通of({ id: "市", role: "SALES" }, org)).toBe(false);
  });

  it("刚记的能撤：本人、10 分钟内；过了、别人的、没记人的都不行", () => {
    const 现在 = new Date("2026-10-31T12:00:00Z");
    const 前 = (分: number) => new Date(现在.getTime() - 分 * 60_000);
    expect(刚记的能撤({ id: "我" }, { ownerId: "我", createdAt: 前(5) }, 现在)).toBe(true);
    expect(刚记的能撤({ id: "我" }, { ownerId: "我", createdAt: 前(11) }, 现在)).toBe(false);
    expect(刚记的能撤({ id: "我" }, { ownerId: "他", createdAt: 前(1) }, 现在)).toBe(false);
    expect(刚记的能撤({ id: "我" }, { ownerId: null, createdAt: 前(1) }, 现在)).toBe(false);
  });

  it("不是企业版：照旧谁都能改删（团队版的规矩不在这里管）", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 能删改沟通({ id: 销售, role: "SALES" })).toBe(true);
  });

  it("普通成员：改自己的沟通被拒、内容原样；删记了一阵的被拒、原样还在", async () => {
    const { followUpId } = await 记一条();
    const id = followUpId!;
    expect(await 改项目沟通(项目, id, { type: "WECHAT", content: "成员想改", occurredAt: "2026-10-19 09:30" })).toEqual({ ok: false, error: 不能删改沟通话 });
    expect((await prisma.followUp.findUniqueOrThrow({ where: { id } })).content).toBe("电话聊了报价");
    await 变老(id);
    expect(await 删项目沟通(项目, id)).toEqual({ ok: false, error: 不能删改沟通话 });
    expect(await deleteFollowUp(id, 客户)).toEqual({ ok: false, error: 不能删改沟通话 });
    expect(await prisma.followUp.findUnique({ where: { id }, select: { id: true } })).toEqual({ id });
    // 同事更不行
    当(同事);
    expect(await deleteFollowUp(id, 客户)).toMatchObject({ ok: false });
    expect(await prisma.followUp.findUnique({ where: { id }, select: { id: true } })).toEqual({ id });
  });

  it("本人刚记的（AI 卡片撤销、记错马上撤）能删，照样软删", async () => {
    const { followUpId } = await 记一条();
    expect(await deleteFollowUp(followUpId!, 客户)).toMatchObject({ ok: true });
    expect((await raw.followUp.findUnique({ where: { id: followUpId! }, select: { deletedAt: true } }))?.deletedAt).toBeInstanceOf(Date);
  });

  it("经理（账号主管）改得了；删了是软删、老板回收站里看得到", async () => {
    const { followUpId } = await 记一条();
    const id = followUpId!;
    await 变老(id);
    当(经理, "MANAGER");
    expect(await 改项目沟通(项目, id, { type: "WECHAT", content: "经理改过", occurredAt: "2026-10-19 09:30" })).toEqual({ ok: true });
    expect((await prisma.followUp.findUniqueOrThrow({ where: { id } })).content).toBe("经理改过");
    expect(await 删项目沟通(项目, id)).toMatchObject({ ok: true });
    expect(await prisma.followUp.findUnique({ where: { id } })).toBeNull();
    expect((await raw.followUp.findUnique({ where: { id }, select: { deletedAt: true } }))?.deletedAt).toBeInstanceOf(Date);
    expect((await 回收站列表({ id: 老板, role: "ADMIN" })).map((x) => x.id)).toContain(id);
  });

  it("组织里的销售管理（账号是普通销售）也能删；总管理员（老板）能删", async () => {
    const 一 = (await 记一条()).followUpId!;
    const 二 = (await 记一条()).followUpId!;
    await 变老(一);
    await 变老(二);
    当(销管);
    expect(await deleteFollowUp(一, 客户)).toMatchObject({ ok: true });
    当(老板, "ADMIN");
    expect(await deleteFollowUp(二, 客户)).toMatchObject({ ok: true });
    const 收 = (await 回收站列表({ id: 老板, role: "ADMIN" })).map((x) => x.id);
    expect(收).toEqual(expect.arrayContaining([一, 二]));
  });
});
