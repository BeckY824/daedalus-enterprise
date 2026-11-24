/**
 * 企业版数据不变量核对（11-17 复盘「不变量查询套件」）。**只读**：只读模式打开库，再开 query_only，一个字都不改。
 *
 *   node --no-warnings scripts/check-invariants.mjs <crm.db> [--strict] [--json]
 *
 * 什么时候跑：每次导入、补数、部署之后，对正式库的只读副本跑一遍；补数脚本前后各跑一遍。非 0 的行写进交接。
 * 规则写着「一定」，没人按规则查数据——11-17 在副本上一查，冒出沟通挂在别家客户的项目上（4 条）、有渠道没渠道负责人（1,658 位）。
 *
 * 每条：项 / 级别 / 违反数 / 前 5 个 id。
 *   级别「违规」：规则明说不许，或代码各写入口都守着的；有一条就以退出码 1 结束。
 *   级别「待核」：规则有例外、或已知有存量没清（附录 C 判「待核」「违规待修」的），只打印不判；--strict 时也算进退出码。
 *   带「仅提示」的待核（11-18 批次 27B 补的附录 C 那 13 条）：口径还没和客户管理员定、或存量还在清，--strict 时也不算进退出码，只列出来；
 *     哪条核实了在当前数据模型下必须为 0，再拿掉「仅提示」（或改成「违规」）。
 * 退出码：0 全过；1 有违规；2 用法错 / 打不开库。某张表或某列这个库里没有（老库）→ 这一条记「跳过」，不算过也不算不过。
 *
 * 只用 node 自带的 node:sqlite（Node ≥ 22.13；22.5–22.12 加 --experimental-sqlite），服务器上不用装别的：scp 这一个文件过去跑，跑完删掉。
 * 依据里的编号：「复盘」= 02-开发与发版/复盘-今日问题与同类排查-20261117.html；P-/M- 开头 = 机制总表的规则编号。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 公海占位账号的邮箱，同 src/lib/pool.ts 无负责人占位邮箱 */
export const 占位邮箱 = "no-owner@placeholder.local";
const 占位Id = `(SELECT id FROM "User" WHERE email = '${占位邮箱}')`;

/**
 * 时间列统一成毫秒再比：Prisma 写进来的是整数毫秒，补数脚本、手工 SQL 可能写成 ISO 文本；
 * 两种混在一起时 SQLite 按类型排序（整数永远小于文本），直接比会错
 */
const 毫秒 = (列) => `(CASE WHEN typeof(${列}) IN ('integer', 'real') THEN ${列} ELSE CAST(round((julianday(${列}) - 2440587.5) * 86400000) AS INTEGER) END)`;

/** 业务角色串（逗号分隔，可能带空格）里有没有某个角色；同 org-core.ts 拆角色 */
const 有角色 = (列, 角色) => `(',' || replace(coalesce(${列}, ''), ' ', '') || ',') LIKE '%,${角色},%'`;
const 是市场成员 = (列) => `((${有角色(列, "marketing_mgr")} OR ${有角色(列, "channel_ops")}) AND NOT ${有角色(列, "sales")} AND NOT ${有角色(列, "sales_mgr")})`;
const 是销售 = (列) => `(${有角色(列, "sales")} OR ${有角色(列, "sales_mgr")})`;

/**
 * 两类字典的默认选项，同 src/lib/enterprise/dict-kinds.ts 字典定义（这个脚本要能单独 scp 到服务器跑，不 import ts；
 * tests/check-invariants.test.ts 核两边一样）。代码认字典值 = 库里这一类的行（含停用）或默认选项（dict.ts 是客户分配项）
 */
