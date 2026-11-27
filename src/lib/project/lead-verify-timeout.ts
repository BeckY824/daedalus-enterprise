/**
 * 重复咨询线索的验证时限（P-线索-05，客户 E-379 定 1.5 小时）：
 * 出口 C 建的重复咨询线索（Project.source = repeat-inquiry）在线索验证里等人判（等市场复核、等销售终验、等总管理终判），
 * 照新线索同一个钟（reply-overdue.ts）：等到 1 小时提醒被等的那位，再 30 分钟没判就按链上最近一次判定自动落定
 * （lead-verify.ts 到期落定，来源写「验证时限到期自动落定」），通知被等的人和发起人。
 * 北京 22:00–08:00、周末、法定节假日不执行，顺延到下一工作日 08:00 重新计时：直接用 reply-overdue.ts 的 该做 / 不执行（不另写一套）。
 * 起钟时刻 = 进入这一步的时刻，不加库结构，读已有的列：
 *   市场复核 = verifiedAt（销售初判交上来）；销售终验 = reviewedAt（市场复核判有效）；
 *   总管理终判 = 销售提交异议的 ackedAt，没走异议（初判无效直接交总管理）= verifiedAt。
 * 生效时刻 = max(本钟自己的 Setting 验证时限生效key, 超时转生效时刻)：本钟第一遍扫（= 上线时刻）记成那一刻，超时转开关从关拨开时那边重记，
 *   起钟早于生效时刻的（上线前就在等的、关着期间进入的）一律不提醒不落定，只认之后进入这一步的。
 * 提醒发出的时刻 = 站内通知（EntNotice kind 验证时限）的 createdAt，不另存。销售认领不是验证，不走这个钟。
 * 跑在每分钟那一遍（nightly.ts，排在超时自动转后面）；开关同「超时未跟进自动转」。从不抛。
 */
import { prisma } from "../prisma";
import { getSetting, setSetting } from "../settings";
import { 看全部 } from "../team-scope";
import { 企业版 } from "@/lib/enterprise/switch";
import { 读组织 } from "@/lib/enterprise/org";
import { notify } from "@/lib/enterprise/notify";
import { 视图中跳过 } from "@/lib/enterprise/view-as";
import { 该做, 不执行, 超时提醒到期, 超时转出安排, 超时自动转开着, 超时提醒分钟, 超时转出分钟, 超时转生效时刻, 超时转生效key } from "@/lib/enterprise/reply-overdue";
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

/** 本钟的生效时刻存在这一行（Setting，ISO 时刻；坏了不覆盖，这一遍按现在算） */
export const 验证时限生效key = "enterprise.lead_verify_timeout.since";
async function 本钟生效时刻(现在: Date): Promise<Date> {
  const v = await getSetting<unknown>(验证时限生效key);
  const t = typeof v === "string" ? new Date(v) : null;
  if (t && !Number.isNaN(t.getTime())) return t;
  if (v == null) await setSetting(验证时限生效key, 现在.toISOString());
  else {
    // 钟一分钟一遍：同一个坏值只报一次（照 reply-overdue 记过坏生效值）
    const 坏 = JSON.stringify(v);
    if (记过坏本钟值 !== 坏) {
      记过坏本钟值 = 坏;
      console.warn(`[验证时限] ${验证时限生效key} 存的值解析不出时刻，不覆盖，先按现在算；请系统管理员改成 ISO 时刻`);
    }
  }
  return 现在;
}
let 记过坏本钟值: string | null = null;
let 记过坏转生效值: string | null = null;

/** 没人可通知时的落定时刻：该提醒的那刻当作提醒已发，照 超时转出安排 往后排（落在不执行时段 = 下个工作日重新计时再 +30 分钟） */
export function 兜底落定时刻(起: Date): Date {
  let 虚 = 超时提醒到期(起);
  for (let i = 0; i < 20; i++) {
    const 安排 = 超时转出安排(虚);
    if (安排.种 === "转") return 安排.时;
    虚 = 安排.时;
  }
  return 虚;
}
/** 兜底那行日志每条线索只打一次（进程内） */
const 已记兜底 = new Set<string>();

const 键头 = (id: string, 起: Date) => `verify-timeout:${id}:${起.toISOString()}`;

/** 一遍最多扫多少行（测试里传小的） */
export const 扫描上限 = 500;

