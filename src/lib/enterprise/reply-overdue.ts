/**
 * 企业版「超时未跟进自动转」（11-17，客户确认的规则；指定回复时间的后续）：线索阶段、分给销售的项目，负责人一直没记有效沟通，
 * 先提醒、再自动收回分给下一位销售，接手人同样计时，不限次数。
 * 两种起算（11-20 用户定「选1」：没填指定回复时间的，从分配给销售那一刻起算 1.5 小时）：
 *   - 填了指定回复时间的 = 按指定回复时间（按时）：下面规则 1 原样
 *   - 没填指定回复时间、市场分给销售的 = 按分配时刻（按分配）：分给现负责人那一刻 + 1 小时没记有效沟通 = 超时提醒，再 30 分钟 = 自动转，
 *     后面和按时的一样（接手人同样计时、夜里顺延、一遍只走一步）
 *
 * 规则（客户原意）：
 *   1. 时间线：指定回复时间前 30 分钟提醒（已有，reply-notice.ts）→ 过了 1 小时还没记有效沟通 = 超时提醒（站内 + 飞书 + 首页待办）
 *      → 再过 30 分钟还没记 = 自动转给下一位销售。接手人同样：接手 1 小时提醒，再 30 分钟没记再转；每人最多 1.5 小时。
 *      北京时间 22:00–08:00 什么都不执行；周末和法定节假日整天和夜里一样不执行，调休上班的周六周日照常计时（客户 11-21 选方案 B）。
 *      哪天上班见 cn-workday.ts（按年录国务院办公厅通知，没录的年份按周一到周五）。
 *      顺延后重新计时（客户 11-22「需要重新计时」，P-转-43）：链上任何一步（超时提醒、自动转）该发的时刻落在不执行时段，
 *      就在下一个工作日 08:00 从头重新计时，09:00 发超时提醒、09:30 还没记才转，员工到岗后有完整的 1 小时 + 30 分钟：
 *        · 周六上午分来 → 下周一 09:00 提醒 → 09:30 转；周五 21:30 分来 → 下周一 09:00 提醒 → 09:30 转
 *        · 周五 21:45 已发提醒、22:15 该转 → 下周一 08:00 重新计时，09:00 再发一次超时提醒（注明顺延后重新计时）→ 09:30 转
 *        · 工作时段内没被顺延的照旧：1 小时提醒、再 30 分钟转
 *      见 超时提醒到期 / 超时转出安排 / 该做。
 *   2. 原负责人收一条「超时未跟进已自动收回并分配给其他成员」（站内 + 飞书）。
 *   3. 客户跟着线索给接手人。唯一例外：原负责人手上还有这位客户别的进行中项目 → 客户留在原负责人名下，接手人在项目页看到「该客户在 XXX 名下」。
 *      这是 P-转-04（项目层动作不动客户）的例外，只在这条自动转里。
 *
 * 生效范围（11-20 事故后用户定「只对上线后新分配的计时、之前的跟进也算」）：
 *   - 生效时刻 = Setting 超时转生效key（ISO 时刻）：开关从关拨到开时记成打开那一刻（超时转重新起算）；从没记过的（新装、默认开着上线），
 *     开着时第一遍扫记成那一刻（= 上线时刻）；有这一行但值坏了不覆盖（只记日志、按现在算）。超时基准早于生效时刻的一律不起链；
 *     还在走的、基准早于生效时刻的停掉。
 *     按分配 = 分配基准（被分配 / 销售自建 / 销售自领那一刻）在生效时刻以后；
 *     按时 = 指定回复时间（结束，没填用开始）在生效时刻以后，且分配基准（同按分配的取法）也在生效时刻以后——老分配的线索新填了指定回复时间
 *     也不计时（11-20 Even「只计之后新分配、销售自己新建、从公海领取的」）；还在走的按时链只在分配基准算得出、且早于生效时刻时停
 *     （11-20 21:06 一批把 11-14 管理从客户公海分的、往回 7 天里的老分配一口气转走 77 条）
 *   - 之前的跟进也算（按时、按分配、历史三种都是）：负责人本人在这位客户上记过的有效沟通（任何时候、挂哪条项目都算、没挂项目的也算），
 *     就算已沟通——不是首次沟通，不起链、在走的停下，改了指定回复时间也不重开（负责人以前在这位客户身上跟过：导入的历史跟进、报过价的，
 *     不是「分来没人理」）。不算：跟进任务 / 跟进提醒（TASK / REMIND）、同号留痕、空的占位的、别人记的（市场建档那条照旧不算）
 *   - 生效时刻可以先设成将来（Even 11-20「两步走」第一步：北京 11-21 09:30 起只对新分配的）：开关先开着，到那一刻之前一律不计时；
 *     开关从关拨到开时，已经设了将来的生效时刻就留着它（不改成打开那一刻）
 *   - 计时范围（用户 11-20「包括」，覆盖 P-转-28 里销售自持只提醒那半句；Even「销售进行新增」）：别人分给他的、
 *     销售（业务角色有 sales）自己新建的、自己从公海领取的都计时、到点照转。总管理、系统管理员、销售管理、市场成员自己建给自己 / 自己领的
 *     不计时（别人分给他们的照常按分配算）；导入 / 同步建的（创建人记成负责人）不算自建、不从建档起算（P-转-41「导入不起算」）。
 *     只管「首次沟通」：负责人接手（被分配、新建、领取、超时转来）后记下第一条有效沟通，这条链就停下，之后不再计时
 *   - 历史数据起算（Even 11-20「两步走」第二步；用户 11-20 定北京 12-01 00:00 = 2026-11-30T16:00:00Z，夜里照旧不执行 → 08:00 起算、09:00 提醒、09:30 转）：
 *     Setting 历史起算key（ISO 时刻），没设 = 不启用。到了这一刻，基准算不出或早于生效时刻的线索（导入的、生效前分的、销售自建的、领取的、
 *     指定回复时间早就过了的），只要不是自留不计的（市场成员自留、非销售自建给自己）、负责人在这位客户上一条有效沟通都没记过
 *     （同「之前的跟进也算」），也进链，
 *     计时起点 = 历史起算时刻（项目比它晚建的按建的那一刻；早于生效时刻的按生效时刻），按分配那一套走（提醒、30 分钟后转），不受往回 7 天的窗口限制。
 *     一遍最多新起 历史一批 条（第一遍几千条分几分钟起，不一口气读进内存）
 *
 * 规则没说、按默认做的（集中在本文件，改口径只改这里）：
 *   - 超时基准：按时 = 指定回复时间的结束，没填结束用开始（一个时间点就是它；一段时间按段尾）；
 *     按分配 = 分配基准()：最近一次「别人把这条线索分给他」的时刻。起算的只有这几种留痕（算起算()）：
 *     只有「别人把这条项目分给他」起算，靠留痕原因的开头认（carry-tasks.ts 那几句，写痕的入口各自带上），不靠时间：
 *       · 分配入口（自动分配、指定分配、定时分配到点，assign-actions.ts 分项目给）：转让留痕，原因以「分配方式：」开头
 *       · 手动转让（改项目，含改公海里项目的负责人）：转让留痕，原因是 待办痕（「原负责人没做完的待办…」），没碰待办的记「手动转让」
 *       · 管理从线索公海分项目（分配公海项目，pool-assign-projects.ts）：pool-claim，原因以「从线索公海分配」开头
 *         （客户还在市场手里、跟着市场转给他的也算，P-公海-11）
 *       · 管理从客户公海分客户带出的线索公海项目（客户公海分配、分项目时整包出公海）：pool-claim，原因以「从客户公海分配」开头
 *       · 市场新建时直接给销售（没有转让留痕，只有一条分配记录；含查重领取新建的那条）：按那条分配记录的时刻
 *     不起算（总控 11-20 定，P-转-28「只转市场分给销售的」：跟着客户带过去的、自己拿的不是「分给他」）：
 *       · 操作人就是接手人的（ProjectNodeLog.userId = toOwnerId；分配记录 byUserId = toUserId）：自己去公海领、自己分给自己、
 *         从客户公海领客户顺带过来的公海项目、导入出公海
 *       · 跟着客户带过去的：客户转让、管理分客户、查重领取（含带出线索公海的旧项目），原因「跟着客户转过来」开头；
 *         离职交接（交客户、只交项目、全部交给里的其余和同事两组），原因「离职交接」开头；市场转客户带项目，原因「随客户转走」开头
 *       · 原因空的转让留痕（没带开头的转项目调用、改项目没碰待办）、别的原因：从回收站恢复跟客户现负责人（「从回收站恢复…」，
 *         已停的链也不重启）、数据脚本（如「客户合并：随…并入」）
 *       · 11-20 以前写的老留痕没有这几个开头：pool-claim 按同一个客户、相差不到 随客户秒 秒、换给同一人的客户换负责人记录认——
 *         那行是管理分客户公海（kind pool-assign）= 起算（11-14 那批），别的种类（转让、离职、市场转、领取）= 不起算，没有那行 = 分线索公海项目、起算
 *         （老的分线索公海项目、客户跟着市场转的那种认不出来，按市场转不起算）；
 *         原因空的转让留痕一律不起算（老的离职交接只交项目也是这样）。老的查重领取带出的项目客户换人记录也是 pool-assign，认不出来，
 *         照起算（上线时往回 7 天里一条都没有）
 *       · 超时自动转那几行跳过（链上第一位的分配时刻不随轮转挪；主动放弃转出那行同样跳过，32H lead-giveup.ts）；没留痕就换了负责人的（导入改负责人）= 不知道什么时候到他手上
 *     还得是「分来的」（是分来的()）：自留、自持的没填指定回复时间不进链
 *   - 有效沟通（11-20 用户定：只认负责人本人记的）：只算记录人（FollowUp.ownerId）= 这条链当前负责人（项目 ownerId）的沟通；
 *     别人记的（销售管理、市场、前负责人、同事）一律不算、不让链停下（超时提醒正文写明「需负责人本人记录有效沟通」）。
 *     「有效」三处同一个判定（reply-notice.ts 是有效沟通）：有内容（空的、占位的不算），不是跟进任务 / 跟进提醒（TASK / REMIND），
 *     不是同号再次录入的系统留痕（标题 同号标题 或挂项目节点 同号节点：客户又来问不等于负责人回了）。三种基准都一样：
 *     按时 = 提醒时刻（开始 ?? 结束 − 30 分钟）以后挂在这条项目上、负责人本人记的有效沟通（reply-notice.ts 已回复的 传 只认负责人；
 *     它自己的 30 分钟前提醒、首页「待回复客户」不传，照旧谁记的都算、只排同号节点）；
 *     按分配、历史 = 基准那一刻之后（createdAt 严格晚于基准）挂在这条项目上、负责人本人记的有效沟通，建的人建档那一刻随手记的
 *     （建的人记的、和项目建档相差不到 建档随手记秒 秒）这一项不算——例：市场建档记了一条沟通、同一分钟自动分给销售，
 *     销售之后没记 → 照样进链；市场、管理之后又记了 → 照样进链。销售自建给自己时建档随手记的那条是负责人本人记的，
 *     会被「之前的跟进也算」（负责人跟过的）算上、链停下（负责人已经和客户沟通过 = 不是首次沟通）。
 *     外加三种都看「之前的跟进也算」（见上「生效范围」）。任何时候记了，这条链就停下（这一位不再提醒、不再转）
 *   - 计时口径（11-22 起，见上规则 1「顺延后重新计时」）：计时起点（分配 / 接手 / 指定回复时间）本身落在不执行时段的，从下一个工作日 08:00 起算
 *     （07:30 分来 = 08:00 起算 → 09:00 提醒；不然 06:59 分来 09:00 提醒、07:01 分来反倒 08:01 提醒）；起算后 1 小时提醒落在不执行时段 =
 *     下一个工作日 08:00 重新起算 → 09:00 提醒；提醒实际发出 + 30 分钟落在不执行时段 = 下一个工作日 08:00 重新起算 → 09:00 再提醒一次 → 09:30 转。
 *     21:50 接手 → 22:50 该提醒 → 次日 09:00 提醒 → 09:30 转。库里只存计时起点（since）和提醒实际发出的时刻（overdueAt），
 *     下一步的时刻每遍现算、不落库：改口径后已经在路上的链下一遍就按新口径走，不用迁移
 *   - 下一位 = 现成的自动分配挑人（assign-actions.ts 超时转出：这条线索定好的流转线、参与状态、本月分得最少、并列最早进池，
 *     配额照查），排除现负责人和这一轮超时过的人；人人都轮过一遍 → 开新一轮（仍不给现负责人）。挑不到 = 不转、留在现负责人手上，
 *     只记日志，下一分钟再试（不通知上级）
 *   - 按线流转（[32G]，Even 11-20）：线 = 项目上的流转线（Project.flowLine：市场分配 / 新增 / 管理指定时写，flow-line-core.ts），
 *     超时转不改线、接手人换了线不变；没有流转线按当时负责人所在事业部兜底。不看项目业务线、客户业务线 / 区域、电话。
 *     判不出线 = 不转、留在现负责人手上只记日志；这条线里挑不到人 = 不转、不跨线
 *   - 转出算接手人的一次分配（占本月分配数）、清待分配、接手人照常收「分给你」；项目留痕记一行转让，原因「超时未跟进自动转」，操作人「系统」
 *   - 自动轮转不重置超时回收日（客户 11-19 第 14 题 B）：项目超时回收的起点不认上面那行（timeout.ts 是超时自动转痕），
 *     客户跟着转的那行（overdue-assign）三态钟也不归零（tri-state-transfer.ts 换人方式 不收它）；手动转让、领取照旧归零。
 *     本文件的接手时刻照旧认那行（接手人的 1.5 小时从轮转那刻算）
 *   - 只管：线索阶段、没结局、不在公海（项目和客户都不在）、不在回收站、不在待分配；有分配基准（填没填指定回复时间都要，见「生效范围」）
 *   - 只转「分出去」的线索（11-18 客户定第 1 题 B）：负责人是别人分给他的（负责人不是建的人，或有一行把它分给现负责人的分配记录，
 *     或别人从线索公海分给他的 pool-claim 留痕，11-20）才转；销售自建、自领的 11-20 起也转（见「计时范围」）。
 *     市场成员自留、非销售自建自留的算不出分配基准，11-20 起填了指定回复时间也不进链（以前到点只提醒本人、不转；
 *     只提醒不转那条路（可转of、自留超时话）留着，只剩改版前已经起了的链会走到）。以后有人把它分给别人了，按新负责人从接手那刻重新计时，到点照转
 *   - 别人手动换了负责人：按新负责人从他接手那刻重新计时（这一轮超时过的人照记）。按分配的链还在走时同样（基准钉在起链那一刻）；
 *     按分配的链已经停了（记过有效沟通）再被转让 / 分给别人 = 新的一次分配，整条重来，接手人从那一刻起算
 *   - 出了范围（进公海、有结局、转商机、客户进公海、进回收站）的链就此停下，领回来 / 恢复了也不再接着转
 *   - 改指定回复时间 = 基准对不上 = 整行重来：改了时间按新时间；从空填上 = 改按时（按新填的时间，往回 3 天）；
 *     负责人本人记过有效沟通的（链因首次沟通停了）重来也马上停，不提醒（之前的跟进也算）；
 *     清空 = 改按分配（分配在往回 7 天里、分配后没记有效沟通的照进链，上线后一样先提醒、30 分钟后才转）；清空了又没有分配基准 = 链停下
 *   - 起链只往回看：按时 起链往回看天 天、按分配 分配起链往回看天 天，且不早于生效时刻（见上「生效范围」）；
 *     刚过完周末 / 法定长假的那个工作日，再补上紧挨着的不上班天数（往回看起点：假期里钟不执行，不补就过期漏掉）；
 *     停过机的按状态补：一遍只走一步，超时提醒补发了再等 30 分钟才转，不连环转
 *   - 客户随线索换人时，原负责人在这位客户上没做完的计划、待办一起给接手人；已结束的项目照留原负责人名下当历史
 *
 * 挂在夜扫那个每分钟的钟上（lib/project/nightly.ts，多进程只一个进程跑），排在定时分配、指定回复提醒后面。
 * 一条只发一次靠 EntNotice 的 (userId, dedupeKey) 唯一键；链走到哪一步记在 EntReplyOverdue（迁移 150）。任何一步出错只记日志，从不往外抛
 */
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 看已删 } from "./soft-delete-core";
import { 查完再写 } from "@/lib/check-then-write";
import { 带走一位 } from "@/lib/carry-over-db";
import { 系统, 超时自动转理由, 是超时自动转痕 } from "@/lib/project/timeout";
import { 指定回复文字, 短时刻, 客户在谁名下话, 分配后未跟进话 } from "@/lib/project/time-fields";
import { 超时转出 } from "@/app/(app)/leads/assign-actions";
import { notify } from "./notify";
import { 通知文字打码 } from "./notice-mask";
import { 分配通知, 带放弃链接 } from "./notice-sources";
import { 企业版 } from "./switch";
import { 视图中跳过 } from "./view-as";
import { 客户有未裁定异议, 读全部待裁定行, 挡着项目的异议 } from "./objection-guard";
import type { 待裁定行 } from "./objection-guard";
import { 已回复的, 是有效沟通, 不是沟通的类型, 回复提醒时刻 } from "./reply-notice";
import { 无效沟通原因of, 无效原因话, 有效沟通最少字数, type 无效沟通原因 } from "./tri-state-quota";
import { 系统操作人 } from "./scheduled-assign";
import { 超时转令牌 } from "./scheduled-assign-token";
import { 规则开着 } from "./rules";
import { 待办痕头, 公海分配痕, 线索公海分配痕, 手动转让痕 } from "@/lib/project/carry-tasks";
import { 同号节点 } from "./same-number-collab";
import { 读占位词 } from "./tri-state-db";
import { getSetting, setSetting } from "@/lib/settings";
import { 同号标题 } from "./same-number-mark";
import { 读组织于 } from "./org";
import { 是市场成员of, type 组织 } from "./org-core";
import { 只留销售 } from "./assign-line";
import { 是工作日, 北京日, 下一天, 前一天 } from "./cn-workday";

