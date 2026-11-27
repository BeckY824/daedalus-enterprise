/**
 * 客户详情「历史变更」（11-24，用户审过原型 原型-历史变更-20261124.html、入口用小方框）：只读、不写库。
 *
 *   - 摘要（入口小方框上的「N · 最近」）：页面首屏一句 SQL（几张留痕表 UNION ALL 数条数、取最近时刻），不取明细
 *   - 客户块：建档一格 + 按时间倒序的变更（负责人、进出公海、三态状态、资料修改、同号再次录入），系统批量修正同一天同一批折一行
 *   - 项目块：我看得到的每个项目一节，建档一格 + 节点 / 转让 / 公海 / 领取（ProjectNodeLog 全部 kind）、线索验证每一步、卡点流转
 *
 * 权限都在服务端判：客户块跟客户详情同一道（限定层 findUnique 看得到这位客户）；项目块按项目可见（project-zone.ts 客户页项目列表 + 能看的项目，
 * 和客户详情项目页签同一份名单），看不到的同事在推项目只回个数（和项目区锁数同一个函数，P-看-12），名字、变更都不出。
 * 号码：回包里的文字都过 号码脱敏器（电话设成「藏」的角色、销售教练打码，同客户详情别处）——资料修改里电话类字段的原值 / 新值整格打，
 * 说明、批量说明、理由里像手机 / 座机的串按 notice-mask.ts 的认法替换。
 * 查询数固定（每页每个来源一句，人名一句；状态留痕筛掉「没变不记」后不够一页才往前接着取），按 (时刻, id) 游标翻页，每页 30 条，大客户上千条也不一次取完
 */
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/auth";
import { 看全部 } from "@/lib/team-scope";
import { 看已删 } from "@/lib/enterprise/soft-delete-core";
import { 合并挪来的换人记录 } from "@/lib/enterprise/merge-moved-logs";
import { 读组织 } from "@/lib/enterprise/org";
import { 留痕说法, 能看理由 } from "@/lib/enterprise/tri-state-detail";
import { 三态开着 } from "@/lib/enterprise/tri-state-db";
import { 进公海理由显示 } from "@/lib/enterprise/tri-state-label";
import { 同号标题 } from "@/lib/enterprise/same-number-mark";
import { 批量批次, 批量说明, 折批量 } from "@/lib/enterprise/history-batch";
import { 换负责人怎么来的, 转让留痕一句 } from "@/lib/owner-log";
import { 无负责人占位名 } from "@/lib/pool";
import { 人名显示, 历史分析来源, 补建创建人, 补建批次, 来源字 } from "@/lib/project/system-created";
import { 超时理由 } from "@/lib/project/timeout";
import { 位置文字, 换人文字 } from "@/lib/project/node-log-text";
import { 字典of, 显示节点名 } from "@/lib/project/stage-dict";
import { 后售项目们 } from "@/lib/project/after-sale";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 企业版字典, 本套位置 } from "@/lib/project/nodes";
import { 节点字 } from "@/lib/project/customer-list-projects";
import { 动作叫法 } from "@/lib/project/blocker-rules";
import { 逐个号码, 号码数字 } from "@/lib/enterprise/notice-mask";
import { 认放回 } from "../../projects/[id]/load";
import { 客户页项目列表, 能看的项目, 看不到的在推数 } from "./project-zone";
import { 历史每页, type 历史筛选, type 历史事件, type 历史行, type 历史游标, type 建档格, type 历史页, type 项目概要, type 历史摘要 } from "./history-types";

/** 首页对话（AI）新建线索时首条沟通的开头（dashboard/apply.ts 建成项目 写的那句）：客户建档入口认「AI 建档」靠它 */
export const AI建档首条开头 = "在首页对话里新建的线索";
/** 出口 C 重复咨询建的项目（Project.source，重复咨询那一套写的值） */
export const 重复咨询来源 = "repeat-inquiry";

/**
 * 「没写理由」认哪些空白：半角空格、Tab、换行、回车、不换行空格、全角空格。JS（状态记不记）和 SQL（状态记SQL 的 TRIM 第二参数）用同一组，
 * 不用 JS 的 trim()（它认的空白比 SQLite TRIM 多，两边数出来会差）
 */
const 理由空白码 = [32, 9, 10, 13, 160, 12288] as const;
const 只有空白 = new RegExp(`^[${理由空白码.map((c) => `\\u${c.toString(16).padStart(4, "0")}`).join("")}]*$`);

