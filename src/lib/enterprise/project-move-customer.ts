/**
 * 企业版项目换客户（2026-11-25，客户 E-277 第一批「项目挂错了客户」；方案 docs/合并客户-第一批-落地.md 第七节）。
 *
 * 一个项目连沟通、附件、项目联系人整体挪到另一位客户：
 *   - Project.customerId 改成目标客户；负责人、组员、节点、阶段、结局、来源、回款、提成都不动（跟着项目 id 走）
 *   - 挂在这个项目上的沟通（FollowUpProject）所属客户改成目标客户，含回收站里的；附件挂项目 / 沟通，不用动
 *   - 卡点冗余的 customerId 改成目标客户；必填拦截记录照旧记当时的（同合并客户 2.3）
 *   - 项目联系人（主联系人 + ProjectContact）还是原客户的人：挂靠到目标客户（ContactCustomer），在目标客户页看得到；已挂着的不重复
 *   - 项目关联客户里本来就有目标客户的：那行删掉（目标客户成了主客户，主客户不在这张表里占行）
 *   - 重复咨询原始客户是原客户的：改指目标客户，有序号的接在目标客户已有最大号后面；查重领取建的序号空着、不占号，照旧空
 * 拦法同合并客户（E-277「拦法同合并」）：两家客户都是自己负责（能删客户的角色），没结束的项目负责人也是自己；系统管理员可代换。
 * 交接中、标了无效、业务线不同、一家在公海一家不在（先领）都拦；两家都在公海只有系统管理员能换；项目在离职交接里等接手人确认的也拦
 * （验证中的能换）。订单阶段、有回款的也能换，预览里列明。
 * 不单独撤回：换错了再换回去（E-277「超过 30 天用项目换客户一个个挪回」）。只有换完那 8 秒撤销条上的「撤销」是真的反向操作（撤销换客户）：
 * 按这次日志里记下的，挪回的沟通、卡点改回原客户，这次新建、之后没动过的挂靠删掉，删掉的项目关联客户（连身份）建回，重复咨询序号换回原值。
 * 操作日志项目、两位客户各一条。
 */
import type { PrismaClient, Prisma } from "@/generated/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 看已删 } from "./soft-delete-core";
import { 企业版 } from "./switch";
import { 权限组织, type 组织 } from "./org";
import { 能删除, 是系统管理员, 只读角色, 只看的人 } from "./permissions";
import { 交接中的客户, 离职交接中的项目 } from "./handover-db";
import { 跟着项目重算, 客户状态自动 } from "./cust-status-auto-db";
import { 存沟通后重算三态 } from "./tri-state-db";
import { notify } from "./notify";
import { 通知里的客户名 } from "./notice-mask";
import { 客户编号文字 } from "@/lib/customer-no";
import { 忘掉企业版范围 } from "./visibility";
import { 读客户, 重算最近跟进, 拦下, 合并事务选项, 并发失败话, 挂靠说明, type 客户行, type 合并人 } from "./customer-merge";

type 库 = PrismaClient;
type Tx = Prisma.TransactionClient;
type 结果<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export const 换客户通知种类 = "项目换客户";
export { 挂靠说明 };

const 项目列 = { id: true, name: true, customerId: true, ownerId: true, result: true, pooledAt: true, phase: true, contactId: true, repeatOfCustomerId: true, repeatSeq: true } satisfies Prisma.ProjectSelect;
type 项目行 = Prisma.ProjectGetPayload<{ select: typeof 项目列 }>;

const 名 = (c: 客户行) => 通知里的客户名(c);
const 有值 = (v: unknown) => v !== null && v !== undefined && v !== "";