export const 字典默认 = {
  custAssign: ["自持", "非自持", "公海领取"],
  followMethod: ["手机通话", "微信沟通", "邮件沟通", "WhatsApp", "旺旺私信", "Telegram", "Skype", "LinkedIn", "Line", "线下拜访", "线上会议", "书面函件", "内部研讨", "手机短信", "客户来访", "展会面聊", "其他方式", "Facebook", "Instagram"],
};
const 字面们 = (们) => 们.map((x) => `'${x.replaceAll("'", "''")}'`).join(", ");
const 字典外 = (列, kind) => `(trim(coalesce(${列}, '')) <> '' AND ${列} NOT IN (SELECT name FROM "EntDictItem" WHERE kind = '${kind}') AND ${列} NOT IN (${字面们(字典默认[kind])}))`;
/** 大陆手机号 11 位（1[3-9] 开头），GLOB 写法 */
const 手机11位 = "1[3-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]";
/** 现在（毫秒）：最近跟进只算不晚于现在的沟通，同 customers/[id]/actions.ts、soft-delete.ts 重算最近跟进 */
const 现在毫秒 = "(CAST(strftime('%s', 'now') AS INTEGER) * 1000)";

/**
 * 每条的 sql 只出一列 id（违反的那一行的 id），按 id 去重计数、取前 5。
 * @type {{ 键: string; 项: string; 级别: "违规" | "待核"; 仅提示?: boolean; 依据: string; sql: string }[]}
 */