/**
 * 三态状态留痕记不记：钟按事实重算、状态没变、也没写因为什么（via 自动、from = to、没有理由）的不记（原型「状态重算了但没变的不记」）。
 * 同一状态但有事的照记：继续持有、暂缓回收、让同事结束项目、撤销转让（人点的，via 不是自动）；被挡、解除、待交接（系统写了理由）
 */
export function 状态记不记(r: { fromState: string | null; toState: string; via: string; reason: string | null }): boolean {
  return !(r.fromState !== null && r.fromState === r.toState && r.via === "自动" && 只有空白.test(r.reason ?? ""));
}
/** 同一条规矩的 SQL 版（摘要那一句数条数用；表别名 s）。改了上面要一起改，tests/ent-history-changes.test.ts 两边对着数 */
const 状态记SQL = `NOT (s."fromState" IS NOT NULL AND s."fromState" = s."toState" AND s."via" = '自动' AND TRIM(COALESCE(s."reason", ''), char(${理由空白码.join(", ")})) = '')`;

/* ============================ 号码打码 ============================ */

/** 号码脱敏器 回的那个函数（电话没设「藏」= 原样返回） */
export type 号码器 = <T extends string | null>(p: T) => T;
/** 资料修改里哪些字段是号码：原值、新值整格过 号码脱敏器（同 utils.ts 文字里号码打码 的电话格名，加传真） */
const 号码字段 = /电话|手机|号码|传真|phone|mobile|tel|whatsapp|fax/i;

/** 文字里像手机 / 座机的串（notice-mask.ts 的认法）交给 号码脱敏器；一个都没换的原样回（不动全角数字） */
function 文字打码(s: string, 号: 号码器): string {
  if (!s || !/\d|[０-９]/.test(s)) return s;
  let 换了 = false;
  const 出 = 逐个号码(s, (m) => {
    const 数字 = 号码数字(m);
    const 打 = 号(数字);
    if (打 === 数字) return m;
    换了 = true;
    return 打;
  });
  return 换了 ? 出 : s;
}

const 事件打码 = (e: 历史事件, 号: 号码器): 历史事件 => ({ ...e, 文: 文字打码(e.文, 号), 谁: 文字打码(e.谁, 号), 因: e.因.map((x) => 文字打码(x, 号)) });
const 建档打码 = (g: 建档格 | null, 号: 号码器): 建档格 | null => (g ? { ...g, 行们: g.行们.map((r) => ({ ...r, 值: 文字打码(r.值, 号) })) } : null);

/** 资料修改：界面写的是 [{字段, 原值, 新值}]，拆成「字段：原值 → 新值」几行；别的明细不拆。号码类字段的原值、新值整格过 号码脱敏器 */
function 改动行们(detail: string | null, 号: 号码器): string[] {
  if (!detail || detail[0] !== "[") return [];
  try {
    const v: unknown = JSON.parse(detail);
    if (!Array.isArray(v)) return [];
    return v.flatMap((x) => {
      if (!x || typeof x !== "object") return [];
      const o = x as Record<string, unknown>;
      if (typeof o.字段 !== "string") return [];
      // 明细里有的直接存了「（空）」字面量（资料修改留痕写入时就这么记），也算空、不打码
      const 值 = (v: unknown) => (v == null || v === "" || v === "（空）" ? "（空）" : 号码字段.test(o.字段 as string) ? 号(String(v)) : String(v));
      return [`${o.字段}：${值(o.原值)} → ${值(o.新值)}`];
    });
  } catch {
    return [];
  }
}
/** 「修改客户「X」：客户等级」去掉前面那段（弹窗本身就是这位客户的） */
const 去客户引 = (s: string) => s.replace(/^修改[^「：]{0,8}「[^」]*」：/, "");

type 游标条件 = { OR: ({ at: { lt: Date } } | { at: Date; id: { lt: string } })[] };
const 游标of = (before?: 历史游标 | null): 游标条件 | null =>
  before ? { OR: [{ at: { lt: new Date(before.at) } }, { at: new Date(before.at), id: { lt: before.id } }] } : null;
