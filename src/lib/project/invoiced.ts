/**
 * 企业版项目「已开票」勾选（12-15 第三批 A 件；客户 E-331 行 6、E-335 行 22–26、E-337 行 10–11、E-363 四①②；判定稿 A 节）。
 *
 *   - 勾：系统管理员 + 设置「组织架构 → 可标已开票」名单里的人（permissions.ts 能标已开票，不新增角色）。记谁、何时（Project.invoicedById / invoicedAt）
 *   - 看得到的项目都能勾（E-373 ①）：别人名下的、别的团队的也行；看不到的回「不在了」。名单只限系统管理员和财务（E-373 ②，permissions.ts 能进开票名单），
 *     勾的时候按当下再判；名单收回后他之前勾的照旧在项目和历史里
 *   - 日志写清谁勾的、负责人是谁（E-373 ③）：项目详情那一格「变更记录」摆最近几条，负责人打开项目看得到
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
import { 视图写拦 } from "@/lib/enterprise/view-as";
import { 能标已开票, 取消已开票不给, type 谁 } from "@/lib/enterprise/permissions";
import { dayjs } from "@/lib/utils";
import { 看全部 } from "@/lib/team-scope";
import { prisma } from "@/lib/prisma";
import { 已开票撤回天数, 不能标已开票话, 不再是财务话, type 已开票格, type 已开票记录 } from "./invoiced-words";

export { 已开票撤回天数, 不能标已开票话, 不再是财务话, 名单只限财务话, 已开票不能合并, 已开票拦合并, type 已开票格, type 已开票记录 } from "./invoiced-words";

type 结果 = { ok: true; 变了: boolean } | { ok: false; error: string };

/** 操作日志的动作名：勾上 / 撤回（AuditTab 动作叫法、历史变更项目块都认这两个） */
export const 已开票动作 = "invoice";
export const 撤回已开票动作 = "invoice-undo";
export const 已开票动作们 = [已开票动作, 撤回已开票动作] as const;
/** 项目详情那一格「变更记录」摆几条 */
const 记录条数 = 3;


/** 勾的时刻写成「YYYY-MM-DD HH:mm」（按进程时区，生产是北京时间）：历史变更、操作日志摘要里用 */
const 时刻字 = (d: Date) => dayjs(d).format("YYYY-MM-DD HH:mm");

/**
 * 勾 / 取消「已开票」。权限、30 天都在这里判（服务端），界面灰着只是提示。
 * 看得到就能勾（E-373 ①）：事务里先按我的读范围找这个项目（看不到 = 「不在了」），找到了再在 看全部 里写——
 * 别人名下的、别的团队的、虚线下属的都勾得上。看全部 只放开范围：只读拦（只读管理员 / 销售教练）在限定层照旧拦，
 * 切换视图这里先显式拦一道（视图写拦，不靠限定层里那道），身份上 能标已开票 已把只读三类、只看某人的挡掉。
 * 改项目和写操作日志在同一个事务里：日志没写上整笔回滚（留痕是客户要的「进台账」，不能只改不记）
 */
