/**
 * 企业版合成联系人（2026-11-25，客户 E-277 第一批「员工可勾是同一个人，把两位合成一位」；方案 docs/合并客户-第一批-落地.md 第七节）。
 *
 * 同一位客户下两位联系人是同一个人：「并」那位的号码、名片 / 附件、沟通、项目联系人、挂靠、同步对照都收到「留」那位，
 * 「并」那位只软删（进回收站标「已合成 → 留」，不能单独恢复 / 彻底删除）。合成单记在 EntCustomerMerge（kind = 联系人）：
 *   - 合并客户时勾的「是同一个人」：挂在客户合并单下（parentId），整单撤回时先拆开再挪回
 *   - 客户详情里单独合成：parentId 空，30 天内合成的人本人或系统管理员可撤回（撤回合并 一个入口）
 * 号码按规整值（kind + numberKey）去重：相同的只留「留」那行，不同的都收过来（E-277「规整后相同的号只留一行」）。
 * 撤回同合并客户：只比合成写过的那几格，还是合成写下的才改回，对不上的记进 没还原。
 */
import type { Prisma } from "@/generated/prisma";

type Tx = Prisma.TransactionClient;
export type 没还原 = { 类: string; id: string; 原因: string };

/** 没还原的「类」给人看的叫法（撤回结果、合并单列表直接摆；审查第二单建议 5：不摆 followUp.customerId 这种） */
const 类叫法: Record<string, string> = {
  "followUp.customerId": "沟通", "task.customerId": "待办", "followPlan.customerId": "跟进计划", "opportunity.customerId": "老商机", "contract.customerId": "老合同",
  "contactMethod.customerId": "号码", "customerOwnerLog.customerId": "负责人历史", "entBlocker.customerId": "卡点", "unassignedContact.fromCustomerId": "移出的联系人",
  "customer.referrerCustomerId": "推荐人（别的客户）", "customer.attributionCustomerId": "业绩归属（别的客户）", "contactCustomer.customerId": "联系人挂靠",
  "projectCustomer.customerId": "项目关联客户", "entDupeHit.customerId": "撞号记录",
  "contactMethod.contactId": "号码", "followUp.contactId": "沟通", "attachment.contactId": "名片 / 附件", "project.contactId": "项目主联系人",
  "entBlocker.contactId": "卡点", "projectContact.contactId": "项目联系人", "contactCustomer.contactId": "联系人挂靠", "entExternalRef.targetId": "同步对照",
  position: "职位", gender: "性别", birthday: "生日", hobby: "爱好", address: "地址", remark: "备注", phone: "电话", email: "邮箱", wechat: "微信",
};
export const 类叫 = (键: string) => 类叫法[键] ?? 键;

/** 「留」空着、「并」有值时补上的格（只补空）；号码三格另算 */
const 补空格 = ["position", "gender", "birthday", "hobby", "address", "remark"] as const;
/** 老号码列：「留」空的用「并」的补；「并」身上的一律清空（免得回收站查号撞上「并」、查重捞回把他捞回来） */
const 号码格 = ["phone", "email", "wechat"] as const;

export type 合成明细 = {
  版本: 1;
  并于: string;
  /** 表.列 → 从「并」改指「留」的行 id */
  改指: Record<string, string[]>;
  /** 去重删掉的整行，撤回时建回 */
  删掉: { contactMethod: Record<string, unknown>[]; projectContact: Record<string, unknown>[]; contactCustomer: Record<string, unknown>[] };
  补空: Record<string, string>;
  并原号: Record<string, string>;
  /** 「并」原来是关键联系人：去掉了它的关键标；留 = 「留」接过了关键标 */
  关键: { 并: boolean; 留: boolean };
};

const 改指项 = [
  ["contactMethod", "contactId"], ["followUp", "contactId"], ["attachment", "contactId"], ["project", "contactId"],
  ["entBlocker", "contactId"], ["projectContact", "contactId"], ["contactCustomer", "contactId"],
] as const;

type 通用表 = {
  findMany(a: { where: object; select?: object }): Promise<Record<string, unknown>[]>;
  updateMany(a: { where: object; data: object }): Promise<{ count: number }>;
};
const 表 = (tx: Tx, t: string) => (tx as unknown as Record<string, 通用表>)[t];
const 有值 = (v: unknown) => v !== null && v !== undefined && v !== "";