const 倒序 = [{ at: "desc" as const }, { id: "desc" as const }];
/** 新的在前；同一刻按 id 倒序（id 是 ASCII，和 SQLite BINARY 一致） */
const 比 = (a: { at: Date; id: string }, b: { at: Date; id: string }) => +b.at - +a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** 人名：一次查齐；system 叫「系统」，查不到叫「已不在的成员」，公海占位账号叫「无负责人」。原名 = 账号现在的名字原样（认批量用），查不到 null */
type 叫人 = ((id: string | null | undefined, 创建人?: boolean) => string | null) & { 原名: (id: string | null | undefined) => string | null };
async function 人名们(ids: Iterable<string | null | undefined>): Promise<叫人> {
  const 要 = [...new Set([...ids].filter((x): x is string => !!x))];
  const 名 = new Map(要.length ? (await 看全部(() => prisma.user.findMany({ where: { id: { in: 要 } }, select: { id: true, name: true } }))).map((u) => [u.id, u.name]) : []);
  const 叫 = (id: string | null | undefined, 创建人?: boolean) => {
    if (!id) return null;
    const n = 人名显示(id, 名, { 创建人, 不在: "已不在的成员" });
    return n === 无负责人占位名 ? "无负责人" : n;
  };
  return Object.assign(叫, { 原名: (id: string | null | undefined) => (id ? 名.get(id) ?? null : null) });
}

/** 来源行（合并排序、取一页前的样子）：at / id 排序用，做 = 拿到人名后变成事件；批 = 拿到人名后认是不是系统批量修正（要账号现名） */
type 原 = { at: Date; id: string; 批?: (叫: 叫人) => string | null; 做: (叫: 叫人) => 历史事件 | null; 人: (string | null)[] };

function 截一页(们: 原[]): { 页: 原[]; 更早: 历史游标 | null } {
  const 排 = [...们].sort(比);
  const 页 = 排.slice(0, 历史每页);
  const 末 = 页[页.length - 1];
  return { 页, 更早: 排.length > 历史每页 && 末 ? { at: 末.at.toISOString(), id: 末.id } : null };
}

async function 成行(页: 原[], 号: 号码器): Promise<历史行[]> {
  const 叫 = await 人名们(页.flatMap((r) => r.人));
  const 事件们 = 页.flatMap((r) => { const e = r.做(叫); return e ? [{ at: r.at, 批: r.批?.(叫) ?? null, e: 事件打码(e, 号) }] : []; });
  return 折批量(事件们, (x) => x.批).map((g) =>
    g.种 === "单" ? { 种: "事件" as const, 事件: g.行.e } : { 种: "批量" as const, 键: g.键, 说明: g.行们[0].e.文, 事件们: g.行们.map((x) => x.e) });
}

/* ============================ 摘要（页面首屏） ============================ */

/** 客户块数进来的审计动作：资料修改、标无效 / 恢复（和 客户历史页 的 审计动作 同一组） */
const 客户审计动作 = ["update", "pool-invalid", "pool-restore"] as const;


/**
 * 入口小方框上的数：我看得到的客户 + 项目变更条数（批量修正按条数算，弹窗里折起来）、最近一条的时刻。
 * 一句 SQL（几张留痕表 UNION ALL，各走 customerId / projectId 索引）。可看项目 = 客户详情页签那几个（页面已经算好）
 */
export async function 历史变更摘要(customerId: string, 可看项目: readonly string[]): Promise<历史摘要> {
  const ids = JSON.stringify(可看项目);
  // 审计动作名走参数、不写进 SQL 原文：原文里出现 update 这类词，切换视图 / 只读账号的守卫（view-as.ts 会写库的SQL）会当成写库拦掉
  // 三态关着不碰三态的表（同原来项目进程变更卡：关着不摆「客户状态」那段；tests/ent-cust-detail-queries.test.ts 锁着）
  const 状态 = await 三态开着();
  const rows = await 看全部(() => prisma.$queryRawUnsafe<{ part: string; n: bigint | number; t: bigint | number | null }[]>(
    `SELECT part, COUNT(*) AS n, MAX(at) AS t FROM (
       SELECT 'c' AS part, o."at" AS at FROM "CustomerOwnerLog" o WHERE o."customerId" = ?
       ${状态 ? `UNION ALL SELECT 'c', s."at" FROM "EntCustomerStateLog" s WHERE s."customerId" = ? AND ${状态记SQL}` : ""}
       UNION ALL SELECT 'c', a."at" FROM "AuditLog" a WHERE a."entity" = 'Customer' AND a."entityId" = ? AND a."action" IN (?, ?, ?)
       UNION ALL SELECT 'c', f."createdAt" FROM "FollowUp" f LEFT JOIN "FollowUpProject" fl ON fl."followUpId" = f."id"
         WHERE f."customerId" = ? AND f."deletedAt" IS NULL AND f."title" LIKE '${同号标题}%'
           AND (fl."projectId" IS NULL OR fl."projectId" IN (SELECT value FROM json_each(?))
                OR fl."projectId" IN (SELECT p."id" FROM "Project" p WHERE p."customerId" = ? AND p."deletedAt" IS NOT NULL))
       UNION ALL SELECT 'p', l."at" FROM "ProjectNodeLog" l WHERE l."projectId" IN (SELECT value FROM json_each(?))
       UNION ALL SELECT 'p', v."at" FROM "EntLeadVerifyLog" v WHERE v."projectId" IN (SELECT value FROM json_each(?))
       UNION ALL SELECT 'p', bl."at" FROM "EntBlockerLog" bl JOIN "EntBlocker" b ON b."id" = bl."blockerId" WHERE b."projectId" IN (SELECT value FROM json_each(?))
     ) GROUP BY part`,
    ...(状态 ? [customerId, customerId] : [customerId]), customerId, ...客户审计动作, customerId, ids, customerId, ids, ids, ids,
  ));
  const 取 = (k: string) => rows.find((r) => r.part === k);
  const 最近 = Math.max(...rows.map((r) => Number(r.t ?? 0)));
  return { 客户: Number(取("c")?.n ?? 0), 项目: Number(取("p")?.n ?? 0), 项目数: 可看项目.length, 最近: 最近 > 0 ? new Date(最近).toISOString() : null, 状态 };
}