/**
 * 总开关 = 组织规则「超时未跟进自动转」（rules-table.ts，设置 → 组织架构里系统管理员拨，默认开）。
 * 关着 = 只留 30 分钟前那条提醒，不做超时提醒和自动转、首页待办不标超时；已经转出去的不回滚，链停在原处不动。
 * 再打开 = 重新生效（超时转重新起算）：生效时刻记成打开那一刻，在计时的链全停，只对打开以后新分配的计时，
 * 不会一打开就把关着期间、或打开以前分的一口气转走
 */
export const 超时自动转开着 = (): Promise<boolean> => 规则开着("超时自动转");
/** 计时起点（指定回复时间 / 接手）往后多少分钟发超时提醒；顺延后重新计时也是从 08:00 往后这么多分钟（= 09:00） */
export const 超时提醒分钟 = 60;
/** 超时提醒实际发出后再过多少分钟自动转（顺延后重新计时 = 09:00 提醒 + 30 分钟 = 09:30） */
export const 超时转出分钟 = 30;
/**
 * 北京时间夜里不执行：[起, 止) 点；周末、法定节假日整天不执行（见 不执行）。落在这些时段的一步不顺延着执行，
 * 而是在下一个工作日的 止 点（08:00）从头重新计时（11-22，见文件头规则 1）
 */
export const 夜里 = { 起: 22, 止: 8 } as const;
/** 起链最多往回看几天的超时基准（上线、停机很久时老数据不一口气全转）：填了指定回复时间的（按时） */
export const 起链往回看天 = 3;
/** 没填指定回复时间、按分配时刻起算的（11-20 用户定）：分配时刻在这几天里的才起链，更早的由超时回收 / 三态兜底 */
export const 分配起链往回看天 = 7;
/**
 * 建的人建档那一刻随手记的沟通（分配后沟通过的 不算它）：建的人记的、和项目建档相差不到这几秒。
 * 销售自建时那条是负责人本人记的，负责人跟过的 照样算上、链停下（见文件头「有效沟通」）
 */
export const 建档随手记秒 = 60;
/** 给原负责人的那句（客户原话） */
export const 收回话 = "超时未跟进已自动收回并分配给其他成员";
/**
 * 项目留痕、分配通知里的原因。留痕那行（操作人 系统）不重置项目超时回收日（客户 11-19 第 14 题 B）：
 * 回收起点靠这几个字认出它（timeout.ts 是超时自动转痕），改字要一起改那边
 */
export const 超时转理由 = 超时自动转理由;
/** 通知种类（铃铛里的来源） */
export const 超时通知种类 = "超时未跟进";

/** 生效时刻存在这一行（Setting，值是 ISO 时刻，见文件头「生效范围」） */
export const 超时转生效key = "enterprise.reply_overdue.since";
/**
 * 生效时刻：只对超时基准不早于它的计时。读不出来的一律当现在（还没生效，以前的都不算）。
 * 写 = 开着时扫的那一遍：库里没有这一行（从没记过）才记成现在（第一遍扫 = 上线时刻）；
 * 有这一行但值坏了（解析不出时刻）不覆盖（不然一行写坏的将来时刻会被悄悄改成现在、提前生效），只记日志，这一遍按现在算。
 * 不写（盘点、首页待办）只读
 */
export async function 超时转生效时刻(现在: Date, 写 = false): Promise<Date> {
  const v = await getSetting<unknown>(超时转生效key);
  const t = typeof v === "string" ? new Date(v) : null;
  if (t && !Number.isNaN(t.getTime())) return t;
  if (写) {
    const 有行 = await prisma.setting.findUnique({ where: { key: 超时转生效key }, select: { value: true } });
    if (!有行) await setSetting(超时转生效key, 现在.toISOString());
    else if (记过坏生效值 !== 有行.value) {
      记过坏生效值 = 有行.value;
      console.warn(`[超时自动转] 生效时刻 ${超时转生效key} 存的值解析不出时刻（${有行.value}），不覆盖，先按现在算；请系统管理员改成 ISO 时刻`);
    }
  }
  return 现在;
}
/** 坏的生效值只记一次日志（钟一分钟一遍） */
let 记过坏生效值: string | null = null;
/** 历史数据起算时刻（Even 11-20「两步走」第二步，见文件头）：Setting 值是 ISO 时刻；没设、存坏了 = 不启用 */
export const 历史起算key = "enterprise.reply_overdue.historyFrom";
/** 一遍最多新起几条历史数据的链 */
export const 历史一批 = 500;
/** 历史起算时刻；没设 / 存坏了 / 还没到 = null */
export async function 历史起算时刻(现在: Date): Promise<Date | null> {
  const v = await getSetting<unknown>(历史起算key);
  const t = typeof v === "string" ? new Date(v) : null;
  return t && !Number.isNaN(t.getTime()) && t.getTime() <= 现在.getTime() ? t : null;
}
/** 历史数据的计时起点：历史起算时刻，项目比它晚建的按建的那一刻，都不早于生效时刻 */
export const 历史基准 = (历史: Date, 生效: Date, 建于: Date): Date => new Date(Math.max(历史.getTime(), 生效.getTime(), 建于.getTime()));