export type 联系人一位 = { id: string; name: string; customerId: string; isPrimary: boolean; deletedAt: Date | null };

/** 合成一对：调用方已判过权限、两位都在同一位客户名下、都没删。返回明细（存进合成单） */
export async function 合成一对(tx: Tx, 留: 联系人一位, 并: 联系人一位, 现在: Date): Promise<合成明细> {
  const 明: 合成明细 = { 版本: 1, 并于: 现在.toISOString(), 改指: {}, 删掉: { contactMethod: [], projectContact: [], contactCustomer: [] }, 补空: {}, 并原号: {}, 关键: { 并: false, 留: false } };

  // 号码：规整值相同的删「并」那行（整行记下），其余改挂「留」
  const 留号 = new Set((await tx.contactMethod.findMany({ where: { contactId: 留.id }, select: { kind: true, numberKey: true } })).map((m) => `${m.kind}|${m.numberKey}`));
  const 并号 = await tx.contactMethod.findMany({ where: { contactId: 并.id } });
  const 重号 = 并号.filter((m) => 留号.has(`${m.kind}|${m.numberKey}`));
  if (重号.length) await tx.contactMethod.deleteMany({ where: { id: { in: 重号.map((m) => m.id) } } });
  明.删掉.contactMethod = 重号;

  // 项目联系人、挂靠：同一项目 / 同一客户两位都挂着的，删「并」那行
  const 留项目 = new Set((await tx.projectContact.findMany({ where: { contactId: 留.id }, select: { projectId: true } })).map((x) => x.projectId));
  const 项目重 = (await tx.projectContact.findMany({ where: { contactId: 并.id } })).filter((x) => 留项目.has(x.projectId));
  if (项目重.length) await tx.projectContact.deleteMany({ where: { id: { in: 项目重.map((x) => x.id) } } });
  明.删掉.projectContact = 项目重;
  const 留挂 = new Set((await tx.contactCustomer.findMany({ where: { contactId: 留.id }, select: { customerId: true } })).map((x) => x.customerId));
  const 挂重 = (await tx.contactCustomer.findMany({ where: { contactId: 并.id } })).filter((x) => 留挂.has(x.customerId));
  if (挂重.length) await tx.contactCustomer.deleteMany({ where: { id: { in: 挂重.map((x) => x.id) } } });
  明.删掉.contactCustomer = 挂重;

  for (const [t, 列] of 改指项) {
    const ids = (await 表(tx, t).findMany({ where: { [列]: 并.id }, select: { id: true } })).map((r) => r.id as string);
    if (ids.length) await 表(tx, t).updateMany({ where: { id: { in: ids } }, data: { [列]: 留.id } });
    明.改指[`${t}.${列}`] = ids;
  }
  const 对照 = (await tx.entExternalRef.findMany({ where: { entity: "contact", targetId: 并.id }, select: { id: true } })).map((x) => x.id);
  if (对照.length) await tx.entExternalRef.updateMany({ where: { id: { in: 对照 } }, data: { targetId: 留.id } });
  明.改指["entExternalRef.targetId"] = 对照;

  // 只补空；老号码列「并」的清空
  const [现留, 现并] = await Promise.all([tx.contact.findUnique({ where: { id: 留.id } }), tx.contact.findUnique({ where: { id: 并.id } })]);
  const 留补: Record<string, string> = {};
  for (const k of [...补空格, ...号码格]) if (!有值(现留?.[k]) && 有值(现并?.[k])) 留补[k] = 现并![k] as string;
  for (const k of 号码格) if (有值(现并?.[k])) 明.并原号[k] = 现并![k] as string;
  明.补空 = 留补;
  明.关键 = { 并: 并.isPrimary, 留: 并.isPrimary && !留.isPrimary };
  await tx.contact.update({ where: { id: 留.id }, data: { ...留补, ...(明.关键.留 ? { isPrimary: true } : {}) } });
  await tx.contact.update({
    where: { id: 并.id },
    data: { ...Object.fromEntries(Object.keys(明.并原号).map((k) => [k, null])), isPrimary: false, deletedAt: 现在 },
  });
  return 明;
}