/* ============================ 客户块 ============================ */

type 客户行 = { id: string; createdAt: Date; salesOwnerId: string; bizLine: string | null; touchpoint: string | null; channel: { name: string } | null };

/** 看得到这位客户就回客户行（同客户详情 findUnique 那道限定）；看不到回 null */
export async function 看得到的客户(customerId: string): Promise<客户行 | null> {
  return prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, createdAt: true, salesOwnerId: true, bizLine: true, touchpoint: true, channel: { select: { name: true } } },
  });
}

/** 客户建档那一格：库里有的才摆，没记的不摆（不造） */
async function 客户建档(c: 客户行): Promise<建档格> {
  const [建的人, 导入, 建档痕, AI首条, 换人们, 挪来] = await 看全部(() => Promise.all([
    prisma.customerCreator.findUnique({ where: { customerId: c.id }, select: { userId: true } }),
    prisma.entImportRow.findFirst({ where: { entity: "customer", targetId: c.id, kind: "create" }, select: { id: true } }),
    prisma.auditLog.findFirst({ where: { entity: "Customer", entityId: c.id, action: "create" }, orderBy: { at: "asc" }, select: { userId: true, userName: true, summary: true, detail: true } }),
    prisma.followUp.findFirst({ where: { customerId: c.id, content: { startsWith: AI建档首条开头 } }, select: { id: true } }),
    prisma.customerOwnerLog.findMany({ where: { customerId: c.id }, orderBy: [{ at: "asc" }, { id: "asc" }], select: { id: true, fromOwnerId: true } }),
    合并挪来的换人记录(prisma, [c.id]),
  ]));
  // 首任负责人只认这位客户自己的：合并挪来的（被并那家的）换人记录不算，被并那家建档早也不显示成它的首任（merge-moved-logs.ts）
  const 首条换人 = 换人们.find((r) => !挪来.has(r.id));
  const 首任id = 首条换人 ? 首条换人.fromOwnerId : c.salesOwnerId;
  const 叫 = await 人名们([建的人?.userId, 首任id, 建档痕?.userId]);
  // 显示名带全角括号的员工手建的：userName 就是他现在的名字，不按括号认成后台补录
  const 入口 = 导入 ? "导入" : 建档痕 && 批量批次(建档痕, 叫.原名(建档痕.userId)) ? "导入（后台补录）" : AI首条 ? "AI 建档" : 建档痕 ? "手建" : null;
  const 行们: 建档格["行们"] = [];
  const 建档人 = 叫(建的人?.userId);
  if (建档人) 行们.push({ 键: "建档人", 值: 建档人 });
  if (入口) 行们.push({ 键: "入口", 值: 入口 });
  if (c.channel?.name) 行们.push({ 键: "来源", 值: c.channel.name });
  if (c.touchpoint) 行们.push({ 键: "触点", 值: c.touchpoint });
  const 首任 = 叫(首任id);
  if (首任 && 首任 !== "无负责人") 行们.push({ 键: "首任负责人", 值: 首任 });
  return { 时间: c.createdAt.toISOString(), 行们 };
}

/** 状态留痕往前接着取时一次取几条（筛掉「没变不记」的以后不够一页才接着取） */
const 状态接着取 = 100;

