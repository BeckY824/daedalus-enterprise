/**
 * 企业版项目「已开票」勾选（12-15 第三批 A 件；客户 E-331 行 6、E-335 行 22–26、E-337 行 10–11、E-363 四①②；判定稿 A 节）。
 *
 *   - 勾：系统管理员 + 设置「组织架构 → 可标已开票」名单里的人（permissions.ts 能标已开票，不新增角色）。记谁、何时（Project.invoicedById / invoicedAt）
 *   - 取消：勾后 30 天内只有系统管理员能撤回，过了 30 天谁都不能改（permissions.ts 取消已开票不给）。取消后能重新勾，重新起算
 *   - 留痕：勾、取消各写一条操作日志（AuditLog entity Project，action 已开票动作 / 撤回已开票动作），和改项目同一个事务；
 *     客户详情「历史变更」项目块按这两种动作列（customers/[id]/history-data.ts），不另建表
 *   - 勾了就不能做项目合并：两边任一勾了都拦（已开票拦合并），和「已签合同」同一处（project-merge.ts 阶段和钱拦）。客户合并不并项目，不受影响
 *   - 合并确认框里「两个项目都未开票」那条自查照留（E-363 四①：勾了直接拦，没勾的照旧要自查）；老项目不批量补勾
 *   - AI 只能查（agent/query.ts 项目.已开票），不能代勾；导入不开这一列；不做批量勾
 */
import { 查完再写 } from "@/lib/check-then-write";
import { 企业版 } from "@/lib/enterprise/switch";
import { 权限组织 } from "@/lib/enterprise/org";
import { 能标已开票, 取消已开票不给, type 谁 } from "@/lib/enterprise/permissions";
import { dayjs } from "@/lib/utils";

type 结果 = { ok: true; 变了: boolean } | { ok: false; error: string };

/** 撤回期限（E-363 四②「30 天内误勾只有系统管理员能撤回，过 30 天谁都不能改」） */
export const 已开票撤回天数 = 30;
/** 操作日志的动作名：勾上 / 撤回（AuditTab 动作叫法、历史变更项目块都认这两个） */
export const 已开票动作 = "invoice";
export const 撤回已开票动作 = "invoice-undo";
export const 已开票动作们 = [已开票动作, 撤回已开票动作] as const;

/** 不能勾的那一句（能标已开票 为假时） */
export const 不能标已开票话 = "只有系统管理员或被指定「可标已开票」的人能勾";
/** 项目合并拦话：「X」已开票，不能合并（和「已签合同，不能合并」同一个说法） */
export const 已开票不能合并 = (名: string) => `「${名 || "未命名项目"}」已开票，不能合并`;
/** 项目合并用：两边任一勾了都拦，回拦话（空 = 不拦）。project-merge.ts 阶段和钱拦 里和已签合同并列调 */
export function 已开票拦合并(p: { name: string; invoiced?: boolean | null }): string[] {
  return p.invoiced ? [已开票不能合并(p.name)] : [];
}

/** 勾的时刻写成「YYYY-MM-DD HH:mm」（按进程时区，生产是北京时间）：历史变更、操作日志摘要里用 */
const 时刻字 = (d: Date) => dayjs(d).format("YYYY-MM-DD HH:mm");

/**
 * 勾 / 取消「已开票」。权限、30 天都在这里判（服务端），界面灰着只是提示。
 * 改项目和写操作日志在同一个事务里：日志没写上整笔回滚（留痕是客户要的「进台账」，不能只改不记）
 */