export async function 勾已开票(me: 谁 & { name: string }, projectId: string, 勾: boolean, 现在: Date = new Date()): Promise<结果> {
  if (!企业版()) return { ok: false, error: "已开票只在企业版有" };
  await 视图写拦("Project.invoice");
  const org = await 权限组织();
  if (勾 && !能标已开票(me, org)) return { ok: false, error: org?.可标已开票?.has(me.id) ? 不再是财务话 : 不能标已开票话 };
  // 取消：身份先判（不是系统管理员的不读项目），30 天在事务里按库里勾的时刻再判
  const 身份不给 = 勾 ? null : 取消已开票不给(me, org, 现在, 现在, 已开票撤回天数);
  if (身份不给) return { ok: false, error: 身份不给 };
  return 查完再写(async (tx) => {
    // 按读范围找：看不到的（别的团队的、不相干的）和真删了的一样回「不在了」，不露出有这个项目
    const p = await tx.project.findUnique({ where: { id: String(projectId ?? "") }, select: { id: true, name: true, ownerId: true, invoiced: true, invoicedById: true, invoicedAt: true } });
    if (!p) return { ok: false as const, error: "这个项目已经不在了，刷新看看" };
    if (p.invoiced === 勾) return { ok: true as const, 变了: false };
    if (!勾) {
      const 不给 = 取消已开票不给(me, org, p.invoicedAt, 现在, 已开票撤回天数);
      if (不给) return { ok: false as const, error: 不给 };
    }
    return 看全部(async () => {
      // 条件更新：SQLite 写事务独占，到这里没人能插进来；改到 0 行（别处刚改成目标值）按「没变」回、不重复记日志
      const 改 = await tx.project.updateMany({
        where: { id: p.id, invoiced: !勾 },
        data: { invoiced: 勾, invoicedById: 勾 ? me.id : null, invoicedAt: 勾 ? 现在 : null },
      });
      if (!改.count) return { ok: true as const, 变了: false };
      const 名们 = new Map((await tx.user.findMany({ where: { id: { in: [p.ownerId, ...(!勾 && p.invoicedById ? [p.invoicedById] : [])] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
      const 负责人 = 名们.get(p.ownerId) ?? "已不在的成员";
      const 原勾的人 = !勾 && p.invoicedById ? 名们.get(p.invoicedById) ?? "已不在的成员" : null;
      // E-373 ③：写清谁勾的（userId / userName）、这个项目负责人是谁（摘要 + 明细 负责人）
      const 括 = [`负责人 ${负责人}`, ...(原勾的人 && p.invoicedAt ? [`原来 ${原勾的人} ${时刻字(p.invoicedAt)} 勾的`] : [])].join("；");
      await tx.auditLog.create({
        data: {
          userId: me.id, userName: me.name, action: 勾 ? 已开票动作 : 撤回已开票动作, entity: "Project", entityId: p.id, at: 现在,
          summary: `项目「${p.name}」${勾 ? "标为已开票" : "撤回已开票"}（${括}）`,
          detail: JSON.stringify(勾 ? { 已开票: true, 负责人: p.ownerId } : { 已开票: false, 负责人: p.ownerId, 原勾的人: p.invoicedById, 原勾的时刻: p.invoicedAt?.toISOString() ?? null }),
        },
      });
      return { ok: true as const, 变了: true };
    });
  });
}


/**
 * 项目详情 load.ts 用：org 由调用方传（同一次渲染已经读过）。调到这里说明这个项目我看得到（读项目详情 按读范围取的），
 * 看得到就能勾（E-373 ①），不再看写范围。记录：最近几条勾 / 撤回（谁、何时、负责人），负责人打开自己的项目就看得到别人勾的那条（E-373 ③）
 */
export async function 已开票格of(me: 谁, org: Parameters<typeof 能标已开票>[1], p: { id: string; invoiced: boolean; invoicedAt: Date | null }, 谁勾的: string | null, 现在: Date = new Date()): Promise<已开票格> {
  const 记录 = await 已开票最近记录(p.id);
  return {
    勾了: p.invoiced,
    谁: p.invoiced ? 谁勾的 : null,
    何时: p.invoiced && p.invoicedAt ? p.invoicedAt.toISOString() : null,
    能勾: 能标已开票(me, org),
    取消不给: p.invoiced ? 取消已开票不给(me, org, p.invoicedAt, 现在, 已开票撤回天数) : null,
    ...(记录.length ? { 记录 } : {}),
  };
}

/** 这个项目最近几条勾 / 撤回（新的在前）：只读这一个项目的操作日志，调用方已核过看得到这个项目 */
async function 已开票最近记录(projectId: string): Promise<已开票记录[]> {
  const 痕 = await 看全部(() => prisma.auditLog.findMany({
    where: { entity: "Project", entityId: projectId, action: { in: [...已开票动作们] } },
    orderBy: [{ at: "desc" }, { id: "desc" }], take: 记录条数, select: { id: true, at: true, userId: true, userName: true, action: true, detail: true },
  }));
  if (!痕.length) return [];
  const ids = new Set<string>();
  for (const a of 痕) for (const x of [a.userId, ...已开票明细人(a.detail)]) if (x) ids.add(x);
  const 名 = new Map((await 看全部(() => prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } }))).map((u) => [u.id, u.name]));
  const 叫 = (id: string | null) => (id ? 名.get(id) ?? null : null);
  return 痕.map((a) => {
    const { 文, 因 } = 已开票历史文(a, 叫);
    return { id: a.id, 何时: a.at.toISOString(), 谁: 叫(a.userId) ?? a.userName ?? "已不在的成员", 文, 因 };
  });
}

/** 勾 / 撤回那条明细里记的人（负责人、原勾的人）：要一起查名字（history-data.ts 历史变更也用） */
export function 已开票明细人(detail: string | null): string[] {
  try {
    const v: unknown = detail ? JSON.parse(detail) : null;
    if (!v || typeof v !== "object") return [];
    const o = v as { 负责人?: unknown; 原勾的人?: unknown };
    return [o.负责人, o.原勾的人].filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

/** 历史变更项目块那一行的文字（history-data.ts、项目详情变更记录用）：勾上 / 撤回；因 = 负责人（E-373 ③，老记录没记就不写）、撤回带原来谁何时勾的 */
export function 已开票历史文(a: { action: string; detail: string | null }, 叫: (id: string | null) => string | null): { 文: string; 因: string[] } {
  let 原: { 负责人?: string | null; 原勾的人?: string | null; 原勾的时刻?: string | null } = {};
  try { 原 = a.detail ? JSON.parse(a.detail) : {}; } catch { /* 明细坏了只写动作 */ }
  const 负责 = typeof 原.负责人 === "string" ? [`负责人 ${叫(原.负责人) ?? "已不在的成员"}`] : [];
  if (a.action === 已开票动作) return { 文: "标为已开票", 因: 负责 };
  const 人 = 原.原勾的人 ? 叫(原.原勾的人) ?? "已不在的成员" : null;
  return { 文: "撤回已开票", 因: [...负责, ...(人 && 原.原勾的时刻 ? [`原来 ${人} ${时刻字(new Date(原.原勾的时刻))} 勾的`] : [])] };
}