/**
 * 状态留痕一页：「没变不记」的取回来就筛掉，筛完不够 要 条、库里还有更早的，就从这批最后一条往前接着取，直到够数或到底。
 * 这样合并排序后一页一定满 30 条或已到底，空页不会还出「更早的」
 */
async function 记的状态留痕(customerId: string, 游: 游标条件 | null, 要: number) {
  const 留: Awaited<ReturnType<typeof prisma.entCustomerStateLog.findMany>> = [];
  let 接 = 游;
  for (let 批大小 = 要; ; 批大小 = 状态接着取) {
    const 批 = await 看全部(() => prisma.entCustomerStateLog.findMany({ where: 接 ? { AND: [{ customerId }, 接] } : { customerId }, orderBy: 倒序, take: 批大小 }));
    留.push(...批.filter(状态记不记));
    const 末 = 批[批.length - 1];
    if (留.length >= 要 || 批.length < 批大小 || !末) return 留.slice(0, 要);
    接 = { OR: [{ at: { lt: 末.at } }, { at: 末.at, id: { lt: 末.id } }] };
  }
}

/**
 * 客户块一页。调用方先用 看得到的客户 确认看得到（客户详情同一道）。
 * 可看项目：同号再次录入挂在我看不到的项目上的不出（同客户页沟通记录，进了回收站的项目上的照出）。号 = 号码脱敏器（调用方按看的人取一次）
 */
export async function 客户历史页(me: SessionUser, c: 客户行, 筛: 历史筛选, 可看项目: readonly string[], 号: 号码器, before?: 历史游标 | null): Promise<历史页 & { 建档: 建档格 | null }> {
  const 游 = 游标of(before);
  const where = <T extends object>(w: T) => (游 ? { AND: [w, 游] } : w);
  const 要 = (k: 历史筛选) => 筛 === "全部" || 筛 === k;
  const 状态开 = 要("状态") && (await 三态开着());
  const 审计动作 = [...(要("资料修改") ? ["update"] : []), ...(要("负责人") ? ["pool-invalid", "pool-restore"] : [])];
  const take = 历史每页 + 1;
  const [换人, 状态, 审计, 同号, 建档] = await Promise.all([
    要("负责人") ? 看全部(() => prisma.customerOwnerLog.findMany({ where: where({ customerId: c.id }), orderBy: 倒序, take })) : [],
    状态开 ? 记的状态留痕(c.id, 游, take) : [],
    审计动作.length ? 看全部(() => prisma.auditLog.findMany({ where: where({ entity: "Customer", entityId: c.id, action: { in: 审计动作 } }), orderBy: 倒序, take })) : [],
    要("同号录入")
      ? 看全部(async () => {
          const 删了的 = (await 看已删(() => prisma.project.findMany({ where: { customerId: c.id, deletedAt: { not: null } }, select: { id: true } }))).map((p) => p.id);
          const 挂 = [...可看项目, ...删了的];
          return prisma.followUp.findMany({
            where: {
              AND: [
                { customerId: c.id, deletedAt: null, title: { startsWith: 同号标题 } },
                { OR: [{ projectNode: null }, ...(挂.length ? [{ projectNode: { projectId: { in: 挂 } } }] : [])] },
                ...(before ? [{ OR: [{ createdAt: { lt: new Date(before.at) } }, { createdAt: new Date(before.at), id: { lt: before.id } }] }] : []),
              ],
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }], take,
            select: { id: true, createdAt: true, ownerId: true, content: true },
          });
        })
      : [],
    before ? null : 客户建档(c),
  ]);
  // 三态理由原文（继续持有写的、裁决写的、代选）只给负责人本人、上级链、本线条线总管理、系统管理员（B1，同 tri-state-detail.ts）
  const 带理由 = 状态.length ? 能看理由(me, await 读组织(), c) : false;
  const 们: 原[] = [
    ...换人.map((r): 原 => ({
      at: r.at, id: r.id, 人: [r.userId, r.fromOwnerId, r.toOwnerId],
      做: (叫) => {
        const 从 = 叫(r.fromOwnerId) ?? "（没有）", 到 = 叫(r.toOwnerId) ?? "（没有）";
        const 公海 = r.kind === "pool-release" || r.kind === "claim" || r.kind === "pool-assign";
        const 文 = r.kind === "pool-release" ? `进客户公海（原负责人 ${从}）` : r.kind === "claim" ? `${到} 从公海领取` : r.kind === "pool-assign" ? `从公海分配给 ${到}` : `${从} → ${到}`;
        const 因 = 公海 ? (r.clockReset ? ["三态钟归零"] : []) : [`${换负责人怎么来的(r.kind)}${r.clockReset ? "，三态钟归零" : ""}`];
        // 12-22 逐项选：直接转时必填的原因、转的那一刻的最近一次跟进、重复咨询次数（库里有就摆一行，一行省略 + 悬停看全文）
        if (r.reason != null) 因.push(转让留痕一句({ 原因: r.reason, 最近跟进: r.lastFollowAt?.toISOString() ?? null, 重复咨询: r.repeatCount }));
        return { id: r.id, at: r.at.toISOString(), 标: 公海 ? "公海" : "负责人", 文, 谁: 叫(r.userId) ?? "已不在的成员", 因 };
      },
    })),
    ...状态.map((r): 原 => ({
      at: r.at, id: r.id, 人: [r.userId],
      做: (叫) => ({ id: r.id, at: r.at.toISOString(), 标: "状态", 文: 留痕说法(r, 带理由), 谁: 叫(r.userId) ?? "系统", 因: [] }),
    })),
    ...审计.map((r): 原 => {
      // 认批量要这条 userId 那个账号现在的名字（显示名本身带括号的员工不算脚本），所以等人名查齐了再认
      const 批 = (叫: 叫人) => (r.action === "update" ? 批量批次(r, 叫.原名(r.userId)) : null);
      return {
        at: r.at, id: r.id, 人: [r.userId], 批,
        做: (叫) => {
          if (r.action !== "update") return { id: r.id, at: r.at.toISOString(), 标: "公海", 文: 去客户引(r.summary), 谁: r.userName, 因: [] };
          if (批(叫)) return { id: r.id, at: r.at.toISOString(), 标: "资料修改", 文: 批量说明(r.summary), 谁: r.userName, 因: [] };
          const 行 = 改动行们(r.detail, 号);
          return { id: r.id, at: r.at.toISOString(), 标: "资料修改", 文: 行.length === 1 ? 行[0] : 去客户引(r.summary), 谁: r.userName, 因: 行.length > 1 ? 行 : [] };
        },
      };
    }),
    ...同号.map((r): 原 => ({
      at: r.createdAt, id: r.id, 人: [r.ownerId],
      做: (叫) => {
        const [头, ...余] = r.content.split("\n");
        return { id: r.id, at: r.createdAt.toISOString(), 标: "同号录入", 文: 头, 谁: 叫(r.ownerId) ?? "已不在的成员", 因: 余.filter((x) => x.startsWith("现有来源")) };
      },
    })),
  ];
  const { 页, 更早 } = 截一页(们);
  return { 建档: 建档打码(建档, 号), 行们: await 成行(页, 号), 更早 };
}