async function 拦的原因(db: Tx | 库, p: 项目行 | null, 原: 客户行 | null, 目标: 客户行 | null, me: 合并人, org: 组织 | null): Promise<string[]> {
  if (!企业版()) return ["只有企业版能给项目换客户"];
  if (!p) return ["项目不存在或已删除，刷新看看"];
  if (!原 || !目标) return ["客户不存在或已删除，刷新看看"];
  if (原.id === 目标.id) return ["项目已经在这位客户名下，请选另一位客户"];
  if (!org || 只读角色(me, org) || 只看的人(org, me.id)) return ["你只能看，不能给项目换客户"];
  const 管 = 是系统管理员(me, org);
  const 因: string[] = [];
  if (!!原.pool !== !!目标.pool) 因.push(`「${名(原.pool ? 原 : 目标)}」在公海里，先领出来再换`);
  else if (原.pool && !管) 因.push("两位客户都在公海里，只有系统管理员能给项目换客户");
  if (!管 && !原.pool) {
    const 不是我的 = [原, 目标].filter((c) => !能删除(me, org, c.salesOwnerId));
    if (不是我的.length) 因.push(`${不是我的.map((c) => `「${名(c)}」`).join("")}不是你负责的，只能在两位都由你负责的客户之间换；要换请找系统管理员`);
    else if (!p.result && !p.pooledAt && p.ownerId && p.ownerId !== me.id) 因.push("这个项目是同事负责、还没结束，不能直接换客户；请找系统管理员");
  }
  const 交接 = await 交接中的客户([原.id, 目标.id], db as Tx);
  for (const c of [原, 目标]) if (交接.has(c.id)) 因.push(`「${名(c)}」正在转让交接中，等接手人确认或撤回交接后再换`);
  for (const c of [原, 目标]) if (c.poolInvalidAt) 因.push(`「${名(c)}」标了无效客户，先由系统管理员恢复再换`);
  if (有值(原.bizLine) && 有值(目标.bizLine) && 原.bizLine !== 目标.bizLine) 因.push(`两位客户业务线不同（${原.bizLine} / ${目标.bizLine}），不能换`);
  // 项目在离职交接里等接手人确认：确认时要按当时的客户和负责人分拣，换了客户会对不上（handover-db 离职交接中的项目）
  if ((await 离职交接中的项目([p], db as Tx)).has(p.id)) 因.push("这个项目正在离职交接中，等接手人确认或撤回交接后再换");
  return 因;
}

export type 换客户预览结果 = {
  能换: boolean;
  原因: string[];
  /** 确认框列明：订单阶段、回款几笔、挪几条沟通、几位项目联系人挂靠过去 */
  条数: { 沟通: number; 回款: number; 订单: boolean; 联系人: number } | null;
};

async function 项目联系人们(db: Tx | 库, p: 项目行): Promise<string[]> {
  const ids = (await db.projectContact.findMany({ where: { projectId: p.id }, select: { contactId: true } })).map((x) => x.contactId);
  return [...new Set([...(p.contactId ? [p.contactId] : []), ...ids])];
}

export async function 项目换客户预览(db: 库, projectId: string, 目标id: string, me: 合并人): Promise<换客户预览结果> {
  const org = await 权限组织();
  const p = await 看全部(() => db.project.findFirst({ where: { id: projectId, deletedAt: null }, select: 项目列 }));
  const [原, 目标] = await Promise.all([p ? 读客户(db, p.customerId) : null, 读客户(db, 目标id)]);
  const 原因 = await 拦的原因(db, p, 原, 目标, me, org);
  if (原因.length || !p) return { 能换: false, 原因, 条数: null };
  const [沟通, 回款, 人们] = await 看全部(() => Promise.all([
    db.followUp.count({ where: { deletedAt: null, projectNode: { projectId: p.id } } }),
    db.entProjectPayment.count({ where: { projectId: p.id } }),
    项目联系人们(db, p),
  ]));
  return { 能换: true, 原因: [], 条数: { 沟通, 回款, 订单: p.phase === "订单", 联系人: 人们.length } };
}

export type 换完 = { 沟通: number; 挂靠: number; /** 项目上那条换客户日志的 id：撤销条拿它调 撤销换客户 */ logId: string };