export const 不变量们 = [
  {
    键: "沟通挂别家客户的项目",
    项: "沟通记录挂的项目属于同一位客户",
    级别: "违规",
    // 复盘 附录 C「沟通挂在别家客户的项目上」违规 4 条（来源待查）；第 5 类「沟通有 10 条写入路径，只有一部分走共用守门」
    // （src/lib/project/follow-needs-project.ts）。沟通的 customerId 和挂的项目的 customerId 必须相同
    依据: "复盘 附录 C、第 5 类；follow-needs-project.ts",
    sql: `SELECT f.id FROM "FollowUpProject" fp JOIN "FollowUp" f ON f.id = fp.followUpId JOIN "Project" p ON p.id = fp.projectId
          WHERE f.deletedAt IS NULL AND p.customerId <> f.customerId`,
  },
  {
    键: "沟通挂已删项目",
    项: "没删的沟通不挂在已删 / 不存在的项目上",
    级别: "违规",
    // 复盘 附录 C「沟通挂在已删项目上」通过 0：项目进回收站时沟通一起进（soft-delete-core.ts），恢复一起出
    依据: "复盘 附录 C；soft-delete-core.ts",
    sql: `SELECT f.id FROM "FollowUpProject" fp JOIN "FollowUp" f ON f.id = fp.followUpId LEFT JOIN "Project" p ON p.id = fp.projectId
          WHERE f.deletedAt IS NULL AND (p.id IS NULL OR p.deletedAt IS NOT NULL)`,
  },
  {
    键: "项目的客户缺失或在回收站",
    项: "没删的项目，客户存在且不在回收站",
    级别: "违规",
    // 复盘 附录 C「项目、联系人挂在已删客户上」通过 0：客户进回收站时名下项目一起进（P9 软删，soft-delete-core.ts）
    依据: "复盘 附录 C；soft-delete-core.ts",
    sql: `SELECT p.id FROM "Project" p LEFT JOIN "Customer" c ON c.id = p.customerId
          WHERE p.deletedAt IS NULL AND (c.id IS NULL OR c.deletedAt IS NOT NULL)`,
  },
  {
    键: "联系人的客户缺失或在回收站",
    项: "没删的联系人，客户存在且不在回收站",
    级别: "违规",
    // 同上，附录 C 同一行
    依据: "复盘 附录 C；soft-delete-core.ts",
    sql: `SELECT ct.id FROM "Contact" ct LEFT JOIN "Customer" c ON c.id = ct.customerId
          WHERE ct.deletedAt IS NULL AND (c.id IS NULL OR c.deletedAt IS NOT NULL)`,
  },
  {
    键: "非公海客户负责人不存在",
    项: "不在公海的客户，负责人账号存在",
    级别: "违规",
    // Customer.salesOwnerId 必填外键；补数脚本直写 SQL 不过外键时会留下悬空 id（复盘第 9 类「52 个直写脚本绕过守门」）
    依据: "schema.prisma Customer.salesOwnerId；复盘第 9 类",
    sql: `SELECT c.id FROM "Customer" c LEFT JOIN "User" u ON u.id = c.salesOwnerId
          WHERE c.deletedAt IS NULL AND c.id NOT IN (SELECT customerId FROM "CustomerPool") AND u.id IS NULL`,
  },
  {
    键: "非公海客户挂占位账号",
    项: "不在公海的客户，负责人不是公海占位账号",
    级别: "违规",
    // M-公海-03：占位账号只给公海里没负责人的客户用；导入特意把挂占位账号的客户放进公海，
    // 免得「客户挂着占位账号出了公海」——谁也看不到、谁也领不了（enterprise-import/apply.ts 无主客户入池）
    依据: "M-公海-03；enterprise-import/apply.ts",
    sql: `SELECT c.id FROM "Customer" c
          WHERE c.deletedAt IS NULL AND c.id NOT IN (SELECT customerId FROM "CustomerPool") AND c.salesOwnerId = ${占位Id}`,
  },
  {
    键: "非公海客户负责人已停用",
    项: "不在公海的客户，负责人在职（离职交接待确认的除外）",
    级别: "待核",
    // 现有口径（P-转-14、X-31、P-删-06，restore-inactive-owner.ts）：离职没指定接手人就清空负责人进公海；
    // 但 M-公海-02 两个例外（有没结束的订单阶段项目、有同事在推的项目）、已签约 / 已流失、交接中的，照原样留在停用的人名下，
    // 等去离职交接看板指定接手人。所以只能「待核」：离职交接待确认的不列，剩下的逐个看是不是这几种例外。附录 C 待核 1
    依据: "P-转-14、X-31、P-删-06；restore-inactive-owner.ts；复盘 附录 C",
    sql: `SELECT c.id FROM "Customer" c JOIN "User" u ON u.id = c.salesOwnerId
          WHERE c.deletedAt IS NULL AND c.id NOT IN (SELECT customerId FROM "CustomerPool")
            AND u.active = 0 AND u.email <> '${占位邮箱}'
            AND u.id NOT IN (SELECT fromUserId FROM "EntHandover" WHERE kind = '离职' AND status = '待确认')`,
  },
  {
    键: "退回公海次数为负",
    项: "客户 poolReturns ≥ 0（公海内外都查）",
    级别: "违规",
    // poolReturns 退回 +1、撤销 −1（pool-actions.ts、project/db.ts）；补数脚本撤销写 max(0, …)（fill-pool-returns.mjs）。
    // 公海页按 max(1, poolReturns) 落档（unified-pool-sql.ts），负数会让档位和次数对不上
    依据: "schema.prisma Customer.poolReturns；unified-pool-sql.ts；fill-pool-returns.mjs",
    sql: `SELECT c.id FROM "Customer" c WHERE c.deletedAt IS NULL AND c.poolReturns < 0`,
  },
  {
    键: "补建项目晚于首条节点日志",
    项: "补建项目（creatorId = 'system'）创建时间不晚于首条节点日志，且至少有一条",
    级别: "违规",
    // 代码里没有以「系统」为创建人建项目的地方，creatorId = 'system' 的只来自补数脚本（11-17 补潜客培育 fill-nurture.mjs：
    // 项目 createdAt = 客户建档时刻，同时写一条 ProjectNodeLog at = 项目 createdAt）。项目时间线、超时回收按节点日志算，
    // 创建晚于第一条日志 = 时间线倒着走
    依据: "fill-nurture.mjs；复盘第 6、7 类",
    sql: `SELECT p.id FROM "Project" p LEFT JOIN (SELECT projectId, MIN(${毫秒("at")}) AS 首 FROM "ProjectNodeLog" GROUP BY projectId) l ON l.projectId = p.id
          WHERE p.creatorId = 'system' AND (l.首 IS NULL OR ${毫秒("p.createdAt")} > l.首)`,
  },
  {
    键: "项目在公海又待分配",
    项: "项目不同时在公海（pooledAt）和待分配（awaitAssignAt）",
    级别: "违规",
    // schema.prisma Project.awaitAssignAt：有人分出去、进公海都清掉；复盘 附录 C 通过 0
    依据: "schema.prisma Project.awaitAssignAt；复盘 附录 C",
    sql: `SELECT p.id FROM "Project" p WHERE p.deletedAt IS NULL AND p.pooledAt IS NOT NULL AND p.awaitAssignAt IS NOT NULL`,
  },
  {
    键: "结局和关闭时间对不上",
    项: "项目有结局 ⇔ 有关闭时间",
    级别: "违规",
    // schema.prisma Project.closedAt「有结局的那一刻；回到进行中就清掉」；复盘 附录 C 通过 0
    依据: "schema.prisma Project.result / closedAt；复盘 附录 C",
    sql: `SELECT p.id FROM "Project" p WHERE p.deletedAt IS NULL AND ((p.result IS NOT NULL AND p.closedAt IS NULL) OR (p.result IS NULL AND p.closedAt IS NOT NULL))`,
  },
  {
    键: "公海客户在推项目不在公海",
    项: "客户在客户公海时，名下没结束的项目都在公海（整包进出）",
    级别: "待核",
    // M-公海-01「客户公海整包进出（客户 + 名下项目 + 联系人）」、M-公海-06「客户公海里的客户，项目随整包」；
    // M-公海-02 两个例外挡住的客户本来就进不了公海；P-公海-10 分配项目时客户一起出公海。
    // 待核：11-10 之前进公海的老数据、待分配的项目是否算例外没定；规则说「客户负责人自己负责的」在推项目一起进（pool-link.ts）
    依据: "M-公海-01、M-公海-02、M-公海-06、P-公海-10；enterprise/pool-link.ts",
    sql: `SELECT p.id FROM "Project" p JOIN "CustomerPool" cp ON cp.customerId = p.customerId JOIN "Customer" c ON c.id = p.customerId
          WHERE c.deletedAt IS NULL AND p.deletedAt IS NULL AND p.result IS NULL AND p.pooledAt IS NULL`,
  },
  {
    键: "公海客户负责人没清",
    项: "客户公海里的客户，负责人是公海占位账号",
    级别: "待核",
    // M-公海-03 客户进公海清负责人（enterprise/pool-link.ts 客户进公海清负责人）：负责人换成占位账号，原负责人记 pool-release。
    // 待核：开关 进公海清负责人 之前进公海的老数据可能还挂着原负责人
    依据: "M-公海-03；enterprise/pool-link.ts",
    sql: `SELECT c.id FROM "Customer" c JOIN "CustomerPool" cp ON cp.customerId = c.id
          WHERE c.deletedAt IS NULL AND c.salesOwnerId IS NOT ${占位Id}`,
  },
  {
    键: "市场客户下有销售在推项目",
    项: "客户负责人是市场成员时，名下不该有销售负责、不在公海、没结束的项目",
    级别: "待核",
    // 客户负责人和项目负责人本来可以不同（P-转-03、P-转-04、P-转-09：项目层动作不改客户负责人）。已知的一致性规则只有这条例外：
    // 客户还在市场成员手里时，第一次分配（自动 / 指定）给销售、或销售领取 / 被分配公海项目，客户整体一起给销售（P-转-03、P-转-04、P-公海-11）。
    // 待核：市场成员按业务角色近似（有 marketing_mgr / channel_ops、没有 sales / sales_mgr，同 tri-state-list.ts 市场成员们），
    // 规则 M-角色-02 是按部门认的；另外「项目转让」给销售不带客户，是合规的
    依据: "P-转-03、P-转-04、P-转-09、P-公海-11；tri-state-list.ts",
    sql: `SELECT c.id FROM "Customer" c
          JOIN "EntMember" cm ON cm.userId = c.salesOwnerId
          JOIN "Project" p ON p.customerId = c.id AND p.deletedAt IS NULL AND p.result IS NULL AND p.pooledAt IS NULL AND p.awaitAssignAt IS NULL
          JOIN "EntMember" pm ON pm.userId = p.ownerId
          WHERE c.deletedAt IS NULL AND c.id NOT IN (SELECT customerId FROM "CustomerPool")
            AND ${是市场成员("cm.bizRole")} AND ${是销售("pm.bizRole")}`,
  },
  {
    键: "有渠道没渠道负责人",
    项: "客户挂了渠道，就有渠道负责人",
    级别: "待核",
    // schema.prisma Customer.channelOwnerId「继承自 channel.channelOwner，冗余存储」。复盘 附录 C 判违规 1,658 位、还没修，
    // 先放「待核」免得每次都红；修完数据改成「违规」
    依据: "schema.prisma Customer.channelOwnerId；复盘 附录 C",
    sql: `SELECT c.id FROM "Customer" c WHERE c.deletedAt IS NULL AND c.channelId IS NOT NULL AND c.channelOwnerId IS NULL`,
  },
  {
    键: "主渠道停用子渠道启用",
    项: "主渠道停用了，下面的渠道也停用",
    级别: "违规",
    // 复盘 附录 C「主渠道停用、子渠道启用」违规 1（当天修）
    依据: "复盘 附录 C",
    sql: `SELECT ch.id FROM "Channel" ch JOIN "EntChannelMain" m ON m.id = ch.mainId WHERE m.active = 0 AND ch.active = 1`,
  },

  // ---------- 11-18 批次 27B：附录 C 剩下的 13 条，都是「待核·仅提示」（口径待定或存量在清，--strict 也不判红） ----------
  {
    键: "非公海零项目客户",
    项: "不在公海的客户，名下至少有一个没删的项目",
    级别: "待核",
    仅提示: true,
    // 复盘第 8 类：总表 A-15 写着「零项目客户 0」，11-14 全量导入后实际 79,764（不在公海 14,550，11-17 已补潜客培育；公海 65,214 出公海时补）。
    // 只查不在公海的：公海里的零项目客户按设计出公海时才补
    依据: "复盘第 8 类、附录 C「零项目客户」；总表 A-15；fill-nurture.mjs",
    sql: `SELECT c.id FROM "Customer" c
          WHERE c.deletedAt IS NULL AND c.id NOT IN (SELECT customerId FROM "CustomerPool")
            AND NOT EXISTS (SELECT 1 FROM "Project" p WHERE p.customerId = c.id AND p.deletedAt IS NULL)`,
  },
  {
    键: "沟通没挂项目",
    项: "没删的沟通（待办、提醒、同号再次录入的系统留痕除外）挂在某个项目上",
    级别: "待核",
    仅提示: true,
    // 附录 C 违规 276,947（待客户管理员定老沟通怎么挂）；新写入走 follow-needs-project.ts 共用守门。待办、提醒（TASK / REMIND）本来不挂；
    // 同号再次录入的系统留痕（标题以「同号再次录入」开头，src/lib/enterprise/same-number-mark.ts）客户没项目时只挂客户，按设计不挂项目
    依据: "复盘 附录 C「沟通没挂项目」、第 5 类；follow-needs-project.ts；same-number-collab.ts 同号再次录入",
    sql: `SELECT f.id FROM "FollowUp" f
          WHERE f.deletedAt IS NULL AND f.type NOT IN ('TASK', 'REMIND') AND f.title NOT LIKE '同号再次录入%'
            AND NOT EXISTS (SELECT 1 FROM "FollowUpProject" fp WHERE fp.followUpId = f.id)`,
  },
  {
    键: "联系人缺挂靠行",
    项: "没删的联系人，在挂靠表里有它和主客户那一行",
    级别: "待核",
    仅提示: true,
    // schema.prisma ContactCustomer：「这张表记全部挂靠，主客户那一行也在」（老数据由 customer-v2-db.ts 联系人挂靠回填补）。附录 C 待核 6
    依据: "schema.prisma ContactCustomer；customer-v2-db.ts 联系人挂靠回填；复盘 附录 C",
    sql: `SELECT ct.id FROM "Contact" ct
          WHERE ct.deletedAt IS NULL
            AND NOT EXISTS (SELECT 1 FROM "ContactCustomer" x WHERE x.contactId = ct.id AND x.customerId = ct.customerId)`,
  },
  {
    键: "客户分配字典外",
    项: "客户「客户分配」是字典 custAssign 里的一项（库里的行或默认项）",
    级别: "待核",
    仅提示: true,
    // schema.prisma Customer.assignWay；dict.ts 是客户分配项（默认项 + 库里这一类的行，停用的也算）。附录 C 通过 0
    依据: "schema.prisma Customer.assignWay；dict.ts 是客户分配项；复盘 附录 C",
    sql: `SELECT c.id FROM "Customer" c WHERE c.deletedAt IS NULL AND ${字典外("c.assignWay", "custAssign")}`,
  },
  {
    键: "沟通方式字典外",
    项: "沟通「沟通方式」是字典 followMethod 里的一项（库里的行或默认项）",
    级别: "待核",
    仅提示: true,
    // schema.prisma FollowUp.method；dict.ts 定沟通方式。附录 C 待核 5,677，全是导入带进来的「未注明」（要不要清成空待客户管理员定）
    依据: "schema.prisma FollowUp.method；dict.ts 定沟通方式；复盘 附录 C",
    sql: `SELECT f.id FROM "FollowUp" f WHERE f.deletedAt IS NULL AND ${字典外("f.method", "followMethod")}`,
  },
  {
    键: "客户电话带字母",
    项: "客户电话里没有字母",
    级别: "待核",
    仅提示: true,
    // 复盘第 4 类：电话格贴了微信号，原来截出数字存成手机号；现在客户电话走 验客户电话，带字母整格拒（contact-format.ts 像微信号提示）。附录 C 通过 0
    依据: "复盘第 4 类、附录 C；contact-format.ts 验手机格式",
    sql: `SELECT c.id FROM "Customer" c WHERE c.deletedAt IS NULL AND c.phone GLOB '*[A-Za-z]*'`,
  },
  {
    键: "号码格式待核对",
    项: "号码库（ContactMethod）里的号都过了格式校验（formatStatus = ok）",
    级别: "待核",
    仅提示: true,
    // schema.prisma ContactMethod.formatStatus：「回填老数据时验不过的记 验号码 的状态，不挡、只标」。附录 C 待核 62
    依据: "schema.prisma ContactMethod.formatStatus；复盘 附录 C",
    sql: `SELECT cm.id FROM "ContactMethod" cm JOIN "Customer" c ON c.id = cm.customerId
          WHERE c.deletedAt IS NULL AND cm.formatStatus <> 'ok'`,
  },
  {
    键: "同号多客户",
    项: "号码库里同一个号（同种类、同查重键）只挂在一位客户上（每组记一行，id 是组里最小的号码行 id）",
    级别: "待核",
    仅提示: true,
    // 全公司查重按 kind + numberKey 比（contact-dedupe.ts）；存量导入时撞号的只标不挡。附录 C 待核 6 组。
    // 只比号码库这一张表：客户电话格、联系人老三格的撞号由 phone-review 那类一次性核对查
    依据: "schema.prisma ContactMethod；contact-dedupe.ts 全公司查号；复盘 附录 C",
    sql: `SELECT MIN(cm.id) AS id FROM "ContactMethod" cm JOIN "Customer" c ON c.id = cm.customerId
          WHERE c.deletedAt IS NULL AND cm.numberKey <> ''
          GROUP BY cm.kind, cm.numberKey HAVING COUNT(DISTINCT cm.customerId) > 1`,
  },
  {
    键: "客户电话没清空",
    项: "企业版客户没有电话（E-260）：客户电话那格是空串，号码都在联系人上",
    级别: "待核",
    仅提示: true,
    // 数据脚本把客户电话、客户本身的号挪到主联系人并清空 Customer.phone；新建写入（saveCustomer、建档向导、老线索转项目）不再写这一格。
    // 导入 / 增量导入 / 飞书钉钉同步改走联系人之前（另一单），导进来的会落在这里
    依据: "customers/actions.ts saveCustomer；primary-contact-number.ts；E-260",
    sql: `SELECT c.id FROM "Customer" c WHERE c.deletedAt IS NULL AND trim(c.phone) <> ''`,
  },
  {
    键: "最近跟进对不上",
    项: "客户「最近跟进」= 名下没删、不晚于现在的沟通里最晚的发生时间（同号再次录入的系统留痕不算；没有沟通 = 空）",
    级别: "待核",
    仅提示: true,
    // 重算口径同 customers/[id]/actions.ts、soft-delete.ts 重算最近跟进（followUp.findFirst occurredAt ≤ now 倒序，任何类型）。
    // 同号再次录入的系统留痕（标题以「同号再次录入」开头，同 src/lib/enterprise/same-number-mark.ts 同号标题 / 不是同号留痕SQL）不续最近跟进，这里也排除。
    // 精确到毫秒比；导入时「最近跟进」列直接写、后来没重算的会落在这里。附录 C 待核 477
    依据: "schema.prisma Customer.lastFollowAt；customers/[id]/actions.ts、soft-delete.ts 重算最近跟进；复盘第 7 类、附录 C",
    sql: `SELECT c.id FROM "Customer" c
          LEFT JOIN (SELECT customerId, MAX(${毫秒("occurredAt")}) AS 末 FROM "FollowUp"
                     WHERE deletedAt IS NULL AND ${毫秒("occurredAt")} <= ${现在毫秒} AND title NOT LIKE '同号再次录入%' GROUP BY customerId) f ON f.customerId = c.id
          WHERE c.deletedAt IS NULL AND ${毫秒("c.lastFollowAt")} IS NOT f.末`,
  },
  {
    键: "渠道全称和主渠道名对不上",
    项: "挂了主渠道的渠道，全称 = 主渠道名，或以主渠道名加半角 / 全角竖线开头",
    级别: "待核",
    仅提示: true,
    // schema.prisma Channel.mainId：name 是「主渠道|子渠道」的全称，子渠道名空 = 单一入口、name 就是主渠道名；channel-main-core.ts 子渠道名 认半角、全角两种竖线。
    // 附录 C 待核 15（多是展会「2026春季广交会」挂在「广交会」下这类没带竖线的老名）
    依据: "schema.prisma Channel.mainId；channel-main-core.ts 子渠道名；复盘第 7 类、附录 C",
    sql: `SELECT ch.id FROM "Channel" ch JOIN "EntChannelMain" m ON m.id = ch.mainId
          WHERE NOT (ch.name = m.name OR substr(ch.name, 1, length(m.name) + 1) IN (m.name || '|', m.name || '｜'))`,
  },
  {
    键: "主渠道下没有渠道",
    项: "每个主渠道下面至少挂着一个渠道（单一入口的也有一行同名渠道）",
    级别: "待核",
    仅提示: true,
    // schema.prisma EntChannelMain：「不可设的（单一入口），下面只有一行名字等于主渠道名的渠道」。复盘第 7 类影子记录：渠道页打开时补建过同名主渠道，
    // 子渠道删了主渠道还在（11-17 起渠道页只读不再补建）。附录 C 待核 45（单一入口的 12 个最可疑）
    依据: "schema.prisma EntChannelMain；复盘第 7 类、附录 C；channel-main.ts",
    sql: `SELECT m.id FROM "EntChannelMain" m WHERE NOT EXISTS (SELECT 1 FROM "Channel" ch WHERE ch.mainId = m.id)`,
  },
  {
    键: "客户名夹手机号",
    项: "客户名里不夹 11 位手机号（含名字整个就是手机号的）",
    级别: "待核",
    仅提示: true,
    // 复盘 附录 C 待核 22,511 + 名字就是电话 5,776：导入时原表姓名格带着号。随客户抬头那批一起清还是另定，待客户管理员定
    依据: "复盘 附录 C「客户名带手机号」",
    sql: `SELECT c.id FROM "Customer" c WHERE c.deletedAt IS NULL AND c.name GLOB '*${手机11位}*'`,
  },
];