/* ============================ 项目块 ============================ */


/** 这位客户名下我能看的项目（和客户详情项目页签同一把尺：客户页项目列表 + 能看的项目） */
export async function 客户页可看项目(me: SessionUser, customerId: string) {
  const 列表 = await 客户页项目列表(me, customerId);
  const 能看 = await 能看的项目(me, 列表.map((p) => p.id));
  return 列表.filter((p) => 能看.has(p.id)).map((p) => 本套位置(p, 企业版字典));
}

/**
 * 项目页签：每个看得到的项目一节（名字、阶段节点、条数）；看不到的只给个数——只数同事在推的（P-看-12），
 * 和客户详情项目区的锁数同一个函数（project-zone.ts 看不到的在推数），结束了的、公海里的不数
 */
export async function 历史项目们(me: SessionUser, customerId: string, 号: 号码器): Promise<{ 项目们: 项目概要[]; 看不到: number }> {
  const 可看 = await 客户页可看项目(me, customerId);
  const ids = 可看.map((p) => p.id);
  const [节点, 验证, 卡点, 共, 后售们] = await 看全部(() => Promise.all([
    ids.length ? prisma.projectNodeLog.groupBy({ by: ["projectId"], where: { projectId: { in: ids } }, _count: { _all: true } }) : [],
    ids.length ? prisma.entLeadVerifyLog.groupBy({ by: ["projectId"], where: { projectId: { in: ids } }, _count: { _all: true } }) : [],
    ids.length ? prisma.entBlocker.findMany({ where: { projectId: { in: ids } }, select: { projectId: true, _count: { select: { logs: true } } } }) : [],
    看不到的在推数(customerId, ids),
    // 后售培育（P-界面-63）：一次判完这几节（同客户详情项目页签 project-zone.ts；没有停在潜客培育的不查库）
    后售项目们(可看.map((p) => ({ ...p, customerId }))),
  ]));
  const 数 = new Map<string, number>();
  for (const r of 节点) 数.set(r.projectId, (数.get(r.projectId) ?? 0) + r._count._all);
  for (const r of 验证) 数.set(r.projectId, (数.get(r.projectId) ?? 0) + r._count._all);
  for (const r of 卡点) 数.set(r.projectId, (数.get(r.projectId) ?? 0) + r._count.logs);
  return {
    项目们: 可看.map((p) => ({ id: p.id, 名: 文字打码(p.name, 号), 阶段: `${p.phase} · ${节点字({ ...p, node: 显示节点名(p.node, 后售们.has(p.id), 企业版字典) })}`, 条数: 数.get(p.id) ?? 0 })),
    看不到: 共,
  };
}