export async function 验证时限扫一遍(现在: Date = new Date(), 上限: number = 扫描上限): Promise<验证时限明细> {
  const 明细: 验证时限明细 = { 提醒: 0, 落定: 0, 没落成: 0 };
  if (!企业版() || 不执行(现在)) return 明细;
  try {
    if (!(await 超时自动转开着())) return 明细;
    if (await 视图中跳过()) return 明细;
    const 转生效 = await 超时转生效时刻(现在);
    // 超时转生效时刻存坏了会回「现在」，起钟都早于它 = 这一遍全跳过：打一行日志（同一个坏值只一次），别静默
    if (转生效.getTime() === 现在.getTime()) {
      const 原 = await getSetting<unknown>(超时转生效key);
      if (原 != null && JSON.stringify(原) !== 记过坏转生效值) {
        记过坏转生效值 = JSON.stringify(原);
        console.warn(`[验证时限] ${超时转生效key} 存的值解析不出时刻，这一遍按现在算、所有在等的线索都不提醒不落定；请系统管理员改成 ISO 时刻`);
      }
    }
    const 生效 = new Date(Math.max((await 本钟生效时刻(现在)).getTime(), 转生效.getTime()));
    const 行们 = await 看全部(() => prisma.entLeadVerify.findMany({
      where: {
        pending: { in: ["市场复核", "销售终验", "总管理终判"] },
        // 生效前就在等的行不进扫描，不占名额：起钟时刻只会是这三列之一（起钟时刻），三列都早于生效的一定不走钟
        // （updatedAt 每步虽都会更新，但它是库写入时刻、起钟列是传入的业务时刻，直接比起钟列更准）
        // 生效后进来、pending 停在销售终验等负责人手动处理的卡住行没被排除，仍在扫描里：靠下面按 updatedAt 倒序沉底，新行排前面，积满上限也不挤掉新进来的
        OR: [{ verifiedAt: { gte: 生效 } }, { reviewedAt: { gte: 生效 } }, { ackedAt: { gte: 生效 } }],
        project: { source: 重复咨询来源, phase: "线索", node: 有效线索节点, result: null, pooledAt: null, awaitAssignAt: null, deletedAt: null },
      },
      include: { project: { select: { id: true, name: true, ownerId: true } } },
      orderBy: { updatedAt: "desc" },
      take: 上限,
    }));
    if (!行们.length) return 明细;
    const org = await 读组织();
    const 交给 = await 无效交给(org);
    for (const v of 行们) {
      try {
        const 步 = 实际待(v.pending, 交给) as 待哪步 | null;
        if (步 !== "市场复核" && 步 !== "销售终验" && 步 !== "总管理终判") continue;
        const 起 = 起钟时刻(步, v);
        if (!起 || 起.getTime() < 生效.getTime()) continue;
        const 头 = 键头(v.projectId, 起);
        const 末提醒 = await prisma.entNotice.findFirst({ where: { kind: 验证时限通知种类, dedupeKey: { startsWith: `${头}:` } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
        const 做 = 该做({ since: 起, overdueAt: 末提醒?.createdAt ?? null }, 现在);
        if (!做) continue;
        // 上一遍落不下来、已经通知过负责人的（缺必填等）：不每分钟重试，补齐后由负责人自己点终验
        if (步 === "销售终验" && (await prisma.entNotice.findFirst({ where: { kind: 验证时限通知种类, dedupeKey: `${头}:卡住` }, select: { id: true } }))) continue;
        const 被等 = await 被等的人们(v.projectId, 步);
        const 链接 = `/projects/${encodeURIComponent(v.projectId)}`;
        if (做 !== "转") {
          const 重 = 做 === "再提醒";
          const n = await notify(被等, {
            kind: 验证时限通知种类,
            title: `线索验证待处理：${v.project.name}`,
            body: `这条重复咨询线索在等${步}，已等满 ${超时提醒分钟 / 60} 小时${重 ? "（上次提醒后的时限落在非工作时段，已顺延重新计时）" : ""}。再过 ${超时转出分钟} 分钟还没判，系统会按上一步判定自动落定。`,
            link: 链接,
            key: `${头}:${重 ? `再${现在.toISOString()}` : "提醒"}`,
          });
          明细.提醒 += n;
          if (n > 0) continue;
          // 被等的人为空 / 通知一条没记上：overdueAt 永远 null，不然每分钟回到提醒、永远落不了。
          // 兜底也走顺延钟：该提醒的那一刻当作提醒发出，再 30 分钟落定；夜里 / 周末 / 节假日顺延重新计时（P-线索-05）
          if (!已记兜底.has(头)) {
            已记兜底.add(头);
            console.warn(`[验证时限] ${v.projectId} 等${步}但没有可通知的人（或通知没记上），按顺延钟在提醒时刻后 ${超时转出分钟} 分钟直接落定`);
          }
          if (现在.getTime() < 兜底落定时刻(起).getTime()) continue;
        }
        const r = await 到期落定(v.projectId, 步, 现在);
        if (!r.ok) {
          // 判卡住前再读一眼：读状态到事务开始之间销售点了提交异议（pending 已不是销售终验）= 不是卡住，静默跳过、也不算没落成
          if (r.卡住) {
            const 现行 = await prisma.entLeadVerify.findUnique({ where: { projectId: v.projectId }, select: { pending: true } });
            if (现行?.pending !== "销售终验") continue;
          }
          明细.没落成++;
          if (r.卡住) {
            const 通知 = {
              kind: 验证时限通知种类,
              title: `线索验证到期没能自动落定：${v.project.name}`,
              body: `这条重复咨询线索等${步}超过时限，系统想按上一步判定替负责人落定，但被拦住了：${r.error}。请处理后自己点终验，系统不会再自动重试。`,
              link: 链接,
              key: `${头}:卡住`,
            };
            // 负责人停用 / 不存在记不上：同一个 key 改发给系统管理员一次，卡住标记才记得住，下一分钟不再重推重拦
            // notify 不查停用、EntNotice 无外键，负责人只是被停用时照样记上 1 条；读好的 org.成员 只含在职成员（建组织 跳过 active=false），不在里面直接改发管理员
            if (!org.成员.has(v.project.ownerId) || (await notify([v.project.ownerId], 通知)) === 0) {
              const 管理员们 = await 被等的人们(v.projectId, "总管理终判");
              if ((await notify(管理员们, { ...通知, body: `${通知.body}（负责人已不在或已停用，改由系统管理员处理）` })) === 0) {
                console.warn(`[验证时限] ${v.projectId} 到期没能自动落定，负责人和系统管理员都没通知上，下一遍还会再试`);
              }
            }
          }
          continue;
        }
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