export async function 项目换客户(db: 库, projectId: string, 目标id: string, me: 合并人, 现在: Date = new Date()): Promise<结果<换完>> {
  const org = await 权限组织();
  const 开 = await 客户状态自动();
  let 通知要: { p: 项目行; 原: 客户行; 目标: 客户行 } | null = null;
  let r: 换完;
  try {
    r = await 看已删(() =>
      看全部(() =>
        db.$transaction(async (tx) => {
          const p = await tx.project.findFirst({ where: { id: projectId, deletedAt: null }, select: 项目列 });
          const [原, 目标] = [p ? await 读客户(tx, p.customerId) : null, await 读客户(tx, 目标id)];
          const 原因 = await 拦的原因(tx, p, 原, 目标, me, org);
          if (原因.length) throw new 拦下(原因.join("；"));
          const 结 = await 挪项目(tx, p!, 原!, 目标!, me, 现在);
          await 重算最近跟进(tx, 原!.id);
          await 重算最近跟进(tx, 目标!.id);
          await 跟着项目重算(tx, 开, [原!.id, 目标!.id]);
          通知要 = { p: p!, 原: 原!, 目标: 目标! };
          return 结;
        }, 合并事务选项),
      ),
    );
  } catch (e) {
    if (e instanceof 拦下) return { ok: false, error: e.message };
    const 话 = 并发失败话(e);
    if (话) return { ok: false, error: 话 };
    throw e;
  }
  忘掉企业版范围();
  const 要 = 通知要 as { p: 项目行; 原: 客户行; 目标: 客户行 } | null;
  if (要) {
    await 存沟通后重算三态([要.原.id, 要.目标.id], 现在).catch((e) => console.warn("[项目换客户] 三态没重算上：", e instanceof Error ? e.message : e));
    // 系统管理员代换时：项目负责人、两位客户负责人不是操作人本人的各一条（同合并客户第六节第 3 条，我方加的）
    await notify([要.p.ownerId, 要.原.salesOwnerId, 要.目标.salesOwnerId].filter((u) => u && u !== me.id), {
      kind: 换客户通知种类,
      title: `项目「${要.p.name}」换到了「${名(要.目标)}」`,
      body: `${me.name}把项目「${要.p.name}」从「${名(要.原)}」${客户编号文字(要.原.customerNo) ?? ""}换到了「${名(要.目标)}」${客户编号文字(要.目标.customerNo) ?? ""}，沟通、附件、项目联系人跟着项目走，负责人不变。`,
      link: `/customers/${要.目标.id}?project=${要.p.id}`,
      key: `project-move:${要.p.id}:${要.目标.id}:${Date.now()}`,
    });
  }
  return { ok: true, ...r! };
}

/** 换客户日志里记的（撤销换客户照它反着做；老日志只有前五样，撤销不认） */
type 换客户明细 = {
  projectId: string; 从: string; 到: string; 沟通: number;
  /** 挂靠过去的联系人 id */
  挂靠: string[];
  版本?: 2;
  /** 这次新建的挂靠行 id */
  挂靠行?: string[];
  /** 这次改指的沟通、卡点 id */
  沟通们?: string[];
  卡点们?: string[];
  /** 项目关联客户里本来就有目标客户的那行（连身份），整行 */
  删掉关联?: Record<string, unknown>[];
  /** 重复咨询原始客户、序号的原值和新值 */
  重复?: { 原客户: string; 原序: number | null; 新序: number | null };
};

async function 挪项目(tx: Tx, p: 项目行, 原: 客户行, 目标: 客户行, me: 合并人, 现在: Date): Promise<换完> {
  await tx.project.update({ where: { id: p.id }, data: { customerId: 目标.id } });
  // 重复咨询：原始客户是原客户的改指目标客户，有序号的接在后面；查重领取建的序号空着、不占号（只出口 C 记号，8bb2bffa）
  let 重复: 换客户明细["重复"];
  if (p.repeatOfCustomerId === 原.id) {
    const 新序 = p.repeatSeq == null ? null : ((await tx.project.aggregate({ where: { repeatOfCustomerId: 目标.id }, _max: { repeatSeq: true } }))._max.repeatSeq ?? 0) + 1;
    await tx.project.update({ where: { id: p.id }, data: { repeatOfCustomerId: 目标.id, ...(新序 === null ? {} : { repeatSeq: 新序 }) } });
    重复 = { 原客户: 原.id, 原序: p.repeatSeq, 新序 };
  }
  const 挂的沟通 = (await tx.followUpProject.findMany({ where: { projectId: p.id }, select: { followUpId: true } })).map((x) => x.followUpId);
  const 沟通们 = 挂的沟通.length ? (await tx.followUp.findMany({ where: { id: { in: 挂的沟通 }, customerId: 原.id }, select: { id: true } })).map((x) => x.id) : [];
  if (沟通们.length) await tx.followUp.updateMany({ where: { id: { in: 沟通们 } }, data: { customerId: 目标.id } });
  const 沟通 = 沟通们.length;
  const 卡点们 = (await tx.entBlocker.findMany({ where: { projectId: p.id, customerId: 原.id }, select: { id: true } })).map((x) => x.id);
  if (卡点们.length) await tx.entBlocker.updateMany({ where: { id: { in: 卡点们 } }, data: { customerId: 目标.id } });
  const 删掉关联 = await tx.projectCustomer.findMany({ where: { projectId: p.id, customerId: 目标.id } });
  if (删掉关联.length) await tx.projectCustomer.deleteMany({ where: { id: { in: 删掉关联.map((x) => x.id) } } });
  // 项目联系人挂靠到目标客户（主客户就是目标客户的、已挂着的跳过）
  const 人们 = await 项目联系人们(tx, p);
  const 已在 = new Set([
    ...(await tx.contactCustomer.findMany({ where: { customerId: 目标.id, contactId: { in: 人们 } }, select: { contactId: true } })).map((x) => x.contactId),
    ...(await tx.contact.findMany({ where: { id: { in: 人们 }, customerId: 目标.id }, select: { id: true } })).map((x) => x.id),
  ]);
  const 要挂 = 人们.filter((id) => !已在.has(id));
  const 挂靠行 = 要挂.length ? (await tx.contactCustomer.createManyAndReturn({ data: 要挂.map((contactId) => ({ contactId, customerId: 目标.id, note: 挂靠说明 })), select: { id: true } })).map((x) => x.id) : [];
  const 话 = `项目换客户：「${p.name}」从「${名(原)}」${客户编号文字(原.customerNo) ?? ""}换到「${名(目标)}」${客户编号文字(目标.customerNo) ?? ""}（${沟通} 条沟通${要挂.length ? `，${要挂.length} 位项目联系人挂靠过去` : ""}）`;
  const 明: 换客户明细 = { projectId: p.id, 从: 原.id, 到: 目标.id, 沟通, 挂靠: 要挂, 版本: 2, 挂靠行, 沟通们, 卡点们, 删掉关联, ...(重复 ? { 重复 } : {}) };
  const detail = JSON.stringify(明);
  const 项目日志 = await tx.auditLog.create({ data: { userId: me.id, userName: me.name, action: 换客户动作, entity: "Project", entityId: p.id, at: 现在, summary: 话, detail }, select: { id: true } });
  await tx.auditLog.createMany({
    data: [
      { userId: me.id, userName: me.name, action: 换客户动作, entity: "Customer", entityId: 原.id, at: 现在, summary: 话, detail },
      { userId: me.id, userName: me.name, action: 换客户动作, entity: "Customer", entityId: 目标.id, at: 现在, summary: 话, detail },
    ],
  });
  return { 沟通, 挂靠: 要挂.length, logId: 项目日志.id };
}