/** 项目建档那一格：建档时间、建档人、怎么来的、首个节点、首任负责人；库里有的才摆 */
async function 项目建档(projectId: string): Promise<建档格 | null> {
  const [p, 首节点, 首换人, 导入, 建档痕] = await 看全部(() => Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { createdAt: true, creatorId: true, ownerId: true, source: true, importBatch: true, awaitAssignAt: true, phase: true, node: true, result: true } }),
    prisma.projectNodeLog.findFirst({ where: { projectId, kind: "node" }, orderBy: [{ at: "asc" }, { id: "asc" }], select: { fromPhase: true, fromNode: true, fromResult: true, toPhase: true, toNode: true, toResult: true } }),
    prisma.projectNodeLog.findFirst({ where: { projectId, kind: { not: "node" } }, orderBy: [{ at: "asc" }, { id: "asc" }], select: { fromOwnerId: true } }),
    prisma.entImportRow.findFirst({ where: { entity: "opportunity", targetId: projectId, kind: "create" }, select: { id: true } }),
    prisma.auditLog.findFirst({ where: { entity: "Project", entityId: projectId, action: "create" }, orderBy: { at: "asc" }, select: { userId: true, userName: true, summary: true, detail: true } }),
  ]));
  if (!p) return null;
  const 字典 = 字典of(true, (await 生效组织规则()).阶段.出口叫法);
  const 首任id = 首换人 ? 首换人.fromOwnerId : p.awaitAssignAt ? null : p.ownerId;
  const 叫 = await 人名们([p.creatorId, 首任id, 建档痕?.userId]);
  const 怎么来 = p.source === 重复咨询来源 ? "重复咨询"
    : p.source === 历史分析来源 ? "导入（历史沟通分析回填）"
    : p.creatorId === 补建创建人 || p.importBatch === 补建批次 ? "系统补建（潜客培育）"
    : 导入 ? "导入"
    : 建档痕 && 批量批次(建档痕, 叫.原名(建档痕.userId)) ? "导入（后台补录）"
    : p.source ? 来源字(p.source) : "普通";
  // 首个节点：建档那一行（没有来处）落在哪；第一行就是换节点的，换之前那格就是首个；一次没换过 = 现在这格
  const 首 = 首节点
    ? 首节点.fromNode ? { phase: 首节点.fromPhase ?? "", node: 首节点.fromNode, result: 首节点.fromResult } : { phase: 首节点.toPhase, node: 首节点.toNode, result: 首节点.toResult }
    : { phase: p.phase, node: p.node, result: p.result };
  const 行们: 建档格["行们"] = [];
  const 建档人 = 叫(p.creatorId, true);
  if (建档人) 行们.push({ 键: "建档人", 值: 建档人 });
  行们.push({ 键: "怎么来的", 值: 怎么来 });
  行们.push({ 键: "首个节点", 值: 位置文字(首, 字典) });
  const 首任 = 首任id ? 叫(首任id) : p.awaitAssignAt && !首换人 ? "待分配" : null;
  if (首任 && 首任 !== "无负责人") 行们.push({ 键: "首任负责人", 值: 首任 });
  return { 时间: p.createdAt.toISOString(), 行们 };
}

/**
 * 一个项目的一页：节点记录全部 kind（文案同项目详情「进程变更」卡，lib/project/node-log-text.ts）、线索验证每一步、卡点流转。
 * 调用方先确认这个项目在 客户页可看项目 里。号 = 号码脱敏器（理由、说明、卡点标题里像号码的串打码）
 */