const 分 = 60_000;
const 天 = 86_400_000;
const 京偏 = 8 * 3_600_000;

/** 北京时间夜里（22:00–08:00）没有 */
export function 在夜里(t: Date): boolean {
  const h = new Date(t.getTime() + 京偏).getUTCHours();
  return h >= 夜里.起 || h < 夜里.止;
}

/**
 * 不执行的时段（客户 11-21 方案 B）：北京夜里（22:00–08:00），或这一天不上班（周末、法定节假日整天；调休上班的周六周日照常，cn-workday.ts）
 */
export function 不执行(t: Date): boolean {
  return 在夜里(t) || !是工作日(北京日(t));
}

/**
 * 落在不执行时段的顺延到下一个工作日（北京）早上 08:00；能执行的原样。
 * 夜里过了零点、当天上班 = 当天 08:00；22 点以后、或白天落在休息日 = 从第二天起找第一个上班的日子
 */
export function 顺延到可执行(t: Date): Date {
  if (!不执行(t)) return t;
  let 日 = 北京日(t);
  if (new Date(t.getTime() + 京偏).getUTCHours() >= 夜里.止) 日 = 下一天(日);
  while (!是工作日(日)) 日 = 下一天(日);
  return new Date(Date.UTC(+日.slice(0, 4), +日.slice(5, 7) - 1, +日.slice(8, 10)) + 夜里.止 * 3_600_000 - 京偏);
}

type 两格 = { replyStartAt: Date | null; replyEndAt: Date | null };

/** 超时基准（按时）：结束，没填结束用开始；都没填 = null（没填的按 分配基准） */
export const 超时基准 = (p: 两格): Date | null => p.replyEndAt ?? p.replyStartAt;

/** 分配基准 要看的换人留痕几列（ProjectNodeLog kind transfer / pool-claim） */
export type 换人痕 = { kind: string; userId: string; reason: string | null; fromOwnerId: string | null; toOwnerId: string | null; at: Date };
/** 分配基准 要看的分配记录几列（EntLeadAssign） */
export type 分配行 = { toUserId: string; byUserId: string; createdAt: Date };
/** 分配基准 要看的客户换负责人记录几列（CustomerOwnerLog）：认「跟着客户带过去」的项目 */
export type 客户换人 = { toOwnerId: string | null; at: Date; kind: string; userId: string };

/** 分配入口（assign-actions.ts 分项目给）那行转让留痕原因的开头 */
export const 分配方式痕头 = "分配方式：";
/** 老留痕：项目换人痕和客户换人记录相差不到这几秒、给的是同一个人 = 同一个事务里写的（看那行客户换人是哪种） */
const 随客户秒 = 5;

/**
 * 这一行换人留痕算不算「别人把它分给他」（按分配起算，见文件头）。客户换人们 = 这条项目的客户的换负责人记录
 */
export function 算起算(l: 换人痕, 客户换人们: readonly 客户换人[]): boolean {
  if (!l.toOwnerId || l.userId === l.toOwnerId) return false;
  if (l.kind !== "transfer" && l.kind !== "pool-claim") return false;
  const 因 = l.reason ?? "";
  if ([分配方式痕头, 公海分配痕, 线索公海分配痕, 手动转让痕].some((头) => 因.startsWith(头))) return true;
  // 别的原因都不是分给他：跟着客户转过来、离职交接、随客户转走（carry-tasks.ts）、从回收站恢复、数据脚本……
  if (因 && !因.startsWith(待办痕头)) return false;
  // 只剩待办痕或空。转让：待办痕 = 手动转让（改项目；没碰待办的新留痕记 手动转让痕，上面）；空 = 没带开头的转项目调用（老的离职交接只交项目等），不起算
  if (l.kind === "transfer") return !!因;
  // pool-claim：11-20 以前写的老留痕（那时分线索公海项目、带出公海的都没开头），看同一刻的客户换人
  const 同刻 = 客户换人们.find((c) => c.toOwnerId === l.toOwnerId && Math.abs(c.at.getTime() - l.at.getTime()) <= 随客户秒 * 1000);
  return !同刻 || (同刻.kind === "pool-assign" && 同刻.userId !== l.toOwnerId);
}

/**
 * 分配基准（11-20 用户定，见文件头）：现负责人这条线是哪一刻分出来的（被分配 / 销售自建 / 销售自领）；不算 / 不知道 = null。
 * 按分配的超时基准就是它；按时的也要它不早于生效时刻才计时（11-20 Even「只计之后新分配、销售自己新建、从公海领取的」）。
 *   - 最近一行不是超时自动转的转让留痕（自动分配、指定分配、定时分配到点、手动转让都记这一行）的时刻；轮转那几行跳过，链上第一位的分配时刻不挪
 *   - 那一行不算起算（算起算()：自己拿的、跟着客户带过去的、回收站恢复、数据脚本，见文件头）= null
 *   - 一行转让都没有（市场新建时直接给了销售）= 最早那条分配记录的时刻；超时自动转写的分配记录（操作人 系统）不算，同轮转那几行
 *   - 最近一行换人留痕不是给现负责人的（没留痕就换了人，比如导入改负责人）、不是分来的（自留、自持）= null
 * 两张表的行都是这条项目的、顺序不限
 */
export function 分配基准(
  p: { ownerId: string; creatorId: string; createdAt?: Date }, 痕们: readonly 换人痕[], 分配们: readonly 分配行[], 客户换人们: readonly 客户换人[] = [],
  /** 负责人是销售（业务角色有 sales，用户 11-20「包括」、Even「销售进行新增」）：自己新建的从建的那一刻、自己从公海领的从领的那一刻也起算 */
  自己的也算 = false,
  /** 导入 / 同步建的（EntExternalRef / EntImportRow 记着，P-转-41「导入不起算」）：创建人记成负责人，不是销售自建，不从建档起算 */
  导入的 = false,
): Date | null {
  if (!p.ownerId) return null;
  // 超时自动转写的分配记录（超时转出 操作人 系统）不是「分给他」：链上第一位的分配时刻不随轮转挪，同下面跳过轮转留痕
  分配们 = 分配们.filter((a) => a.byUserId !== 系统.id);
  const 痕 = 痕们.filter((l) => l.kind === "transfer" || l.kind === "pool-claim").sort((a, b) => b.at.getTime() - a.at.getTime());
  const 自领 = (l: 换人痕) => 自己的也算 && l.kind === "pool-claim" && l.userId === p.ownerId && l.toOwnerId === p.ownerId;
  if (!是分来的(p, 分配们.some((a) => a.toUserId === p.ownerId) || 痕们.some((l) => 公海分给他(l, p.ownerId))) && !自己的也算) return null;
  if (痕.length && 痕[0].toOwnerId !== p.ownerId) return null;
  const 那次 = 痕.find((l) => !是超时自动转痕(l));
  if (那次) return 算起算(那次, 客户换人们) || 自领(那次) ? 那次.at : null;
  // 一行换人都没有、负责人就是建的人：销售自己新建的，从建的那一刻（导入 / 同步建的不算）
  if (!痕.length && 自己的也算 && !导入的 && p.ownerId === p.creatorId && p.createdAt) return p.createdAt;
  const 最早 = [...分配们].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
  if (!最早 || 最早.byUserId === 最早.toUserId || (!痕.length && 最早.toUserId !== p.ownerId)) return null;
  return 最早.createdAt;
}

/**
 * 这个时刻是不是这条项目的某次换人 / 分配、或建档那一刻（按分配起的链，anchorAt 就是其中一行的时刻；销售自建起的链 = 建档那一刻，
 * 轮转出去以后算不出分配基准了，靠这个钉住、不整行重来；指定回复时间只到分钟，对不上）
 */
const 是分配时刻 = (t: Date, 痕们: readonly 换人痕[], 分配们: readonly 分配行[], 建于?: Date): boolean =>
  痕们.some((l) => l.at.getTime() === t.getTime()) || 分配们.some((a) => a.createdAt.getTime() === t.getTime()) || 建于?.getTime() === t.getTime();

/**
 * 起链往回看到哪一刻：天数，再加上紧挨着今天（北京）之前连着不上班的天数（周末、法定节假日，方案 B 11-21）。
 * 周末、长假里钟不执行、链起不来，假后第一个工作日才起：不补这几天，国庆、春节里分来 / 约的会过了往回看的天数、一条都不提醒不转。
 * 平常的工作日（前一天上班）不补，和以前一样
 */
export function 往回看起点(现在: Date, 天数: number): Date {
  let 补 = 0;
  for (let 日 = 前一天(北京日(现在)); 补 < 31 && !是工作日(日); 日 = 前一天(日)) 补++;
  return new Date(现在.getTime() - (天数 + 补) * 天);
}

/** 起链窗口：基准在往回看的天数里（按时 3 天、按分配 7 天；刚过完周末 / 长假的补上那几天，见 往回看起点）、且过了 1 小时 */
export function 在起链窗口(基: Date, 按分配: boolean, 现在: Date): boolean {
  const 天数 = 按分配 ? 分配起链往回看天 : 起链往回看天;
  return 基.getTime() >= 往回看起点(现在, 天数).getTime() && 基.getTime() <= 现在.getTime() - 超时提醒分钟 * 分;
}

/** 建的人建档那一刻随手记的那条（分配后沟通过的 不算它；销售自建的由 负责人跟过的 算上）：建的人记的、和项目建档相差不到 建档随手记秒 秒 */
export const 建档随手记 = (f: { ownerId: string; createdAt: Date }, p: { creatorId: string; createdAt: Date }): boolean =>
  f.ownerId === p.creatorId && Math.abs(f.createdAt.getTime() - p.createdAt.getTime()) < 建档随手记秒 * 1000;
/**
 * 顺延后重新计时（11-22）：落在不执行时段的时刻 → 下一个工作日 08:00（重新起算的那一刻）；能执行的原样。
 * 和 顺延到可执行 同一个算法，单独起名是为了读的人分得清：这一刻是「重新起算」，不是「顺延着执行」
 */
export const 重新起算于 = (t: Date): Date => 顺延到可执行(t);

/**
 * 计时起点 → 超时提醒该发的时刻（11-22 顺延后重新计时）：
 *   - 起点落在不执行时段（夜里、周末、法定节假日分来 / 接手）= 从下一个工作日 08:00 起算
 *   - 起算 + 1 小时落在不执行时段（如 21:30 分来）= 下一个工作日 08:00 重新起算，09:00 提醒
 *   - 都在工作时段 = 起点 + 1 小时，照旧
 */
export function 超时提醒到期(起点: Date): Date {
  const 到 = new Date(重新起算于(起点).getTime() + 超时提醒分钟 * 分);
  return 不执行(到) ? new Date(重新起算于(到).getTime() + 超时提醒分钟 * 分) : 到;
}

/**
 * 超时提醒发出以后下一步（11-22 顺延后重新计时）：
 *   - 提醒 + 30 分钟在工作时段 = 到点转（种 转）
 *   - 提醒 + 30 分钟落在不执行时段（如 21:45 提醒、22:15 该转）= 不顺延着转：下一个工作日 08:00（重计于）重新起算，
 *     09:00 再发一次超时提醒（种 再提醒，正文注明顺延后重新计时）；那次提醒发出后照这里再算一遍 = 09:30 转
 */
export type 转出安排 = { 种: "转"; 时: Date } | { 种: "再提醒"; 时: Date; 重计于: Date };
export function 超时转出安排(提醒于: Date): 转出安排 {
  const 到 = new Date(提醒于.getTime() + 超时转出分钟 * 分);
  if (!不执行(到)) return { 种: "转", 时: 到 };
  const 重计于 = 重新起算于(到);
  return { 种: "再提醒", 时: new Date(重计于.getTime() + 超时提醒分钟 * 分), 重计于 };
}