export const 换客户动作 = "project-move-customer";
export const 撤销换客户动作 = "project-move-customer-undo";
/** 撤销换客户认多久：撤销条摆 8 秒，动作在路上、事务排队再留些余量 */
export const 撤销换客户秒 = 60;

/**
 * 撤销换客户（换完那 8 秒撤销条上的「撤销」）：只认这次换客户的那条项目日志——是撤销的人自己换的、还在时限内、
 * 之后这个项目没再换过客户、没撤销过；项目还在目标客户名下。照日志反着做：
 *   - 项目回原客户；挪过去的沟通、卡点还在目标客户名下的改回原客户
 *   - 这次新建的挂靠行还是那样（挂在目标客户、说明没改）的删掉
 *   - 删掉的项目关联客户整行建回（连身份）；重复咨询还是这次写的样子的，原始客户和序号换回原值
 * 拦法照换客户反着判一遍（交接中、无效、公海……）。换客户时收到通知的那批人（项目负责人、两位客户负责人，不是操作人本人的）
 * 各再收一条「撤销了」（系统管理员代换后撤销，审查第二单）
 */
export async function 撤销换客户(db: 库, logId: string, me: 合并人, 现在: Date = new Date()): Promise<结果> {
  if (!企业版()) return { ok: false, error: "只有企业版能给项目换客户" };
  const org = await 权限组织();
  const 开 = await 客户状态自动();
  let 两家: [string, string] | null = null;
  let 通知要: { p: 项目行; 原: 客户行; 现: 客户行 } | null = null;
  try {
    await 看已删(() =>
      看全部(() =>
        db.$transaction(async (tx) => {
          const 日志 = await tx.auditLog.findUnique({ where: { id: logId } });
          if (!日志 || 日志.action !== 换客户动作 || 日志.entity !== "Project" || !日志.entityId || !日志.detail) throw new 拦下("找不到这次换客户，刷新看看");
          if (日志.userId !== me.id) throw new 拦下("只能撤销自己刚做的换客户");
          if (现在.getTime() - 日志.at.getTime() > 撤销换客户秒 * 1000) throw new 拦下("已经过了撤销时间；要换回请再换一次客户");
          let 明: 换客户明细;
          try { 明 = JSON.parse(日志.detail) as 换客户明细; } catch { throw new 拦下("找不到这次换客户，刷新看看"); }
          if (明.版本 !== 2) throw new 拦下("这次换客户不能撤销；要换回请再换一次客户");
          const 最近 = await tx.auditLog.findFirst({ where: { entity: "Project", entityId: 日志.entityId, action: { in: [换客户动作, 撤销换客户动作] } }, orderBy: [{ at: "desc" }, { id: "desc" }], select: { id: true } });
          if (最近?.id !== 日志.id) throw new 拦下("这次换客户已经撤销过，或之后又换过客户；要换回请再换一次客户");
          const p = await tx.project.findFirst({ where: { id: 明.projectId, deletedAt: null }, select: 项目列 });
          if (p && p.customerId !== 明.到) throw new 拦下(刚被改过);
          const [现客户, 原客户] = [await 读客户(tx, 明.到), await 读客户(tx, 明.从)];
          const 原因 = await 拦的原因(tx, p, 现客户, 原客户, me, org);
          if (原因.length) throw new 拦下(原因.join("；"));
          await 反着挪(tx, p!, 明);
          const 话 = `撤销项目换客户：「${p!.name}」回到「${名(原客户!)}」${客户编号文字(原客户!.customerNo) ?? ""}`;
          const detail = JSON.stringify({ logId: 日志.id, projectId: p!.id, 从: 明.到, 到: 明.从 });
          await tx.auditLog.createMany({
            data: [p!.id, 明.从, 明.到].map((entityId, i) => ({ userId: me.id, userName: me.name, action: 撤销换客户动作, entity: i ? "Customer" : "Project", entityId, at: 现在, summary: 话, detail })),
          });
          await 重算最近跟进(tx, 明.从);
          await 重算最近跟进(tx, 明.到);
          await 跟着项目重算(tx, 开, [明.从, 明.到]);
          两家 = [明.从, 明.到];
          通知要 = { p: p!, 原: 原客户!, 现: 现客户! };
        }, 合并事务选项),
      ),
    );
  } catch (e) {
    if (e instanceof 拦下) return { ok: false, error: e.message };
    const 话 = 并发失败话(e);
    if (话) return { ok: false, error: 话 };
    throw e;
  }
  忘掉企业版范围();
  if (两家) await 存沟通后重算三态(两家, 现在).catch((e) => console.warn("[撤销换客户] 三态没重算上：", e instanceof Error ? e.message : e));
  const 要 = 通知要 as { p: 项目行; 原: 客户行; 现: 客户行 } | null;
  if (要) {
    await notify([要.p.ownerId, 要.原.salesOwnerId, 要.现.salesOwnerId].filter((u) => u && u !== me.id), {
      kind: 换客户通知种类,
      title: `撤销了：项目「${要.p.name}」回到「${名(要.原)}」`,
      body: `${me.name}撤销了刚才的项目换客户，项目「${要.p.name}」从「${名(要.现)}」回到了「${名(要.原)}」${客户编号文字(要.原.customerNo) ?? ""}，沟通、卡点跟着回去，负责人不变。`,
      link: `/customers/${要.原.id}?project=${要.p.id}`,
      key: `project-move-undo:${要.p.id}:${logId}`,
    });
  }
  return { ok: true };
}
const 刚被改过 = "这个项目刚被别人改过（已不在换去的那位客户名下），刷新看看";