export async function 项目历史页(projectId: string, 号: 号码器, before?: 历史游标 | null): Promise<历史页 & { 建档: 建档格 | null }> {
  const 游 = 游标of(before);
  const where = <T extends object>(w: T) => (游 ? { AND: [w, 游] } : w);
  const take = 历史每页 + 1;
  const [节点, 验证, 卡点, 建档, 规则] = await Promise.all([
    看全部(() => prisma.projectNodeLog.findMany({ where: where({ projectId }), orderBy: 倒序, take })),
    看全部(() => prisma.entLeadVerifyLog.findMany({ where: where({ projectId }), orderBy: 倒序, take })),
    看全部(() => prisma.entBlockerLog.findMany({ where: where({ blocker: { projectId } }), orderBy: 倒序, take, include: { blocker: { select: { title: true, code: true } } } })),
    before ? null : 项目建档(projectId),
    生效组织规则(),
  ]);
  const 字典 = 字典of(true, 规则.阶段.出口叫法);
  const 类别ids = [...new Set(节点.map((l) => l.categoryId).filter((x): x is string => !!x))];
  const 类别 = new Map(类别ids.length ? (await 看全部(() => prisma.projectExceptionCategory.findMany({ where: { id: { in: 类别ids } }, select: { id: true, name: true } }))).map((c) => [c.id, c.name]) : []);
  const 们: 原[] = [
    ...节点.map((l): 原 => ({
      at: l.at, id: l.id, 人: [l.userId, l.fromOwnerId, l.toOwnerId],
      做: (叫) => {
        const who = 叫(l.userId) ?? "已不在的成员";
        const 因: string[] = [];
        if (l.kind === "node") {
          const to = { phase: l.toPhase, node: l.toNode, result: l.toResult };
          const 类 = l.categoryId ? 类别.get(l.categoryId) ?? "已不在的类别" : null;
          if (类) 因.push(`异常类别：${类}`);
          // 同进程变更卡：超时那句不当原因；换节点清掉的下一步原样一行
          if (l.reason && l.reason !== 超时理由) 因.push(l.reason.startsWith("原下一步：") ? l.reason : `${类 ? "备注" : "原因"}：${l.reason}`);
          return {
            id: l.id, at: l.at.toISOString(), 标: "节点",
            文: l.fromNode ? `${位置文字({ phase: l.fromPhase ?? "", node: l.fromNode, result: l.fromResult }, 字典)} → ${位置文字(to, 字典)}` : `建档，落在 ${位置文字(to, 字典)}`,
            谁: l.reason === 超时理由 ? "系统" : who, 因,
          };
        }
        const kind = l.kind === "transfer" || l.kind === "pool-release" || l.kind === "pool-claim" ? l.kind : "transfer";
        const 放回方式 = kind === "pool-release" ? 认放回(l.reason) : undefined;
        const 文 = 换人文字({ kind, who, reason: l.reason, transfer: { from: 叫(l.fromOwnerId) ?? "没人", to: 叫(l.toOwnerId) ?? "没人" }, 放回方式 });
        if (l.reason && l.reason !== 超时理由 && (放回方式 ?? "手动") === "手动") 因.push(进公海理由显示(l.reason));
        return { id: l.id, at: l.at.toISOString(), 标: kind === "transfer" ? "转让" : kind === "pool-release" ? "公海" : "领取", 文, 谁: l.reason === 超时理由 ? "系统" : who, 因 };
      },
    })),
    ...验证.map((v): 原 => ({
      at: v.at, id: v.id, 人: [v.userId],
      做: (叫) => ({
        id: v.id, at: v.at.toISOString(), 标: "线索验证", 文: `${v.step}：${v.verdict}`, 谁: 叫(v.userId) ?? "已不在的成员",
        因: [...(v.reason ? [`无效原因：${v.reason}`] : []), ...(v.note ? [`说明：${v.note}`] : [])],
      }),
    })),
    ...卡点.map((b): 原 => ({
      at: b.at, id: b.id, 人: [b.userId, b.fromUserId, b.toUserId],
      做: (叫) => {
        const 从 = 叫(b.fromUserId), 到 = 叫(b.toUserId);
        const 路 = 从 && 到 ? `：${从} → ${到}` : 到 ? `：给 ${到}` : "";
        return {
          id: b.id, at: b.at.toISOString(), 标: "卡点", 文: `「${b.blocker.title || b.blocker.code}」${动作叫法[b.action] ?? b.action}${路}`,
          谁: 叫(b.userId) ?? "已不在的成员", 因: b.note ? [`说明：${b.note}`] : [],
        };
      },
    })),
  ];
  const { 页, 更早 } = 截一页(们);
  return { 建档: 建档打码(建档, 号), 行们: await 成行(页, 号), 更早 };
}