/**
 * 超时提醒实际发出的时刻 → 预计自动转走的时刻（提醒正文「X 前还没记就转」、首页放弃条倒计时用）：
 * 转出要重新计时的 = 重新计时那天 09:00 再提醒 + 30 分钟 = 09:30
 */
export function 超时转出到期(提醒于: Date): Date {
  const 安排 = 超时转出安排(提醒于);
  return 安排.种 === "转" ? 安排.时 : new Date(安排.时.getTime() + 超时转出分钟 * 分);
}

/**
 * 现在该走哪一步：夜里、周末、法定节假日什么都不做；没发超时提醒 → 到期就提醒；发过 → 到期就转，
 * 转出落在不执行时段的 → 下一个工作日 09:00 再提醒（再提醒），再过 30 分钟才转（见 超时转出安排）
 */
export function 该做(s: { since: Date; overdueAt: Date | null }, 现在: Date): "提醒" | "再提醒" | "转" | null {
  if (不执行(现在)) return null;
  if (!s.overdueAt) return 现在.getTime() >= 超时提醒到期(s.since).getTime() ? "提醒" : null;
  const 安排 = 超时转出安排(s.overdueAt);
  return 现在.getTime() >= 安排.时.getTime() ? 安排.种 : null;
}

/** 库里存的「这一轮超时过的人」 */
export function 读试过(json: string | null | undefined): string[] {
  try {
    const v: unknown = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [];
  } catch {
    return [];
  }
}

/** 这一轮挑人时排除谁：超时过的 + 现负责人 */
export const 本轮排除 = (试过: readonly string[], 现负责人: string): string[] => [...new Set([...试过, 现负责人])];

/** 规则 3：客户怎么办。客户在公海 / 已归接手人 / 归别人（不是原负责人）= 不动 */
export type 客户去向 = "跟着走" | "留给原负责人" | "不动";
export function 客户怎么办(客户: { salesOwnerId: string; 在公海: boolean }, 原: string, 新: string, 原手上别的进行中: number): 客户去向 {
  if (客户.在公海 || 客户.salesOwnerId === 新 || 客户.salesOwnerId !== 原) return "不动";
  return 原手上别的进行中 > 0 ? "留给原负责人" : "跟着走";
}

/** 项目页那句提示（规则 3 的例外）：客户不归这条项目的负责人时；文字在 time-fields.ts（浏览器也用） */
export { 客户在谁名下话 };

export type 超时转明细 = { 提醒: number; 转出: number; 没转成: number; 停: number };

/**
 * 是不是分出去的（第 1 题 B，见文件头）：负责人不是建的人 = 别人给他的（指定、自动、定时、超时转、转让）；
 * 负责人就是建的人，但有一行把它分给他的分配记录（比如分出去又分回来）也算；别人从线索公海分给他的（pool-claim 留痕、操作人不是他，
 * 管理从公海分配不写分配记录，总控 11-20 定「管理从线索公海分配给销售要起算」）也算。都不是 = 自留 / 个人自持
 */
export const 是分来的 = (p: { ownerId: string; creatorId: string }, 有分给他的记录: boolean): boolean => p.ownerId !== p.creatorId || 有分给他的记录;

/** 别人从公海分给他的那行（pool-claim、到 = 他、操作人不是他） */
const 公海分给他 = (l: { kind: string; userId: string; toOwnerId: string | null }, 他: string): boolean => l.kind === "pool-claim" && l.toOwnerId === 他 && l.userId !== 他;

/** 市场成员（市场管理 / 渠道运营、不兼销售）自己留着的：负责人就是建的人、是市场成员 —— 不计时、不转（只看有没有分回来的记录） */
export const 市场自留 = (org: 组织, p: { ownerId: string; creatorId: string }): boolean => p.ownerId === p.creatorId && 是市场成员of(org, p.ownerId);

/** 负责人是销售（业务角色有 sales，兼着别的角色也算；只认业务角色，assign-line.ts 只留销售 同一道）：自建、自领才计时（11-20 S4） */
export const 是销售 = (org: Pick<组织, "成员">, id: string): boolean => !!id && 只留销售(org, [id]).length > 0;

/**
 * 历史数据起算也不收的自留：市场成员自留的；不是销售（总管理、系统管理员、销售管理、没设业务角色）自己建给自己、不是导入的
 * （自建只对销售计时，Even「销售进行新增」）
 */
const 自留不计 = (org: 组织, p: { ownerId: string; creatorId: string }, 导入的: boolean): boolean =>
  市场自留(org, p) || (p.ownerId === p.creatorId && !导入的 && !是销售(org, p.ownerId));

/**
 * 这几条项目里哪些是导入 / 同步建的（P-转-41「导入不起算」）：商机表建的写了 EntExternalRef（opportunity），线索表带出的只写 EntImportRow
 * （opportunity、create）。每分钟一遍：先查 EntExternalRef，查不到的那几条再查 EntImportRow（两张表都有 [entity, targetId] 索引，迁移 159）
 */
async function 导入建的of(ids: readonly string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const 对照 = new Set((await prisma.entExternalRef.findMany({ where: { entity: "opportunity", targetId: { in: [...ids] } }, select: { targetId: true } })).map((r) => r.targetId));
  const 余 = ids.filter((id) => !对照.has(id));
  if (!余.length) return 对照;
  const 导入行 = await prisma.entImportRow.findMany({ where: { entity: "opportunity", kind: "create", targetId: { in: 余 } }, select: { targetId: true } });
  return new Set([...对照, ...导入行.map((r) => r.targetId)]);
}

/** 到点转不转：除了市场成员自留的都转（用户 11-20「包括」）；市场成员自留、但有人分回给他的照旧算分来 */
async function 可转of(org: 组织, p: { id: string; ownerId: string; creatorId: string }): Promise<boolean> {
  if (!市场自留(org, p)) return true;
  return 分来的of(p);
}

async function 分来的of(p: { id: string; ownerId: string; creatorId: string }): Promise<boolean> {
  if (p.ownerId !== p.creatorId) return true;
  const [分, 公海] = await Promise.all([
    prisma.entLeadAssign.findFirst({ where: { projectId: p.id, toUserId: p.ownerId }, select: { id: true } }),
    prisma.projectNodeLog.findFirst({ where: { projectId: p.id, kind: "pool-claim", toOwnerId: p.ownerId, userId: { not: p.ownerId } }, select: { id: true } }),
  ]);
  return 是分来的(p, !!分 || !!公海);
}

/** 超时提醒里那句（11-20）：只认负责人本人记的，别人（同事、管理、市场）代记不算 */
export const 本人记话 = "需负责人本人记录有效沟通";
/**
 * 紧跟 本人记话 的半句（F-052）：说清什么算有效沟通。「无意义沟通不能保存」开着（默认）说太短的存不进去、占位词能存但不算，关着说字数和占位词。
 * 站内和飞书同一条正文（notify 一份 body），去重键不变
 */
export const 有效沟通标准话 = (拦: boolean): string =>
  拦 ? "（写清沟通内容：太短的存不进去；只写「跟进」「已联系」这类的能存但不算）" : `（写清沟通内容，中文至少 ${有效沟通最少字数} 个字；「跟进」「已联系」这类不算）`;
/** 自留、自持的超时提醒那句（不说会自动收回） */
export const 自留超时话 = "这条是你自己留着跟的，不会自动转走，请尽快联系客户并记一条有效沟通";

const 链上列 = {
  id: true, name: true, ownerId: true, creatorId: true, customerId: true, createdAt: true, replyStartAt: true, replyEndAt: true,
  replyOverdue: { select: { anchorAt: true, holderId: true, since: true, overdueAt: true, tried: true, transfers: true, stoppedAt: true, updatedAt: true } },
} as const;
type 链行 = {
  id: string; name: string; ownerId: string; creatorId: string; customerId: string; createdAt: Date; replyStartAt: Date | null; replyEndAt: Date | null;
  replyOverdue: { anchorAt: Date; holderId: string; since: Date; overdueAt: Date | null; tried: string; transfers: number; stoppedAt: Date | null; updatedAt: Date } | null;
};
/** 链上的一条：算好的超时基准；按分配 = 没填指定回复时间、按分配时刻起算的那种；历史 = 按历史数据起算进的链（基 = 历史基准） */
type 链项目 = 链行 & { 基: Date; 按分配: boolean; 历史?: boolean };

type 换人记录 = { 痕of: Map<string, 换人痕[]>; 分配of: Map<string, 分配行[]>; 客户换人of: Map<string, 客户换人[]> };
/** 一组项目的换人留痕、分配记录（按项目分好），和它们客户的换负责人记录（按客户分好，只要 从 以后的：认跟着客户带过去的那几行） */
async function 换人记录of(们: readonly { id: string; customerId: string }[], 从: Date): Promise<换人记录> {
  const 痕of = new Map<string, 换人痕[]>(), 分配of = new Map<string, 分配行[]>(), 客户换人of = new Map<string, 客户换人[]>();
  if (!们.length) return { 痕of, 分配of, 客户换人of };
  const ids = 们.map((p) => p.id);
  const [痕们, 分配们, 客户们] = await Promise.all([
    prisma.projectNodeLog.findMany({
      where: { projectId: { in: [...ids] }, kind: { in: ["transfer", "pool-claim"] } },
      select: { projectId: true, kind: true, userId: true, reason: true, fromOwnerId: true, toOwnerId: true, at: true },
    }),
    prisma.entLeadAssign.findMany({ where: { projectId: { in: [...ids] } }, select: { projectId: true, toUserId: true, byUserId: true, createdAt: true } }),
    prisma.customerOwnerLog.findMany({ where: { customerId: { in: [...new Set(们.map((p) => p.customerId))] }, at: { gte: 从 } }, select: { customerId: true, toOwnerId: true, at: true, kind: true, userId: true } }),
  ]);
  for (const { projectId, ...l } of 痕们) 痕of.set(projectId, [...(痕of.get(projectId) ?? []), l]);
  for (const { projectId, ...a } of 分配们) if (projectId) 分配of.set(projectId, [...(分配of.get(projectId) ?? []), a]);
  for (const { customerId, ...c } of 客户们) 客户换人of.set(customerId, [...(客户换人of.get(customerId) ?? []), c]);
  return { 痕of, 分配of, 客户换人of };
}

/**
 * 该看的项目：在管的范围里，且（链还在走，或超时基准在起链窗口里、还没起链 / 链停了但基准变了 = 新的一次约定或新的一次分配，整条重来）。
 * 没基准的 = 还在走、但现在算不出基准的链（清了指定回复时间、又没有分配基准），或基准早于生效时刻的（见文件头「生效范围」），调用方停掉
 */