async function 反着挪(tx: Tx, p: 项目行, 明: 换客户明细): Promise<void> {
  const { 从, 到 } = 明;
  const 重复 = 明.重复;
  const 重复还是 = !!重复 && p.repeatOfCustomerId === 到 && (p.repeatSeq ?? null) === 重复.新序;
  await tx.project.update({ where: { id: p.id }, data: { customerId: 从, ...(重复还是 ? { repeatOfCustomerId: 重复!.原客户, repeatSeq: 重复!.原序 } : {}) } });
  if (明.沟通们?.length) await tx.followUp.updateMany({ where: { id: { in: 明.沟通们 }, customerId: 到 }, data: { customerId: 从 } });
  if (明.卡点们?.length) await tx.entBlocker.updateMany({ where: { id: { in: 明.卡点们 }, customerId: 到 }, data: { customerId: 从 } });
  if (明.挂靠行?.length) await tx.contactCustomer.deleteMany({ where: { id: { in: 明.挂靠行 }, customerId: 到, note: 挂靠说明 } });
  for (const r of 明.删掉关联 ?? []) {
    const 有 = await tx.projectCustomer.findFirst({ where: { projectId: p.id, customerId: r.customerId as string }, select: { id: true } });
    if (有 || r.customerId === 从) continue;
    await tx.projectCustomer.create({ data: { ...r, createdAt: new Date(r.createdAt as string) } as Prisma.ProjectCustomerUncheckedCreateInput });
  }
}
