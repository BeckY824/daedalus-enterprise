/**
 * 重复咨询线索的验证时限（P-线索-05，客户 E-379 定 1.5 小时）：
 * 出口 C 建的重复咨询线索（Project.source = repeat-inquiry）在线索验证里等人判（等市场复核、等销售终验、等总管理终判），
 * 照新线索同一个钟（reply-overdue.ts）：等到 1 小时提醒被等的那位，再 30 分钟没判就按链上最近一次判定自动落定
 * （lead-verify.ts 到期落定，来源写「验证时限到期自动落定」），通知被等的人和发起人。
 * 北京 22:00–08:00、周末、法定节假日不执行，顺延到下一工作日 08:00 重新计时：直接用 reply-overdue.ts 的 该做 / 不执行（不另写一套）。
 * 起钟时刻 = 进入这一步的时刻，不加库结构，读已有的列：
 *   市场复核 = verifiedAt（销售初判交上来）；销售终验 = reviewedAt（市场复核判有效）；
 *   总管理终判 = 销售提交异议的 ackedAt，没走异议（初判无效直接交总管理）= verifiedAt。
 * 提醒发出的时刻 = 站内通知（EntNotice kind 验证时限）的 createdAt，不另存。销售认领不是验证，不走这个钟。
 * 跑在每分钟那一遍（nightly.ts，排在超时自动转后面）；开关同「超时未跟进自动转」。从不抛。
 */
import { prisma } from "../prisma";
import { 看全部 } from "../team-scope";
import { 企业版 } from "@/lib/enterprise/switch";
import { 读组织 } from "@/lib/enterprise/org";
import { notify } from "@/lib/enterprise/notify";
import { 视图中跳过 } from "@/lib/enterprise/view-as";
import { 该做, 不执行, 超时自动转开着, 超时提醒分钟, 超时转出分钟 } from "@/lib/enterprise/reply-overdue";
import { 重复咨询来源 } from "./system-created";
import { 有效线索节点 } from "./stage-gates";
import { 实际待, 无效交给, 被等的人们, 到期落定, type 待哪步 } from "./lead-verify";

export const 验证时限通知种类 = "验证时限";
type 钟步 = "市场复核" | "销售终验" | "总管理终判";
export type 验证时限明细 = { 提醒: number; 落定: number; 没落成: number };

type 验证行 = { pending: string | null; verifiedAt: Date | null; reviewedAt: Date | null; ackedAt: Date | null; salesAck: string | null };

/** 进入这一步的时刻；读不出（旧数据没记）= null，这条不走钟 */
export function 起钟时刻(步: 钟步, v: 验证行): Date | null {
  if (步 === "市场复核") return v.verifiedAt;
  if (步 === "销售终验") return v.reviewedAt;
  return v.salesAck === "提交异议" ? v.ackedAt : v.verifiedAt;
}

const 键头 = (id: string, 起: Date) => `verify-timeout:${id}:${起.toISOString()}`;

export async function 验证时限扫一遍(现在: Date = new Date()): Promise<验证时限明细> {
  const 明细: 验证时限明细 = { 提醒: 0, 落定: 0, 没落成: 0 };
  if (!企业版() || 不执行(现在)) return 明细;
  try {
    if (!(await 超时自动转开着())) return 明细;
    if (await 视图中跳过()) return 明细;
    const 行们 = await 看全部(() => prisma.entLeadVerify.findMany({
      where: {
        pending: { in: ["市场复核", "销售终验", "总管理终判"] },
        project: { source: 重复咨询来源, phase: "线索", node: 有效线索节点, result: null, pooledAt: null, deletedAt: null },
      },
      include: { project: { select: { id: true, name: true, ownerId: true } } },
      take: 500,
    }));
    if (!行们.length) return 明细;
    const org = await 读组织();
    const 交给 = await 无效交给(org);
    for (const v of 行们) {
      try {
        const 步 = 实际待(v.pending, 交给) as 待哪步 | null;
        if (步 !== "市场复核" && 步 !== "销售终验" && 步 !== "总管理终判") continue;
        const 起 = 起钟时刻(步, v);
        if (!起) continue;
        const 头 = 键头(v.projectId, 起);
        const 末提醒 = await prisma.entNotice.findFirst({ where: { kind: 验证时限通知种类, dedupeKey: { startsWith: `${头}:` } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
        const 做 = 该做({ since: 起, overdueAt: 末提醒?.createdAt ?? null }, 现在);
        if (!做) continue;
        const 被等 = await 被等的人们(v.projectId, 步);
        const 链接 = `/projects/${encodeURIComponent(v.projectId)}`;
        if (做 === "提醒" || 做 === "再提醒") {
          const 重 = 做 === "再提醒";
          const n = await notify(被等, {
            kind: 验证时限通知种类,
            title: `线索验证待处理：${v.project.name}`,
            body: `这条重复咨询线索在等${步}，已等满 ${超时提醒分钟 / 60} 小时${重 ? "（上次提醒后的时限落在非工作时段，已顺延重新计时）" : ""}。再过 ${超时转出分钟} 分钟还没判，系统会按上一步判定自动落定。`,
            link: 链接,
            key: `${头}:${重 ? `再${现在.toISOString()}` : "提醒"}`,
          });
          明细.提醒 += n;
          continue;
        }
        const r = await 到期落定(v.projectId, 步, 现在);
        if (!r.ok) { 明细.没落成++; continue; }
        明细.落定++;
        await notify([...new Set([...被等, v.verifiedById, v.project.ownerId])], {
          kind: 验证时限通知种类,
          title: `线索验证已自动落定：${v.project.name}`,
          body: `这条重复咨询线索等${步}超过时限，已按上一步判定自动落定（验证时限到期自动落定）。`,
          link: 链接,
          key: `${头}:落定`,
        });
      } catch (e) {
        明细.没落成++;
        console.error(`[验证时限] ${v.projectId} 出错，下一遍再试`, e);
      }
    }
  } catch (e) {
    console.error("[验证时限] 这一遍没扫成，下一遍再试", e);
  }
  return 明细;
}

/** 钟上调的（每分钟一遍） */
export const 钟上验证时限 = 验证时限扫一遍;