async function 链上的(现在: Date, 生效: Date, 历史: Date | null, org: 组织): Promise<{ 们: 链项目[]; 没基准的: string[] }> {
  const 早 = 往回看起点(现在, 起链往回看天);
  const 晚 = new Date(现在.getTime() - 超时提醒分钟 * 分);
  const 分配早 = 往回看起点(现在, 分配起链往回看天);
  const 没在走 = { OR: [{ replyOverdue: { is: null } }, { replyOverdue: { is: { stoppedAt: { not: null } } } }] };
  const 行们: 链行[] = await prisma.project.findMany({
    where: {
      phase: "线索", result: null, pooledAt: null, awaitAssignAt: null, customer: { pool: null },
      OR: [
        { replyOverdue: { is: { stoppedAt: null } } },
        { AND: [没在走, { replyEndAt: { gte: 早, lte: 晚 } }] },
        { AND: [没在走, { replyEndAt: null, replyStartAt: { gte: 早, lte: 晚 } }] },
        // 按分配：这几天里有过转让 / 公海分配留痕、或这几天里建的（新建时直接给销售只有分配记录）；准的下面按 分配基准 再判。
        // 填了指定回复时间的也收（11-20 审查）：生效后新分配、带着生效前旧回复时间的改按分配（下面），旧回复时间早过了 3 天也得进得来
        {
          AND: [没在走, {
            OR: [{ logs: { some: { kind: { in: ["transfer", "pool-claim"] }, at: { gte: 分配早, lte: 晚 } } } }, { createdAt: { gte: new Date(分配早.getTime() - 分), lte: 晚 } }],
          }],
        },
      ],
    },
    orderBy: { id: "asc" },
    select: 链上列,
  });
  // 历史数据起算（见文件头）：有负责人、不在公海、不在待分配、不是市场成员自留的（分来的、自建的、领取的、导入的都收）、
  // 还没有链的（或链停了、基准早于历史起算）线索，一遍最多 历史一批 条，
  // 按项目 id 接着上一遍往后取、取完从头再来（还没到点的、不够格的不会一直占着名额）
  if (历史) {
    const 有了 = new Set(行们.map((p) => p.id));
    const ids = await 历史候选(历史基准(历史, 生效, new Date(0)));
    const 新的 = ids.filter((id) => !有了.has(id));
    if (新的.length) 行们.push(...(await prisma.project.findMany({ where: { id: { in: 新的 } }, orderBy: { id: "asc" }, select: 链上列 })));
  }
  // 按时、按分配都要分配基准（按时的也只计生效以后新分配 / 自建 / 自领的，11-20），一起读
  const { 痕of, 分配of, 客户换人of } = await 换人记录of(行们, new Date(分配早.getTime() - 天));
  const 导入 = await 导入建的of(行们.filter((p) => !!p.ownerId && p.ownerId === p.creatorId).map((p) => p.id));
  const 们: 链项目[] = [], 没基准的: string[] = [];
  for (const p of 行们) {
    const 行 = p.replyOverdue;
    const 在走 = !!行 && !行.stoppedAt;
    const { 基, 按分配, 历史的 } = 算链基(p, { 痕of, 分配of, 客户换人of }, 导入.has(p.id), org, 生效, 历史);
    // 生效时刻以前的分配 / 约定不计时（11-20 事故）：还在走的停掉
    if (!基 || 基.getTime() < 生效.getTime()) {
      if (在走) 没基准的.push(p.id);
      continue;
    }
    // 停了的链：基准没变的不再看；没在走的都得在起链窗口里（历史的不看窗口）
    if (!在走 && ((行 && 行.anchorAt.getTime() === 基.getTime()) || (!历史的 && !在起链窗口(基, 按分配, 现在)))) continue;
    们.push({ ...p, 基, 按分配, ...(历史的 ? { 历史: true } : {}) });
  }
  return { 们, 没基准的 };
}

/**
 * 一条项目的超时基准（链上的 每条都这样算，首页「离超时还剩多久」超时时限们 同一份）：
 * 按时 = 指定回复时间；没填 / 生效前的旧时间 = 按分配（分配基准）；算不出、早于生效时刻的按历史起算（开了的话）。
 * 基 = null = 不计时。调用方再判「早于生效时刻」「停了的链基准没变」「起链窗口」
 */
function 算链基(p: 链行, 记录: 换人记录, 导入的: boolean, org: 组织, 生效: Date, 历史: Date | null): { 基: Date | null; 按分配: boolean; 历史的: boolean } {
  const 行 = p.replyOverdue;
  const 在走 = !!行 && !行.stoppedAt;
  const 痕 = 记录.痕of.get(p.id) ?? [], 分 = 记录.分配of.get(p.id) ?? [];
  const 分起 = 分配基准(p, 痕, 分, 记录.客户换人of.get(p.customerId) ?? [], 是销售(org, p.ownerId), 导入的);
  let 基 = 超时基准(p);
  let 按分配 = !基;
  if (!基) {
    // 还在走、按分配起的链：基准钉在起链那一刻（分配、换人、销售自建的建档那一刻），中途手动换人、轮转不重来（走一步 按新负责人接手那刻接着算）
    基 = 行 && 在走 && 是分配时刻(行.anchorAt, 痕, 分, p.createdAt) ? 行.anchorAt : 分起;
  } else if (基.getTime() < 生效.getTime() && 分起 && 分起.getTime() >= 生效.getTime()) {
    // 生效后新分配、带着生效前的旧指定回复时间（分配时不清回复时间，11-20 审查）：旧时间不算，改按分配走（基准 = 分配基准，钉法同上）。
    // 只在旧回复时间早于生效时刻时改：生效以后约的回复时间照旧按时（分配晚于它的从接手那刻算，「往回看 7 天」那条用例）
    基 = 行 && 在走 && 是分配时刻(行.anchorAt, 痕, 分, p.createdAt) ? 行.anchorAt : 分起;
    按分配 = true;
  } else if (在走 ? !!分起 && 分起.getTime() < 生效.getTime() : !分起 || 分起.getTime() < 生效.getTime()) {
    // 按时（填了指定回复时间）也只计生效以后被分配 / 销售自建 / 销售自领的（11-20 Even 两步走第一步）：分配基准算不出或早于生效时刻 = 不计时。
    // 还在走的链只在算得出、且早于生效时刻时停（轮转、中途换人以后算不出 = 照走，同按分配钉住基准）
    基 = null;
  }
  // 历史数据起算（见文件头）：基准算不出、或早于生效时刻的线索，按历史基准、按分配那一套走；不受起链窗口限制
  const 历史的 = !!历史 && (!基 || 基.getTime() < 生效.getTime()) && !!p.ownerId && !自留不计(org, p, 导入的);
  if (历史的) {
    基 = 历史基准(历史!, 生效, p.createdAt);
    按分配 = true;
  }
  return { 基, 按分配, 历史的 };
}

/** 首页「离超时还剩多久」：超时 = 到这一刻还没记有效沟通就发超时提醒；转走 = 已发超时提醒，到这一刻自动转走 */
export type 超时时限 = { 种: "超时" | "转走"; 截止: Date };

/**
 * 这几条（同一位负责人手上的线索）离超时还剩多久（主动放弃首页置顶条用，lead-giveup.ts 我能放弃的，11-21）。只读，查询次数和条数无关。
 *   - 超时转关着 = 空
 *   - 链在走、持有人是现负责人：没发超时提醒 = 计时起点 + 1 小时；发过 = 提醒时刻 + 30 分钟（落在夜里、周末、法定节假日的，
 *     下一个工作日 08:00 重新计时：提醒 09:00、转走 09:30，见 超时提醒到期 / 超时转出到期）
 *   - 还没起链（钟一分钟扫一遍，到点才写链）/ 链停了基准变了：基准同 链上的（算链基），早于生效时刻 = 不计时；
 *     计时起点 = 基准和 接手于（这位负责人接手那一刻）取晚的（同 走一步 新起链）
 *   - 链在走、持有人换了（手动换人还没扫到）：从 接手于 起算
 */
export async function 超时时限们(们: readonly { id: string; 接手于: Date }[], 现在: Date = new Date()): Promise<Map<string, 超时时限>> {
  const 结果 = new Map<string, 超时时限>();
  if (!们.length || !企业版() || !(await 超时自动转开着())) return 结果;
  const 接手of = new Map(们.map((x) => [x.id, x.接手于]));
  const 行们: 链行[] = await prisma.project.findMany({ where: { id: { in: 们.map((x) => x.id) } }, select: 链上列 });
  const [生效, 历史, org, 记录, 导入] = await Promise.all([
    超时转生效时刻(现在), 历史起算时刻(现在), 读组织于(prisma), 换人记录of(行们, 往回看起点(现在, 分配起链往回看天 + 1)),
    导入建的of(行们.filter((p) => !!p.ownerId && p.ownerId === p.creatorId).map((p) => p.id)),
  ]);
  for (const p of 行们) {
    const 行 = p.replyOverdue;
    const 接手 = 接手of.get(p.id) ?? 现在;
    if (行 && !行.stoppedAt) {
      if (行.holderId !== p.ownerId) 结果.set(p.id, { 种: "超时", 截止: 超时提醒到期(接手) });
      else 结果.set(p.id, 行.overdueAt ? { 种: "转走", 截止: 超时转出到期(行.overdueAt) } : { 种: "超时", 截止: 超时提醒到期(行.since) });
      continue;
    }
    const { 基 } = 算链基(p, 记录, 导入.has(p.id), org, 生效, 历史);
    if (!基 || 基.getTime() < 生效.getTime()) continue;
    if (行 && 行.anchorAt.getTime() === 基.getTime()) continue; // 停了的链、基准没变：不再计时
    结果.set(p.id, { 种: "超时", 截止: 超时提醒到期(new Date(Math.max(基.getTime(), 接手.getTime()))) });
  }
  return 结果;
}

/** 历史候选接着往后取的位置（进程里记着；多进程只一个进程跑钟） */
let 历史游标 = "";
/**
 * 历史数据起算的候选（裸 SQL，两列比较 Prisma 写不出）：线索阶段、没结局、不在公海（项目和客户）、不在待分配、没删、
 * 有负责人、还没有链或链停了且基准早于 早于（历史起算）；市场成员自留的在 链上的 里排掉。按 id 接着游标取 历史一批 条，取不满下一遍从头
 */