/**
 * 逐条跑。库要已经打开；表或列不存在的那条记「跳过」。
 * @param {{ prepare: (sql: string) => { get: () => unknown; all: () => unknown[] } }} db
 * @returns {{ 键: string; 项: string; 级别: string; 仅提示?: boolean; 依据: string; 违反数: number | null; 前几: string[]; 跳过?: string }[]}
 */
export function 跑不变量(db, 们 = 不变量们, 前几个 = 5) {
  return 们.map((x) => {
    try {
      const 数 = Number(db.prepare(`SELECT COUNT(DISTINCT id) AS n FROM (${x.sql})`).get().n);
      const 前几 = 数 ? db.prepare(`SELECT DISTINCT id FROM (${x.sql}) ORDER BY id LIMIT ${前几个}`).all().map((r) => String(r.id)) : [];
      return { 键: x.键, 项: x.项, 级别: x.级别, ...(x.仅提示 ? { 仅提示: true } : {}), 依据: x.依据, 违反数: 数, 前几 };
    } catch (e) {
      const msg = String(e?.message ?? e);
      // 老库没有这张表 / 这一列：这条不适用；别的错（SQL 写错）照样抛出来
      if (/no such (table|column)/i.test(msg)) return { 键: x.键, 项: x.项, 级别: x.级别, ...(x.仅提示 ? { 仅提示: true } : {}), 依据: x.依据, 违反数: null, 前几: [], 跳过: msg };
      throw new Error(`不变量「${x.键}」查询出错：${msg}`);
    }
  });
}