/** 拆开一对（撤回）：「并」从回收站回来，合成挪过去的还在「留」身上的挪回「并」 */
export async function 拆开一对(tx: Tx, 原文: string, 留id: string, 并id: string): Promise<没还原[]> {
  const 明 = JSON.parse(原文) as 合成明细;
  const 留: 没还原[] = [];
  const 并 = await tx.contact.findUnique({ where: { id: 并id }, select: { id: true, phone: true, email: true, wechat: true } });
  if (!并) return [{ 类: "联系人", id: 并id, 原因: "合成掉的那位已清出回收站，拆不回来" }];
  const 改过话 = "合成之后被改过（换了人或删了）";
  for (const [键, ids] of Object.entries(明.改指)) {
    if (!ids.length) continue;
    const [t, 列] = 键.split(".");
    await 表(tx, t).updateMany({ where: { id: { in: ids }, [列]: 留id }, data: { [列]: 并id } });
    const 回了 = new Set((await 表(tx, t).findMany({ where: { id: { in: ids }, [列]: 并id }, select: { id: true } })).map((r) => r.id as string));
    for (const id of ids.filter((id) => !回了.has(id))) 留.push({ 类: 类叫(键), id, 原因: 改过话 });
  }
  const 日期 = (r: Record<string, unknown>) => ({ ...r, ...(r.createdAt ? { createdAt: new Date(r.createdAt as string) } : {}) });
  for (const r of 明.删掉.contactMethod) {
    // 号码全公司唯一：这个号已经又挂到别人身上了就不建回
    const 撞 = await tx.contactMethod.count({ where: { kind: r.kind as string, numberKey: r.numberKey as string, NOT: { contactId: 留id } } });
    if (撞 || (await tx.contactMethod.findUnique({ where: { id: r.id as string } }))) { 留.push({ 类: "号码", id: r.id as string, 原因: "这个号之后又挂到了别处" }); continue; }
    if (await tx.customer.findUnique({ where: { id: r.customerId as string }, select: { id: true } })) await tx.contactMethod.create({ data: 日期(r) as Prisma.ContactMethodUncheckedCreateInput });
  }
  for (const r of 明.删掉.projectContact) {
    const 有 = await tx.projectContact.findFirst({ where: { projectId: r.projectId as string, contactId: 并id } });
    const 项 = await tx.project.findUnique({ where: { id: r.projectId as string }, select: { id: true } });
    if (!有 && 项) await tx.projectContact.create({ data: 日期(r) as Prisma.ProjectContactUncheckedCreateInput });
  }
  for (const r of 明.删掉.contactCustomer) {
    const 有 = await tx.contactCustomer.findFirst({ where: { contactId: 并id, customerId: r.customerId as string } });
    const 客 = await tx.customer.findUnique({ where: { id: r.customerId as string }, select: { id: true } });
    if (!有 && 客) await tx.contactCustomer.create({ data: 日期(r) as Prisma.ContactCustomerUncheckedCreateInput });
  }
  // 补空的格：还是补进去的值才清回空
  const 现留 = await tx.contact.findUnique({ where: { id: 留id } });
  if (现留) {
    const 清: Record<string, null> = {};
    for (const [k, v] of Object.entries(明.补空)) {
      if (现留[k as keyof typeof 现留] === v) 清[k] = null;
      else 留.push({ 类: "联系人资料", id: 类叫(k), 原因: "合成之后被改过，保留现在的值" });
    }
    await tx.contact.update({ where: { id: 留id }, data: { ...清, ...(明.关键.留 && 现留.isPrimary ? { isPrimary: false } : {}) } });
  }
  const 号回: Record<string, string> = {};
  for (const [k, v] of Object.entries(明.并原号)) if (!有值(并[k as keyof typeof 并])) 号回[k] = v;
  await tx.contact.update({ where: { id: 并id }, data: { ...号回, deletedAt: null, ...(明.关键.并 ? { isPrimary: true } : {}) } });
  // 「并」拿回关键标后，同一位客户只留一个关键：留那位让出来（关键是它合成时接过来的已在上面让了；原本就是关键的留着，并的不标）
  if (明.关键.并) {
    const c = await tx.contact.findUnique({ where: { id: 并id }, select: { customerId: true } });
    const 别的关键 = c ? await tx.contact.count({ where: { customerId: c.customerId, isPrimary: true, deletedAt: null, id: { not: 并id } } }) : 0;
    if (别的关键) await tx.contact.update({ where: { id: 并id }, data: { isPrimary: false } });
  }
  return 留;
}