async function 历史候选(早于: Date): Promise<string[]> {
  const 取 = (从: string) => prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT p.id FROM "Project" p LEFT JOIN "EntReplyOverdue" r ON r."projectId" = p.id
     WHERE p.id > ? AND p."phase" = '线索' AND p."result" IS NULL AND p."pooledAt" IS NULL AND p."awaitAssignAt" IS NULL AND p."deletedAt" IS NULL
       AND p."ownerId" <> ''
       AND NOT EXISTS (SELECT 1 FROM "CustomerPool" cp WHERE cp."customerId" = p."customerId")
       AND (r."projectId" IS NULL OR (r."stoppedAt" IS NOT NULL AND r."anchorAt" < ?))
     ORDER BY p.id LIMIT ?`,
    从, 早于.getTime(), 历史一批,
  );
  let 行 = await 取(历史游标);
  if (!行.length && 历史游标) 行 = await 取("");
  历史游标 = 行.length < 历史一批 ? "" : 行[行.length - 1].id;
  return 行.map((r) => r.id);
}

/**
 * 出了管的范围（进公海、有结局、转了商机、客户进公海、进回收站）的链就此停下：以后领回来、恢复了也不接着转，
 * 不然公海里放了几天的线索一被领走就 1.5 小时后又转走。清了指定回复时间的不在这里停：改按分配（11-20），
 * 算不出分配基准的才停（链上的 没基准的）
 */
async function 停掉出圈的(现在: Date): Promise<void> {
  await prisma.entReplyOverdue.updateMany({
    where: {
      stoppedAt: null,
      project: { OR: [{ pooledAt: { not: null } }, { result: { not: null } }, { phase: { not: "线索" } }, { customer: { pool: { isNot: null } } }] },
    },
    data: { stoppedAt: 现在 },
  });
  await 看已删(() => prisma.entReplyOverdue.updateMany({ where: { stoppedAt: null, project: { deletedAt: { not: null } } }, data: { stoppedAt: 现在 } }));
}

/** 这位负责人什么时候接手的：最近一行把项目转给他的留痕；没有 = null */
async function 接手时刻(projectId: string, ownerId: string): Promise<Date | null> {
  const r = await prisma.projectNodeLog.findFirst({
    where: { projectId, kind: { in: ["transfer", "pool-claim"] }, toOwnerId: ownerId },
    orderBy: { at: "desc" },
    select: { at: true },
  });
  return r?.at ?? null;
}

/** 链写回去：一个项目一行 */
async function 记链(projectId: string, data: { anchorAt: Date; holderId: string; since: Date; overdueAt: Date | null; tried?: string[]; transfers?: number; stoppedAt?: Date | null }) {
  const { tried, ...别的 } = data;
  const 行 = { ...别的, ...(tried ? { tried: JSON.stringify(tried) } : {}) };
  await prisma.entReplyOverdue.upsert({ where: { projectId }, create: { projectId, ...行 }, update: 行 });
}

/**
 * 链写回去，但只在库里这一行的持有人还是 持有人 时才改（没有这一行就建）。扫描读完链到写回之间，负责人点了「主动放弃」
 * （lead-giveup.ts 已经把链改成接手人）时，拿着旧持有人写不进去，不把接手人的计时覆盖掉。回写没写上
 */
export async function 改链若持有人是(
  projectId: string, 持有人: string,
  data: { anchorAt: Date; holderId: string; since: Date; overdueAt: Date | null; tried?: string[]; transfers?: number; stoppedAt?: Date | null; updatedAt?: Date },
): Promise<boolean> {
  const { tried, ...别的 } = data;
  const 行 = { ...别的, ...(tried ? { tried: JSON.stringify(tried) } : {}) };
  if ((await prisma.entReplyOverdue.updateMany({ where: { projectId, holderId: 持有人 }, data: 行 })).count === 1) return true;
  if (await prisma.entReplyOverdue.findUnique({ where: { projectId }, select: { projectId: true } })) return false;
  try {
    await prisma.entReplyOverdue.create({ data: { projectId, ...行 } });
    return true;
  } catch {
    return false; // 同一刻别人建了这一行
  }
}

/** 这条线索上主动放弃过的人（lead-giveup.ts，EntLeadGiveUp）：超时转、再放弃挑人时都不给回他们（开新一轮也不给） */
export async function 放弃过的人(projectId: string): Promise<string[]> {
  return [...new Set((await prisma.entLeadGiveUp.findMany({ where: { projectId }, select: { userId: true } })).map((r) => r.userId))];
}

/**
 * 这条线索现在的负责人会不会按超时转计时（主动放弃转出后，接手人通知里要不要写「1 小时内记有效沟通」用）：
 * 开关开着、分配基准（同 链上的：超时转、放弃转那几行跳过）算得出、且不早于生效时刻。只读、看全部
 */
export async function 会按超时计时(projectId: string, 现在: Date = new Date()): Promise<boolean> {
  if (!企业版() || !(await 超时自动转开着())) return false;
  return 看全部(async () => {
    const p = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, ownerId: true, creatorId: true, customerId: true, createdAt: true } });
    if (!p) return false;
    const [org, 记录, 导入, 生效] = await Promise.all([
      读组织于(prisma), 换人记录of([p], new Date(0)), 导入建的of(p.ownerId === p.creatorId ? [p.id] : []), 超时转生效时刻(现在),
    ]);
    const 基 = 分配基准(p, 记录.痕of.get(p.id) ?? [], 记录.分配of.get(p.id) ?? [], 记录.客户换人of.get(p.customerId) ?? [], 是销售(org, p.ownerId), 导入.has(p.id));
    return !!基 && 基.getTime() >= 生效.getTime();
  });
}

/** 同一条同一个原因的「没转成」日志只记一次（钟一分钟一遍，别刷屏） */
const 记过没转成 = new Map<string, string>();
function 记没转成(projectId: string, 为什么: string) {
  if (记过没转成.get(projectId) === 为什么) return;
  记过没转成.set(projectId, 为什么);
  console.warn(`[超时自动转] ${projectId} 这次没转成，留在现负责人手上，下一遍再试：${为什么}`);
}

/** 扫一遍，回各做了几样。从不抛 */
export async function 超时转扫一遍(现在: Date = new Date()): Promise<超时转明细> {
  const 明细: 超时转明细 = { 提醒: 0, 转出: 0, 没转成: 0, 停: 0 };
  if (!企业版() || 不执行(现在)) return 明细;
  try {
    if (!(await 超时自动转开着())) return 明细;
    if (await 视图中跳过()) return 明细;
    await 看全部(async () => {
      await 停掉出圈的(现在);
      const 生效 = await 超时转生效时刻(现在, true);
      const org = await 读组织于(prisma);
      const { 们, 没基准的 } = await 链上的(现在, 生效, await 历史起算时刻(现在), org);
      if (没基准的.length) await prisma.entReplyOverdue.updateMany({ where: { projectId: { in: 没基准的 }, stoppedAt: null }, data: { stoppedAt: 现在 } });
      if (!们.length) return;
      const 回了 = await 记过有效沟通的(们);
      // 一次读全部待裁定行、内存匹配（不按项目各查一次）；库里一条都没有 = 空数组
      const 待裁定们 = await 读全部待裁定行(prisma);
      for (const p of 们) {
        try {
          await 走一步(p, 回了.has(p.id), 现在, 明细, org, 待裁定们);
        } catch (e) {
          明细.没转成++;
          console.error(`[超时自动转] ${p.id} 出错，下一遍再试`, e);
        }
      }
    });
  } catch (e) {
    console.error("[超时自动转] 这一遍没扫成，下一遍再试", e);
  }
  return 明细;
}

/** 钟上调的（每分钟一遍）：同上 */
export const 钟上超时自动转 = 超时转扫一遍;

/** 盘点一条（只读）：下一遍扫到它会做什么。分来 = 是不是分出去的（不是 = 到点只提醒、不转） */
export type 盘点行 = { id: string; ownerId: string; 按分配: boolean; 基: Date; since: Date; 回了: boolean; 分来: boolean; 起链: boolean; 下一步: "提醒" | "再提醒" | "转" | null };

/**
 * 只读盘点（上线前数影响面、3703 实操核对用）：现在这一刻在链上的项目、各自基准、记没记过有效沟通、下一遍会走哪一步。
 * 不写库、不发通知；夜里、周末、节假日、开关关着照样算（下一步按下一个能执行的时刻算）。起链 = 还没有在走的链（这一遍会新起）
 */
export async function 盘点超时链(现在: Date = new Date()): Promise<盘点行[]> {
  return 看全部(async () => {
    const org = await 读组织于(prisma);
    const { 们 } = await 链上的(现在, await 超时转生效时刻(现在), await 历史起算时刻(现在), org);
    const 回了 = await 记过有效沟通的(们);
    const 白天 = 顺延到可执行(现在);
    const 行们: 盘点行[] = [];
    for (const p of 们) {
      // 同 走一步：基准对不上 = 整行重来；负责人和链上的对不上 = 别人手动换了人，从他接手那刻算
      const 行 = p.replyOverdue && p.replyOverdue.anchorAt.getTime() === p.基.getTime() && !p.replyOverdue.stoppedAt ? p.replyOverdue : null;
      let since: Date, overdueAt: Date | null = null;
      if (!行) {
        const 接 = await 接手时刻(p.id, p.ownerId);
        since = 接 && 接.getTime() > p.基.getTime() ? 接 : p.基;
      } else if (行.holderId !== p.ownerId) {
        since = (await 接手时刻(p.id, p.ownerId)) ?? 现在;
      } else {
        since = 行.since; overdueAt = 行.overdueAt;
      }
      const 分来 = await 可转of(org, p);
      const 步 = 回了.has(p.id) ? null : 该做({ since, overdueAt }, 白天);
      // 不是分来的（自留）只提醒不转：转、为转出重新计时的再提醒都不会走
      行们.push({ id: p.id, ownerId: p.ownerId, 按分配: p.按分配, 基: p.基, since, 回了: 回了.has(p.id), 分来, 起链: !行, 下一步: (步 === "转" || 步 === "再提醒") && !分来 ? null : 步 });
    }
    return 行们;
  });
}

/**
 * 开关从关拨到开时调（settings/org-actions.ts 设规则）：重新生效——生效时刻记成现在，还在走的链（没停的）全停，
 * 只对打开以后新分配的（按时：指定回复时间在打开以后的）计时（11-20 用户定「只对上线后新分配的计时」）。
 * 不然打开那一分钟会把关着期间、打开以前分的一口气提醒、转走。
 * 只动生效时刻和链，不动项目、负责人；回停了几条。出错只记日志、回 0，不挡开关本身
 */
export async function 超时转重新起算(现在: Date = new Date()): Promise<number> {
  try {
    // 已经设了将来的生效时刻（两步走第一步：先开开关、到点才计时）：留着它，不改成打开这一刻
    const 原 = await getSetting<unknown>(超时转生效key);
    const 原时 = typeof 原 === "string" ? new Date(原) : null;
    if (!原时 || Number.isNaN(原时.getTime()) || 原时.getTime() <= 现在.getTime()) await setSetting(超时转生效key, 现在.toISOString());
    return (await 看全部(() => prisma.entReplyOverdue.updateMany({ where: { stoppedAt: null }, data: { stoppedAt: 现在 } }))).count;
  } catch (e) {
    console.error("[超时自动转] 重新打开时没重新计时", e);
    return 0;
  }
}

async function 走一步(p: 链项目, 回了: boolean, 现在: Date, 明细: 超时转明细, org: 组织, 待裁定们: readonly 待裁定行[] = []): Promise<void> {
  const 基 = p.基;
  let 行 = p.replyOverdue;
  // 基准变了（改过指定回复时间、从空填上 / 清空换了起算方式、停了的按分配链又分了一次，含停了的链）：整行重来（按新基准算，还没到的这一遍不动）
  if (行 && 行.anchorAt.getTime() !== 基.getTime()) {
    await prisma.entReplyOverdue.deleteMany({ where: { projectId: p.id } });
    行 = null;
    if (!p.历史 && !在起链窗口(基, p.按分配, 现在)) return;
  }
  if (回了) {
    await 记链(p.id, { anchorAt: 基, holderId: p.ownerId, since: 行?.since ?? 基, overdueAt: 行?.overdueAt ?? null, stoppedAt: 现在 });
    明细.停++;
    return;
  }
  // 眼下这一位从什么时候算
  let since: Date, overdueAt: Date | null, 试过: string[], transfers: number;
  if (!行) {
    const 接 = await 接手时刻(p.id, p.ownerId);
    since = 接 && 接.getTime() > 基.getTime() ? 接 : 基;
    overdueAt = null; 试过 = []; transfers = 0;
  } else if (行.holderId !== p.ownerId) {
    // 别人手动换了负责人：从新负责人接手那刻重新计时
    since = (await 接手时刻(p.id, p.ownerId)) ?? 现在;
    overdueAt = null; 试过 = 读试过(行.tried); transfers = 行.transfers;
    await 记链(p.id, { anchorAt: 基, holderId: p.ownerId, since, overdueAt: null });
  } else {
    since = 行.since; overdueAt = 行.overdueAt; 试过 = 读试过(行.tried); transfers = 行.transfers;
  }
  // 12-22 审查 M5（口径 B3）：这条项目（或随客户转走的那次）有转让异议在「待裁定」时，不提醒、不转，计时停表：
  // 每一遍把「这一遍里停着的那段」加到起点和提醒记号上（已走的时长不变），裁定完（维持 / 撤回）后接着走，不清零
  // 停表起点 = 这一遍之前最后一次写这行的时刻（updatedAt），不早于挡着它的最早那条异议提交的时刻、也不早于起点
  const 挡 = 待裁定们.length ? 挡着项目的异议(待裁定们, { id: p.id, customerId: p.customerId, ownerId: p.ownerId }) : [];
  if (挡.length) {
    const 上次写 = 行 && 行.updatedAt.getTime() <= 现在.getTime() ? 行.updatedAt.getTime() : 0;
    const 停于 = Math.max(上次写, Math.min(...挡.map((r) => r.createdAt.getTime())), since.getTime());
    const 停了 = Math.max(0, 现在.getTime() - 停于);
    await 改链若持有人是(p.id, p.ownerId, {
      anchorAt: 基, holderId: p.ownerId, since: new Date(since.getTime() + 停了), overdueAt: overdueAt ? new Date(overdueAt.getTime() + 停了) : null, tried: 试过, transfers,
      updatedAt: 现在, // 记下这一遍停到哪：下一遍只加新停的这一段
    });
    明细.停++;
    return;
  }
  const 步 = 该做({ since, overdueAt }, 现在);
  if (!步) return;
  // 市场成员自留的只提醒本人、不转（第 1 题 B；销售自建、自领的用户 11-20 改成照转）：链留着（首页待办照标超时），换了负责人再按新的人算
  const 分来 = await 可转of(org, p);
  // 再提醒 = 转出落在不执行时段、下一个工作日 08:00 重新计时后的那次提醒（11-22）；自留的本来就不转，不用为转出重新计时
  if (步 === "再提醒" && !分来) return;
  if (步 === "提醒" || 步 === "再提醒") {
    const 重计于 = 步 === "再提醒" && overdueAt ? 重新起算于(new Date(overdueAt.getTime() + 超时转出分钟 * 分)) : null;
    await 发超时提醒(p, since, since.getTime() !== 基.getTime(), 现在, 分来, 重计于);
    // 按持有人条件写：这一分钟里负责人点了主动放弃、链已改给接手人的，不覆盖
    await 改链若持有人是(p.id, p.ownerId, { anchorAt: 基, holderId: p.ownerId, since, overdueAt: 现在, tried: 试过, transfers });
    明细.提醒++;
  } else if (步 === "转" && 分来) {
    if (await 转出去(p, 基, 试过, transfers, 现在, since)) 明细.转出++;
    else 明细.没转成++;
  }
}

/** 超时提醒里引那条无效沟通的内容最多几个字（多了截断、末尾「…」） */
export const 无效沟通引用字数 = 20;
// 先打码再截断：号码被截掉一半以后 notify() 那层兜底就认不出来了
const 引用 = (内容: string): string => {
  const 字 = Array.from(通知文字打码(内容.replace(/\s+/gu, " ").trim()));
  return 字.length > 无效沟通引用字数 ? `${字.slice(0, 无效沟通引用字数 - 1).join("")}…` : 字.join("");
};
/**
 * 「你 11-24 10:36 记的「加微信」不足 4 个字，不算有效沟通。」（E-259，原因四类同 无效沟通原因of）。
 * 只有链接的不引原文（链接本身没什么可看、还可能带参数），写「那条只有链接」
 */
export function 无效沟通话(f: { 记于: Date; 内容: string; 原因: 无效沟通原因 }, 现在: Date = new Date()): string {
  const 时 = 短时刻(f.记于, 现在);
  if (f.原因 === "只有链接") return `你 ${时} 记的那条只有链接，不算有效沟通。`;
  const 引 = 引用(f.内容);
  return f.原因 === "空" || !引 ? `你 ${时} 记的那条沟通没有文字，不算有效沟通。` : `你 ${时} 记的「${引}」${无效原因话[f.原因]}，不算有效沟通。`;
}

/**
 * 负责人本人在这一位计时以后、挂在这条项目上记过的最近一条无效沟通（E-259）：超时提醒、收回通知里说清它为什么不算。
 * 从 = 这一位的计时起点；按时的从提醒时刻（指定回复时间前 30 分钟）起就算回复（同 已回复的），取早的。
 * 不算沟通的（跟进任务 / 提醒、同号留痕）不提；判定同 是有效沟通（占位词表同一份）。没有 = null
 */
export async function 最近无效沟通of(
  p: 两格 & { id: string; ownerId: string; 按分配: boolean }, 从: Date,
): Promise<{ 记于: Date; 内容: string; 原因: 无效沟通原因 } | null> {
  const 提 = p.按分配 ? null : 回复提醒时刻(p);
  const 起 = 提 && 提.getTime() < 从.getTime() ? 提 : 从;
  const [挂的, 词] = await Promise.all([
    prisma.followUpProject.findMany({
      where: {
        projectId: p.id, node: { not: 同号节点 },
        followUp: { ownerId: p.ownerId, deletedAt: null, createdAt: { gte: 起 }, type: { notIn: [...不是沟通的类型] }, NOT: { title: { startsWith: 同号标题 } } },
      },
      orderBy: { followUp: { createdAt: "desc" } },
      take: 20,
      select: { followUp: { select: { content: true, createdAt: true } } },
    }),
    读占位词(),
  ]);
  for (const { followUp: f } of 挂的) {
    const 原因 = 无效沟通原因of(f.content, { 占位词: 词 });
    if (原因) return { 记于: f.createdAt, 内容: f.content ?? "", 原因 };
  }
  return null;
}

/** 超时提醒 / 收回通知正文里那句（有的话，带句号）；没有、查出错 = 空串，不挡通知 */
async function 无效沟通话of(p: 链项目, since: Date, 现在: Date): Promise<string> {
  try {
    const f = await 最近无效沟通of(p, since);
    return f ? 无效沟通话(f, 现在) : "";
  } catch (e) {
    console.error(`[超时自动转] ${p.id} 没查出无效沟通，正文照旧`, e);
    return "";
  }
}

/**
 * 保存一条新沟通后（E-259）：这条挂的项目正在超时未跟进的链上计时（现负责人本人记的、这一位还在计时：同首页 超时时限们；
 * 线索阶段、没结局、不在公海、不在待分配；负责人还没在这位客户上记过有效沟通——记过的链下一遍就停）、
 * 而这条按 是有效沟通 不算（同号留痕、跟进任务 / 提醒不算沟通，不提），回原因给前端一句提示（tri-state-quota.ts 超时短沟通话）。
 * 不看三态开关；超时转关着、不是企业版、出任何错都回 null（沟通已经存了，不能让提示把保存说成失败）
 */
export async function 超时短沟通提示(followUpId: string | null | undefined, 现在: Date = new Date()): Promise<无效沟通原因 | null> {
  try {
    if (!followUpId || typeof followUpId !== "string" || !企业版() || !(await 超时自动转开着())) return null;
    return await 看全部(async () => {
      const f = await prisma.followUp.findUnique({
        where: { id: followUpId },
        select: {
          ownerId: true, type: true, title: true, content: true, deletedAt: true,
          projectNode: {
            select: {
              node: true,
              project: { select: { id: true, ownerId: true, customerId: true, phase: true, result: true, pooledAt: true, awaitAssignAt: true, deletedAt: true, customer: { select: { pool: { select: { customerId: true } } } } } },
            },
          },
        },
      });
      const 挂 = f?.projectNode;
      if (!f || f.deletedAt || !挂 || 不是沟通的类型.includes(f.type) || (f.title ?? "").startsWith(同号标题) || 挂.node === 同号节点) return null;
      const p = 挂.project;
      if (p.ownerId !== f.ownerId || p.phase !== "线索" || p.result || p.pooledAt || p.awaitAssignAt || p.deletedAt || p.customer.pool) return null;
      const 原因 = 无效沟通原因of(f.content, { 占位词: await 读占位词() });
      if (!原因) return null;
      if (!(await 超时时限们([{ id: p.id, 接手于: 现在 }], 现在)).has(p.id)) return null;
      // 负责人在这位客户上已经记过有效沟通（之前的跟进也算）：链下一遍就停，不说「计时不会停」
      if ((await 负责人跟过的([p])).has(p.id)) return null;
      return 原因;
    });
  } catch {
    return null;
  }
}

/**
 * 超时提醒（站内 + 飞书；首页待办见 reply-notice.ts 待回复客户of）。接手的 = 不是按超时基准起算的那一位（中途接手的）。
 * 按分配的不写「指定回复时间」（11-20）。
 * 重计于（11-22）= 上一次超时提醒后转出落在不执行时段、从这一刻（下一个工作日 08:00）重新计时，这次是重新计时后的提醒：
 * 正文注明，去重键带上它（同一位、同一计时起点的第一次提醒已经用过不带它的键）。
 * 这次提醒 + 30 分钟又落在不执行时段的（停机补跑到 21:45 才发等），正文写明下一个工作日再提醒一次、几点前没记才转
 */
async function 发超时提醒(p: 链项目, since: Date, 接手的: boolean, 现在: Date, 分来 = true, 重计于: Date | null = null) {
  const 安排 = 超时转出安排(现在);
  const 转时 = 短时刻(超时转出到期(现在), 现在);
  const 重计话 = 重计于 ? `上次超时提醒后转出时间落在非工作时段，已顺延到 ${短时刻(重计于, 现在)} 重新计时。` : "";
  const 再提醒话 = 安排.种 === "再提醒" ? `转出时间落在非工作时段，顺延到 ${短时刻(安排.重计于, 现在)} 重新计时、${短时刻(安排.时, 现在)} 再提醒一次，` : "";
  const 头 = 接手的 ? `接手已满 ${超时提醒分钟 / 60} 小时还没记有效沟通`
    : p.历史 ? `这条线索从 ${短时刻(p.基, 现在)} 起按规则计时（你在这位客户上还没有跟进记录），已满 ${超时提醒分钟 / 60} 小时还没记有效沟通`
    : p.按分配 ? `${分配后未跟进话(超时提醒分钟)}（${短时刻(p.基, 现在)} 分给你），还没记有效沟通`
    : `指定回复时间 ${指定回复文字(p.replyStartAt, p.replyEndAt, 现在)} 已过，还没记有效沟通`;
  // 负责人本人在这一位计时以后记过、但不算有效沟通的（E-259）：说清那条为什么不算，不然人以为记过了
  const 无效话 = await 无效沟通话of(p, since, 现在);
  const 本人记 = `${本人记话}${有效沟通标准话(await 规则开着("无意义沟通拦"))}`;
  await notify([p.ownerId], {
    kind: 超时通知种类,
    title: `超时未跟进：${p.name}`,
    body: 分来 ? `${头}。${无效话}${重计话}${本人记}，${再提醒话}${转时} 前还没记，这条线索会自动收回、分给其他成员` : `${头}。${无效话}${本人记}。${自留超时话}`,
    // 发这一刻他还能放弃（11-21）：带 ?giveup=1，飞书、铃铛多一个「放弃（豁免）」
    link: await 带放弃链接(p.ownerId, p.id, `/projects/${encodeURIComponent(p.id)}`, 现在),
    key: `reply-overdue:${p.id}:${p.ownerId}:${since.toISOString()}${重计于 ? `:重计:${重计于.toISOString()}` : ""}`,
  });
}

/** 自动转一次；转成了回 true */
async function 转出去(p: 链项目, 基: Date, 试过: string[], transfers: number, 现在: Date, since: Date): Promise<boolean> {
  const 原 = p.ownerId;
  const 原名 = (await prisma.user.findUnique({ where: { id: 原 }, select: { name: true } }))?.name ?? "原负责人";
  const 附 = `${超时转理由}（原负责人 ${原名} 超时没记有效沟通）`;
  // 这条线索上主动放弃过的人一律不给回（32H，没起链就放弃的不在 试过 里），开新一轮也不给
  const 放弃过 = await 放弃过的人(p.id);
  let 排除 = [...new Set([...本轮排除(试过, 原), ...放弃过])];
  const 新轮排除 = [...new Set([原, ...放弃过])];
  let 新一轮 = false;
  let r = await 超时转出(超时转令牌, 系统操作人, p.id, 原, 排除, 附);
  // 这一轮人人都超时过了：开新一轮，仍不给现负责人
  if (!r.ok && r.挑不到 && 新轮排除.length < 排除.length) {
    新一轮 = true;
    排除 = 新轮排除;
    r = await 超时转出(超时转令牌, 系统操作人, p.id, 原, 排除, 附);
  }
  if (!r.ok) {
    记没转成(p.id, r.error);
    return false;
  }
  记过没转成.delete(p.id);
  const 新 = r.接手人Id;
  // 链先记上（接手人从现在起算），客户、通知出错也不会再转一次
  await 记链(p.id, { anchorAt: 基, holderId: 新, since: 现在, overdueAt: null, tried: 新一轮 ? [原] : 本轮排除(试过, 原), transfers: transfers + 1, stoppedAt: null });
  const 客户 = await 客户随线索(p.id, p.customerId, 原, 新).catch((e) => {
    console.error(`[超时自动转] ${p.id} 客户没跟过去`, e);
    return { 去向: "不动" as 客户去向, 在谁名下: null };
  });
  const 客户名下 = 客户.在谁名下 && 客户.在谁名下 !== 新
    ? (await prisma.user.findUnique({ where: { id: 客户.在谁名下 }, select: { name: true } }))?.name ?? null
    : null;
  await 分配通知(系统操作人, [{ projectId: p.id, toUserId: 新, ...(r.留下 ? { 留下: r.留下 } : {}) }], true, 客户名下 ? `${附}；${客户在谁名下话(客户名下)}` : 附);
  const 客户话 = 客户.去向 === "留给原负责人" ? "；你手上还有这位客户别的项目，客户还在你名下" : 客户.去向 === "跟着走" ? "；客户一起给了接手人" : "";
  // 同超时提醒（E-259）：原负责人记过、但不算有效沟通的那条，说清为什么不算（查不出不挡通知）
  const 无效话 = await 无效沟通话of(p, since, 现在);
  await notify([原], {
    kind: 超时通知种类,
    title: `${收回话}：${p.name}`,
    body: `${p.历史 ? "按规则开始计时以后" : p.按分配 ? "分到你手上以后" : `指定回复时间 ${指定回复文字(p.replyStartAt, p.replyEndAt, 现在)} 过后`}一直没记有效沟通，系统已自动收回，分给了 ${r.接手人}${客户话}${无效话 ? `。${无效话.replace(/。$/u, "")}` : ""}`,
    key: `reply-overdue-out:${p.id}:${原}:${现在.toISOString()}`,
  });
  return true;
}

/**
 * 规则 3：客户跟着线索给接手人；原负责人手上还有这位客户别的进行中项目（没结局、不在公海、不在待分配）就留给原负责人。
 * 跟着走时原负责人在这位客户上没做完的计划、待办一起给接手人，记一行换负责人（overdue-assign，算分配、不算转客户、三态钟不归零）。
 * 回去向和客户现在在谁名下
 */
export async function 客户随线索(projectId: string, customerId: string, 原: string, 新: string): Promise<{ 去向: 客户去向; 在谁名下: string | null }> {
  return 看全部(() => 查完再写(async (tx) => {
    const c = await tx.customer.findUnique({ where: { id: customerId }, select: { salesOwnerId: true, pool: { select: { customerId: true } } } });
    if (!c) return { 去向: "不动" as const, 在谁名下: null };
    // 12-22 审查 M5（口径 B3）：客户上有转让异议在「待裁定」，客户不跟着线索走（项目照转）
    if (await 客户有未裁定异议(tx, [customerId])) return { 去向: "不动" as const, 在谁名下: c.pool ? null : c.salesOwnerId };
    const 别的 = c.salesOwnerId === 原
      ? await tx.project.count({ where: { customerId, ownerId: 原, id: { not: projectId }, result: null, pooledAt: null, awaitAssignAt: null } })
      : 0;
    const 去向 = 客户怎么办({ salesOwnerId: c.salesOwnerId, 在公海: !!c.pool }, 原, 新, 别的);
    if (去向 !== "跟着走") return { 去向, 在谁名下: c.pool ? null : c.salesOwnerId };
    const 改 = await tx.customer.updateMany({ where: { id: customerId, salesOwnerId: 原 }, data: { salesOwnerId: 新 } });
    if (改.count !== 1) return { 去向: "不动" as const, 在谁名下: null };
    await 带走一位(tx, customerId, 原, 新, 系统.id, "overdue-assign", false);
    return { 去向, 在谁名下: 新 };
  }));
}

/**
 * 项目页提示「该客户在 XXX 名下」：这条项目自动转过（超时转，或别人主动放弃转给现负责人的，32H lead-giveup.ts）、
 * 客户不归项目负责人（规则 3 的例外，或客户本来就在别人名下）、客户不在公海。
 * 回 XXX 的名字；不用提示 = null
 */
export async function 客户在谁名下(p: { id: string; ownerId: string; customer: { salesOwnerId: string; pool: unknown } }): Promise<string | null> {
  if (!企业版() || !p.ownerId || p.customer.pool || p.customer.salesOwnerId === p.ownerId) return null;
  const [链, 放弃] = await Promise.all([
    prisma.entReplyOverdue.findUnique({ where: { projectId: p.id }, select: { transfers: true } }),
    prisma.entLeadGiveUp.findFirst({ where: { projectId: p.id, toUserId: p.ownerId }, select: { id: true } }),
  ]);
  if (!链?.transfers && !放弃) return null;
  return (await prisma.user.findUnique({ where: { id: p.customer.salesOwnerId }, select: { name: true } }))?.name ?? null;
}

/**
 * 这几条里哪些已经记过有效沟通（见文件头「有效沟通」，11-20 用户定只认负责人本人记的，三处都按 reply-notice.ts 是有效沟通 判）：
 * 按时的照 reply-notice.ts 已回复的（提醒时刻以后记的，传 只认负责人），按分配 / 历史的照 分配后沟通过的（基准那一刻之后负责人本人记的、
 * 建档时随手记的不算），外加三种都看 负责人跟过的（之前的跟进也算、只管首次沟通：负责人本人在这位客户上记过 = 不是首次 = 不计时，
 * 改了指定回复时间也不重开）
 */
export async function 记过有效沟通的(
  们: readonly (两格 & { id: string; ownerId: string; customerId: string; creatorId: string; createdAt: Date; 基: Date; 按分配: boolean })[],
): Promise<Set<string>> {
  const 按分配们 = 们.filter((p) => p.按分配);
  const [按时, 按分配, 跟过] = await Promise.all([已回复的(们.filter((p) => !p.按分配), true), 分配后沟通过的(按分配们), 负责人跟过的(们)]);
  return new Set([...按时, ...按分配, ...跟过]);
}

/**
 * 之前的跟进也算（11-20 用户定）：负责人本人在这位客户上记过有效沟通的那几条（任何时候、挂哪条项目都算、没挂项目的也算）。
 * 有效沟通按 是有效沟通（跟进任务 / 提醒、同号留痕（标题或节点）、空的占位的不算）；只认负责人本人记的
 */
export async function 负责人跟过的(们: readonly { id: string; ownerId: string; customerId: string }[]): Promise<Set<string>> {
  if (!们.length) return new Set();
  const [沟通们, 词] = await Promise.all([
    prisma.followUp.findMany({
      where: {
        customerId: { in: [...new Set(们.map((p) => p.customerId))] }, ownerId: { in: [...new Set(们.map((p) => p.ownerId))] },
        deletedAt: null, type: { notIn: [...不是沟通的类型] }, NOT: { title: { startsWith: 同号标题 } },
      },
      select: { customerId: true, ownerId: true, type: true, title: true, content: true, projectNode: { select: { node: true } } },
    }),
    读占位词(),
  ]);
  const 跟过 = new Set(沟通们.filter((f) => 是有效沟通(f, f.projectNode?.node, 词)).map((f) => `${f.customerId}|${f.ownerId}`));
  return new Set(们.filter((p) => 跟过.has(`${p.customerId}|${p.ownerId}`)).map((p) => p.id));
}

/**
 * 按分配（含历史）的有效沟通：基准之后（严格晚于）挂在这条项目上、记录人是负责人本人（11-20 用户定）、是有效沟通（同另两处）、
 * 不是建的人建档时随手记的（销售自建时这条照样会被 负责人跟过的 算上、链停下：负责人本人记过 = 不是首次沟通）
 */
export async function 分配后沟通过的(们: readonly { id: string; ownerId: string; creatorId: string; createdAt: Date; 基: Date }[]): Promise<Set<string>> {
  if (!们.length) return new Set();
  const 最早 = new Date(Math.min(...们.map((p) => p.基.getTime())));
  const [挂的, 词] = await Promise.all([
    prisma.followUpProject.findMany({
      where: {
        projectId: { in: 们.map((p) => p.id) }, node: { not: 同号节点 },
        followUp: { createdAt: { gt: 最早 }, deletedAt: null, ownerId: { in: [...new Set(们.map((p) => p.ownerId))] } },
      },
      select: { projectId: true, node: true, followUp: { select: { type: true, title: true, content: true, createdAt: true, ownerId: true } } },
    }),
    读占位词(),
  ]);
  const 项目of = new Map(们.map((p) => [p.id, p]));
  return new Set(挂的.filter(({ projectId, node, followUp: f }) => {
    const p = 项目of.get(projectId);
    return !!p && f.ownerId === p.ownerId && f.createdAt.getTime() > p.基.getTime() && !建档随手记(f, p) && 是有效沟通(f, node, 词);
  }).map((f) => f.projectId));
}

/** 首页待办的一条超时：按分配 = 没填指定回复时间的（分配于 = 链上这一位的计时起点：第一位是分配时刻，轮转来的是他接手那刻），文案不写「指定回复时间」 */
export type 我超时的 = { id: string; name: string; replyStartAt: Date | null; replyEndAt: Date | null; 按分配: boolean; 分配于: Date | null };

/** 首页待办：我手上发过超时提醒、还没记有效沟通的（链还在走） */
export async function 我超时未跟进的(userId: string): Promise<我超时的[]> {
  if (!企业版() || !(await 超时自动转开着())) return [];
  // 生效时刻以前起的链不标（下一遍扫会停掉；扫之前那一分钟也别标出来）
  const 生效 = await 超时转生效时刻(new Date());
  const 们 = await prisma.project.findMany({
    where: {
      ownerId: userId, phase: "线索", result: null, pooledAt: null, awaitAssignAt: null, customer: { pool: null },
      replyOverdue: { is: { holderId: userId, overdueAt: { not: null }, stoppedAt: null, anchorAt: { gte: 生效 } } },
    },
    select: { id: true, name: true, ownerId: true, customerId: true, creatorId: true, createdAt: true, replyStartAt: true, replyEndAt: true, replyOverdue: { select: { anchorAt: true, since: true } } },
  });
  if (!们.length) return [];
  // 填了指定回复时间的按它；没填的按链上记的基准（分配时刻）
  // 指定回复时间和链上的基准对不上 = 历史数据起算进的链（指定回复时间早就过了），同按分配
  const 带基 = 们.map((p) => {
    const 定 = 超时基准(p);
    const 按分配 = !定 || 定.getTime() !== p.replyOverdue!.anchorAt.getTime();
    return { ...p, 基: 按分配 ? p.replyOverdue!.anchorAt : 定!, 按分配 };
  });
  const 回了 = await 记过有效沟通的(带基);
  return 带基.filter((p) => !回了.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, replyStartAt: p.replyStartAt, replyEndAt: p.replyEndAt, 按分配: p.按分配, 分配于: p.按分配 ? p.replyOverdue!.since : null }));
}