/** 有没有该判不过的：违规级别非 0；strict 时待核也算（「仅提示」的待核不算） */
export const 不过 = (结果, strict = false) => 结果.some((r) => (r.违反数 ?? 0) > 0 && (r.级别 === "违规" || (strict && !r.仅提示)));

export function 报告(结果) {
  const 行 = 结果.map((r) => {
    const 数 = r.违反数 === null ? "跳过" : String(r.违反数);
    return `${r.违反数 ? (r.级别 === "违规" ? "✗" : "?") : r.违反数 === null ? "-" : "✓"} [${r.级别}${r.仅提示 ? "·仅提示" : ""}] ${r.项} | ${数} | ${r.前几.join(", ") || "—"}`;
  });
  return ["状态 [级别] 项 | 违反数 | 前 5 个 id", ...行].join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const 参数 = process.argv.slice(2);
  const 库 = 参数.find((a) => !a.startsWith("--"));
  if (!库) {
    console.error("用法：node --no-warnings scripts/check-invariants.mjs <crm.db> [--strict] [--json]");
    process.exit(2);
  }
  const { DatabaseSync } = await import("node:sqlite");
  let db;
  try {
    db = new DatabaseSync(库, { readOnly: true });
    db.exec("PRAGMA query_only = ON");
  } catch (e) {
    console.error(`打不开库 ${库}：${e.message}`);
    process.exit(2);
  }
  try {
    const 结果 = 跑不变量(db);
    const strict = 参数.includes("--strict");
    console.log(参数.includes("--json") ? JSON.stringify(结果, null, 2) : 报告(结果));
    const 判 = 不过(结果, strict);
    if (!参数.includes("--json")) console.log(判 ? `结论：不过（${strict ? "违规或待核" : "违规"}非 0）` : "结论：过");
    process.exitCode = 判 ? 1 : 0;
  } finally {
    db.close();
  }
}