export async function 勾已开票(me: 谁 & { name: string }, projectId: string, 勾: boolean, 现在: Date = new Date()): Promise<结果> {
  if (!企业版()) return { ok: false, error: "已开票只在企业版有" };
  const org = await 权限组织();
  if (勾 && !能标已开票(me, org)) return { ok: false, error: 不能标已开票话 };
  // 取消：身份先判（不是系统管理员的不读项目），30 天在事务里按库里勾的时刻再判
  const 身份不给 = 勾 ? null : 取消已开票不给(me, org, 现在, 现在, 已开票撤回天数);
  if (身份不给) return { ok: false, error: 身份不给 };
  return 查完再写(async (tx) => {
    const p = await tx.project.findUnique({ where: { id: String(projectId ?? "") }, select: { id: true, name: true, invoiced: true, invoicedById: true, invoicedAt: true } });
    if (!p) return { ok: false as const, error: "这个项目已经不在了，刷新看看" };
    if (p.invoiced === 勾) return { ok: true as const, 变了: false };
    if (!勾) {
      const 不给 = 取消已开票不给(me, org, p.invoicedAt, 现在, 已开票撤回天数);
      if (不给) return { ok: false as const, error: 不给 };
    }
    // 条件更新：两个人同时点，后到的那下改到 0 行，按「没变」回（不重复记日志）
    const 改 = await tx.project.updateMany({
      where: { id: p.id, invoiced: !勾 },
      data: { invoiced: 勾, invoicedById: 勾 ? me.id : null, invoicedAt: 勾 ? 现在 : null },
    });
    if (!改.count) return { ok: true as const, 变了: false };
    const 原勾的人 = !勾 && p.invoicedById ? (await tx.user.findUnique({ where: { id: p.invoicedById }, select: { name: true } }))?.name ?? "已不在的成员" : null;
    await tx.auditLog.create({
      data: {
        userId: me.id, userName: me.name, action: 勾 ? 已开票动作 : 撤回已开票动作, entity: "Project", entityId: p.id, at: 现在,
        summary: 勾 ? `项目「${p.name}」标为已开票` : `项目「${p.name}」撤回已开票${原勾的人 && p.invoicedAt ? `（原来 ${原勾的人} ${时刻字(p.invoicedAt)} 勾的）` : ""}`,
        detail: JSON.stringify(勾 ? { 已开票: true } : { 已开票: false, 原勾的人: p.invoicedById, 原勾的时刻: p.invoicedAt?.toISOString() ?? null }),
      },
    });
    return { ok: true as const, 变了: true };
  });
}

/** 项目详情要的那一格：勾没勾、谁何时、我能不能勾、能不能取消（不能 = 那一句，悬停写） */
export type 已开票格 = { 勾了: boolean; 谁: string | null; 何时: string | null; 能勾: boolean; 取消不给: string | null };

/** 项目详情 load.ts 用：org 由调用方传（同一次渲染已经读过） */
export function 已开票格of(me: 谁, org: Parameters<typeof 能标已开票>[1], p: { invoiced: boolean; invoicedAt: Date | null }, 谁勾的: string | null, 现在: Date = new Date()): 已开票格 {
  return {
    勾了: p.invoiced,
    谁: p.invoiced ? 谁勾的 : null,
    何时: p.invoiced && p.invoicedAt ? p.invoicedAt.toISOString() : null,
    能勾: 能标已开票(me, org),
    取消不给: p.invoiced ? 取消已开票不给(me, org, p.invoicedAt, 现在, 已开票撤回天数) : null,
  };
}

/** 历史变更项目块那一行的文字（history-data.ts 用）：勾上 / 撤回，撤回带原来谁何时勾的 */
export function 已开票历史文(a: { action: string; detail: string | null }, 叫: (id: string | null) => string | null): { 文: string; 因: string[] } {
  if (a.action === 已开票动作) return { 文: "标为已开票", 因: [] };
  let 原: { 原勾的人?: string | null; 原勾的时刻?: string | null } = {};
  try { 原 = a.detail ? JSON.parse(a.detail) : {}; } catch { /* 明细坏了只写动作 */ }
  const 人 = 原.原勾的人 ? 叫(原.原勾的人) ?? "已不在的成员" : null;
  return { 文: "撤回已开票", 因: 人 && 原.原勾的时刻 ? [`原来 ${人} ${时刻字(new Date(原.原勾的时刻))} 勾的`] : [] };
}

