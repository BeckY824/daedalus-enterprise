/**
 * 受限客户详情（只负责项目的人，用户 11-12 定；集合见 lib/enterprise/project-only-customers.ts）：
 * 客户我按现有规则看不到，但名下有我负责、不在公海的项目——点进 /customers/<id> 给这一份，不给原来的客户详情。
 *
 *   - 左栏 = 客户只读卡同一份（lib/enterprise/customer-readonly-card.ts 读卡底子 / 拼卡）：客户资料白名单、联系人姓名职务，
 *     只有我自己项目上的联系人给联系方式；不给负责人、级别、状态、备注、客户手机号。我自己建的、挂在我项目上的联系人多给编号（能改）
 *   - 右边 = 只有我自己的项目（读项目区，不数同事项目的锁）；沟通只取我这几个项目上的（含前任记在这几个项目上的），
 *     不调 客户沟通汇总（那里有客户级老跟进、别的项目）；待办只取我名下的
 * 客户本身照旧改不了：客户 update / 转让 / 放公海 / 删除 / 三态都走限定层，这里不开任何写入口。
 */
import type { SessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { scheduleValue } from "@/lib/schedule-date";
import { 仅项目可见 } from "@/lib/enterprise/project-only-customers";
import { 读卡底子, 拼卡, type 客户只读卡 } from "@/lib/enterprise/customer-readonly-card";
import { 号码脱敏器 } from "@/lib/enterprise/phone-mask";
import { 联系人号码们, 页面号码种类表 } from "@/lib/enterprise/customer-v2-db";
import { 页面可选项, 预读页面字典 } from "@/lib/enterprise/dict";
import { 企业版字典, 本套位置 } from "@/lib/project/nodes";
import { 读项目区 } from "./project-zone";
import { 项目详情字典们 } from "../../projects/[id]/load";
import type { 项目区数据 } from "./ProjectZone";
import type { ContactRow } from "./types";

/** 我这几个项目上的一条沟通（只读，按项目摆） */
export type 受限沟通 = { id: string; 项目: { id: string; 名: string }; occurredAt: string; type: string; method: string | null; content: string; who: string };

export type 受限客户详情 = {
  客户: { id: string; name: string };
  卡: 客户只读卡;
  /** 我自己建的、挂在我项目上的联系人：编辑框要的整行（号码过脱敏器，同客户详情页） */
  可改联系人: ContactRow[];
  项目区: 项目区数据;
  沟通: 受限沟通[];
  待办: {
    任务: { id: string; title: string; dueAt: string | null; dueHasTime: boolean | null }[];
    计划: { id: string; subject: string; plannedAt: string | null; plannedHasTime: boolean | null }[];
  };
  号码种类: { 名: string; kind: string; active: boolean }[];
  职务选项: string[];
};

/** 号码类的几种过脱敏器，微信、邮箱这些照旧（同客户详情页联系人的口径） */
const 打码种类 = new Set(["phone", "landline", "whatsapp", "fax"]);
const 沟通上限 = 200;

/** 读受限详情：不是「仅项目」客户（看不到、或本来就看得到）= null，页面照旧 404 / 走原详情 */
export async function 读受限客户详情(me: SessionUser, customerId: string, 要的: string | null): Promise<受限客户详情 | null> {
  const 我的项目 = await 仅项目可见(me, customerId);
  if (!我的项目?.length) return null;
  const 底 = await 读卡底子(customerId, me.id);
  if (!底 || 底.在公海) return null;
  预读页面字典(["contactTitle", "contactKind", ...项目详情字典们]);

  // 绕开限定层的读一律写明字段：客户本身看不到
  const [客户行, 项目行, 我建的, 号] = await Promise.all([
    看全部(() => prisma.customer.findFirst({ where: { id: customerId, deletedAt: null }, select: { id: true, name: true } })),
    看全部(() => prisma.project.findMany({
      where: { id: { in: 我的项目 }, customerId, ownerId: me.id, pooledAt: null },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: { id: true, name: true, phase: true, node: true, result: true, pooledAt: true },
    })),
    看全部(() => prisma.contact.findMany({
      where: { customerId, deletedAt: null, createdById: me.id, id: { in: [...底.自己项目的人] } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, name: true, position: true, phone: true, email: true, wechat: true, remark: true, updatedAt: true,
        gender: true, birthday: true, hobby: true, address: true,
        contactMethods: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { kind: true, value: true } },
      },
    })),
    号码脱敏器(me.id),
  ]);
  if (!客户行 || !项目行.length) return null;
  const 项目们 = 项目行.map((p) => ({ ...本套位置(p, 企业版字典), id: p.id, name: p.name, pooledAt: p.pooledAt }));
  const ids = 项目们.map((p) => p.id);
  const 项目名 = new Map(项目们.map((p) => [p.id, p.name]));

  const [卡, 项目区, 沟通行, 任务, 计划, 号码种类, 职务选项] = await Promise.all([
    拼卡(me, customerId, 底, new Set(我建的.map((c) => c.id))),
    读项目区(me, customerId, 项目们, 要的, { 不数锁: true }),
    看全部(() => prisma.followUpProject.findMany({
      where: { projectId: { in: ids }, followUp: { deletedAt: null } },
      orderBy: [{ followUp: { occurredAt: "desc" } }, { followUpId: "desc" }],
      take: 沟通上限,
      select: { projectId: true, followUp: { select: { id: true, occurredAt: true, type: true, method: true, content: true, ownerId: true } } },
    })),
    // 待办：只我名下的（带限定，Task / FollowPlan 本来就按 ownerId 放给我）
    prisma.task.findMany({ where: { customerId, ownerId: me.id, done: false }, orderBy: [{ dueAt: "asc" }, { id: "asc" }], take: 20, select: { id: true, title: true, dueAt: true, dueOn: true, dueHasTime: true } }),
    prisma.followPlan.findMany({ where: { customerId, ownerId: me.id, done: false }, orderBy: [{ plannedAt: "asc" }, { id: "asc" }], take: 20, select: { id: true, subject: true, plannedAt: true, plannedOn: true, plannedHasTime: true } }),
    页面号码种类表().then((t) => t.map((x) => ({ 名: x.名, kind: x.kind, active: x.active }))),
    页面可选项("contactTitle"),
  ]);
  const 记的人 = new Map((await 看全部(() => prisma.user.findMany({ where: { id: { in: [...new Set(沟通行.map((r) => r.followUp.ownerId))] } }, select: { id: true, name: true } }))).map((u) => [u.id, u.name]));

  return {
    客户: 客户行,
    卡,
    可改联系人: 我建的.map((c) => ({
      id: c.id, name: c.name, position: c.position, phone: 号(c.phone), email: c.email, wechat: c.wechat,
      // 受限详情里联系人不能设主要联系人（第一期）
      isPrimary: false,
      remark: c.remark, updatedAt: c.updatedAt.toISOString(),
      gender: c.gender, birthday: c.birthday, hobby: c.hobby, address: c.address,
      号码们: 联系人号码们(c, c.contactMethods).map((x) => ({ kind: x.kind, value: 打码种类.has(x.kind) ? 号(x.value) : x.value })),
    })),
    项目区,
    沟通: 沟通行.map((r) => ({
      id: r.followUp.id, 项目: { id: r.projectId, 名: 项目名.get(r.projectId) ?? "" }, occurredAt: r.followUp.occurredAt.toISOString(),
      type: r.followUp.type, method: r.followUp.method, content: r.followUp.content, who: 记的人.get(r.followUp.ownerId) ?? "已不在的成员",
    })),
    待办: {
      任务: 任务.map((t) => ({ id: t.id, title: t.title, dueAt: scheduleValue(t.dueAt, t.dueOn), dueHasTime: t.dueHasTime })),
      计划: 计划.map((p) => ({ id: p.id, subject: p.subject, plannedAt: scheduleValue(p.plannedAt, p.plannedOn), plannedHasTime: p.plannedHasTime })),
    },
    号码种类,
    职务选项,
  };
}
