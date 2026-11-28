import { prisma, defaultClient } from "@/lib/prisma";
import { 后售项目们 } from "@/lib/project/after-sale";
import { 能往项目记沟通, 能记售后回访 as 能记售后回访of } from "@/lib/project/follow-needs-project";
import { 只读客户 } from "@/lib/team-scope";
import type { SessionUser } from "@/lib/auth";
import { 项目收藏了吗 } from "@/lib/favorites";
import { 回收认的最近跟进, 能管项目, 能加组员, 能改组员, 能放回公海, 能改节点, 上级只推, 往前推不给, 补全期不给, 直属才推, 角色字典, 异常类别字典, 能进公海的阶段, 看得到的客户, 露客户, 读必填数据, 自动推得到, 超时成员线, 超时线 } from "@/lib/project/db";
import { 项目按必填走, 节点推进管, 节点必填, 还差, 有效沟通还差, 必填叫法, 项目来源有值, type 必填数据 } from "@/lib/project/required";
import { 负责人候选 } from "@/lib/owners";
import { 企业版 } from "@/lib/enterprise/switch";
import { 可选渠道们 } from "@/lib/enterprise/channel-options";
import { llmEnabled } from "@/lib/llm";
import { 已立项天数 } from "@/lib/project/project-fields";
import { 来源字, 人名显示, 是重复咨询, 是仅记录用, 仅记录用来源 } from "@/lib/project/system-created";
import { 客户其他在推项目, 重复咨询原始客户 } from "@/lib/enterprise/repeat-inquiry";
import { 页面可选项, 预读页面字典, 页面字典, 可选名们, 已签收认法, 运输中认法, type 字典种类 } from "@/lib/enterprise/dict";
import { 权限组织 } from "@/lib/enterprise/org";
import { 能看项目, 能转让项目, 能删除, 能新建和领取, 权限项目选, 是系统管理员, 只读角色, 只看的人, type 权限项目 } from "@/lib/enterprise/permissions";
import { 项目来历 } from "@/lib/enterprise/customer-merge";
import { 线索流失细分 } from "@/lib/enterprise/lost-split";
import { 看全部 } from "@/lib/team-scope";
import { 可能是确认人, 跨并状态, 算确认人, 是确认人of } from "@/lib/enterprise/project-merge-request";
import { 有并进的候选, 能并的阶段, 签了合同, 已签合同的项目不能合并, 项目的合并单, 项目合并撤回过期话 } from "@/lib/enterprise/project-merge";
import { 客户事项挡, 页面能改沟通, 能改沟通of, 页面能删沟通, 能删沟通of, 本人限时可改of, 本人可改到, 下一步跟着改of, 系统记的沟通们 } from "@/lib/enterprise/follow-perm";
import { 沟通留痕们 } from "@/lib/enterprise/follow-edited";
import { 要挂项目的类型 } from "@/lib/project/follow-needs-project-text";
import { 沟通附件们 } from "@/lib/attachments";
import type { 附件 } from "@/lib/attachment-rules";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 负责人可推 } from "@/lib/project/org-rules";
import { 读项目提成 } from "@/lib/project/commission-db";
import { 读项目主题 } from "@/lib/enterprise/coach-topic-db";
import { 超时回收日, 超时起点, 超时理由, 节点超时天数, 计时起点, 是超时自动转痕, 系统, 超时自动转理由, 放弃转理由, 记沟通要下一步时间 } from "@/lib/project/timeout";
import { 停用项目进公海理由 } from "@/lib/offboard-db";
import { 拦原负责人, 原负责人不能领回提示, 拦单独领项目, 项目不能单独领提示, 拦客户公海里的项目, 客户在公海项目不单领提示 } from "@/lib/enterprise/pool-rules";
import { 原负责人回避, 回避豁免 } from "@/lib/project/pool-owner";
import { 字典of, 同名们, 是交付 } from "@/lib/project/stage-dict";
import { 本套位置 } from "@/lib/project/nodes";
import { 读线索验证 } from "@/lib/project/lead-verify";
import { 客户显名 } from "@/lib/enterprise/customer-title";
import { 有效线索节点, 要沟通的节点 } from "@/lib/project/stage-gates";
import { 待分配占位 } from "@/lib/enterprise/await-assign";
import { 换负责人 } from "@/lib/project/owner-write";
import { 市场进不了详情, 读市场身份 } from "@/lib/enterprise/market-view-db";
import { 读市场成员们 } from "@/lib/enterprise/market-db";
import { 部门市场无市场角色该转向 } from "@/lib/enterprise/market-view";
import { 只读卡放行 } from "@/lib/enterprise/customer-readonly-card";
import { 仅项目可见 } from "@/lib/enterprise/project-only-customers";
import { dayjs } from "@/lib/utils";
import { 项目的卡点, 能发卡点, 读卡点默认, 可选原因们, 卡点给界面, 沟通编号们 } from "@/lib/project/blocker";
// 附件接口认权限的同一份（不是路由文件，只是放在接口旁边）：项目页给不给入口、能不能传删和接口一个口径
import { 联系人附件入口, 项目附件入口 } from "@/app/api/attachments/access";
import { 列回款 } from "@/lib/project/payment-db";
import { 项目画像项, 其他项, 字典定义 } from "@/lib/enterprise/dict-kinds";
import { 读产品需求 } from "@/lib/project/profile-rules";
import { 项目关联们 } from "@/lib/project/relate";
import { 字段权限of } from "@/lib/enterprise/field-perm";
import { 合同状态显示, 备货状态显示 } from "@/lib/project/proj-fields";
import type { 项目画像 } from "./ProjectExtras";
import type { 项目详情, 项目卡点, 放回方式, 项目详情Props } from "./ProjectDetail";
import { 去空, 有值 } from "@/lib/empty-value";
import { 客户页项目地址 } from "@/lib/project/customer-detail-href";
import { 页面看得到的客户 } from "@/lib/project/visible-customers";
import { 时刻转北京墙钟 } from "@/lib/project/time-fields";
import { 能动定时 } from "@/lib/enterprise/scheduled-assign";
import { 客户在谁名下 } from "@/lib/enterprise/reply-overdue";
import { 放弃资格 } from "@/lib/enterprise/lead-giveup";
import type { 放弃入口 } from "@/lib/enterprise/lead-giveup-core";
import { 补项目去 } from "@/lib/project/customer-detail-direct";

/**
 * 重复咨询「其他在推项目」那一格：看得到的那几个补上直达地址（补项目去，同 repeat-unbuilt.ts 待补建一栏），
 * 链接不先进 /projects/<id> 再跳客户页（跳转优化 PR-A：RedirectBoundary 那段约 130ms 空白）
 */
async function 其他在推带去处(me: SessionUser, projectId: string, customerId: string) {
  const r = await 客户其他在推项目(projectId, customerId);
  return { ...r, 看得到: await 补项目去(me, r.看得到, (x) => x.id) };
}

/** 「该客户在 XXX 名下」那一格（超时未跟进自动转，11-17）：不用提示就不带这一格 */
async function 客户名下提示(p: { id: string; ownerId: string; customer: { salesOwnerId: string; pool: unknown } }): Promise<{ 客户在谁名下?: string }> {
  const 名 = await 客户在谁名下(p);
  return 名 ? { 客户在谁名下: 名 } : {};
}

/** 「放弃（豁免）」入口（32H，lead-giveup.ts）：不给就不带这一格；给了带能不能点、为什么 */
async function 放弃入口of(me: SessionUser, projectId: string): Promise<{ 放弃?: 放弃入口 }> {
  const r = await 放弃资格(me, projectId);
  return r ? { 放弃: { 可: r.可, 本月已用: r.本月已用, ...(r.为什么 ? { 为什么: r.为什么 } : {}) } } : {};
}


/**
 * 项目详情的取数（原 page.tsx 的整段，11-12 客户详情合并第 2 批抽出来）：项目详情页和客户详情的项目区共用，权限、露不露、各卡的数据一个算法。
 * 不在这里 notFound / redirect：项目页照原样 404 / 转向，客户页拿不到就换一个页签或空状态
 */
export type 项目详情载入 =
  | { 种: "无" }
  | { 种: "转向"; 到: string }
  | { 种: "有"; customerId: string; 露: boolean; 客户入口: "详情" | "只读卡" | "文字"; props: 项目详情Props };

/**
 * 沟通行的时限标签只写事实（10-30 规则 E：不用「步步为营」那类口号，blocker-rules.ts 时限提醒of 的文字不再上界面）：
 * 写下一步哪天、过了几天；「逾期」只用在已经过了的，红色也只给它，当天橙色
 */
function 时限标签(nextAt: Date) {
  const 过 = dayjs().startOf("day").diff(dayjs(nextAt).startOf("day"), "day");
  const 日 = dayjs(nextAt).format("MM-DD");
  if (过 > 0) return { 级别: "超时" as const, 文字: `下一步已逾期 ${过} 天（${日}）` };
  return 过 === 0 ? { 级别: "拿捏" as const, 文字: `下一步是今天（${日}）` } : { 级别: "稳" as const, 文字: `下一步 ${日}` };
}

/** 被挡在详情外、转去客户页那一行（P-界面-11）：搜项目名、高亮 */
const 市场转向地址 = (p: { id: string; name: string }) => `/customers?q=${encodeURIComponent(p.name)}&hl=${encodeURIComponent(p.id)}`;

/**
 * 市场角色已分出去的那条（11-04 P-看-06）：列表里真有这一行的转回客户页（11-12 X-107，原来是项目页）高亮，别的 404；不是这种情况给 null。读项目详情 和 项目页去向 共用。
 * 按部门认的市场成员、没有市场角色的（P-看-17，用户 11-24；X-165 扩到兼销售 / 销管 / 项目组员等）：市场视角不认他，列表照 P-看-05 有自己建的、已分给别人的那几行，
 * 详情 能看项目 只认业务角色、不过的——同样转到这一行，不落 404（兼销管按下属口径能进的照常进）（客户页带 hl 时给他画同一套项目页，customers/page.tsx）
 */
async function 市场去向(me: SessionUser, p: 权限项目 & { id: string; name: string; ownerId: string; creatorId: string; pooledAt: Date | null }, 已加入: string[]): Promise<{ 种: "无" } | { 种: "转向"; 到: string } | null> {
  if (!企业版()) return null;
  if (!(await 市场进不了详情(me.id, p.id, { ownerId: p.ownerId, pooledAt: p.pooledAt, 已加入 }))) {
    // 先按项目本身筛（自己建的、分给别人、没进组、不在公海，同 部门市场无市场角色该转向 前半），绝大多数打开不多读市场成员设置
    if (p.creatorId === me.id && p.ownerId && p.ownerId !== me.id && !p.pooledAt && !已加入.includes(me.id)) {
      const org = await 权限组织();
      if (org && 部门市场无市场角色该转向(org, me.id, await 读市场成员们(org), { ...p, 已加入 }) && !能看项目(me, { ...p, 已加入 }, org)) return { 种: "转向", 到: 市场转向地址(p) };
    }
    return null;
  }
  const 圈 = (await 读市场身份(me.id))?.圈 ?? [];
  // P-界面-11：落点从项目页换到客户页（X-107：市场角色左栏只有「客户」，客户页就是他们原来的项目页），同样搜项目名、高亮那一行
  if (p.ownerId && 圈.includes(p.creatorId)) return { 种: "转向", 到: 市场转向地址(p) };
  return { 种: "无" };
}

/**
 * /projects/<id> 先走的轻判断（11-12 第 2 批审查 #3）：只取决定跳不跳要的几个字段，不读整份详情。
 * 口径和 读项目详情 + 页面那条跳转一一对上：找不到 / 市场挡 / 能看项目不过 / 公海回避 = 无；市场列表里有 = 转向；
 * 看得到客户（= 露 且 客户入口 详情）= 跳客户页项目页签；看不到客户的（只读卡、只露名字）= 留在项目页读整份
 */
export async function 项目页去向(me: SessionUser, id: string): Promise<{ 种: "无" } | { 种: "转向"; 到: string } | { 种: "客户页"; 到: string } | { 种: "留" }> {
  if (!企业版()) return { 种: "留" };
  const p = await prisma.project.findUnique({
    where: { id },
    // 能看项目 要的列同一份（权限项目选，含待分配本线放开 P-转-42 那几格）
    select: { id: true, name: true, customerId: true, ...权限项目选 },
  });
  if (!p) return { 种: "无" };
  const 已加入 = p.members.map((m) => m.userId);
  const 市场 = await 市场去向(me, p, 已加入);
  if (市场) return 市场;
  if (!能看项目(me, { ...p, 已加入 }, await 权限组织())) return { 种: "无" };
  // 只负责项目的人（仅项目，lib/enterprise/project-only-customers.ts）：客户看不到也跳客户页，那边是受限客户详情
  if (!(await 看得到的客户([p.customerId])).has(p.customerId) && !(await 仅项目可见(me, p.customerId))?.includes(p.id)) return { 种: "留" };
  if (p.pooledAt && 原负责人回避()) {
    const 放 = await prisma.projectNodeLog.findFirst({ where: { projectId: p.id, kind: "pool-release" }, orderBy: { at: "desc" }, select: { fromOwnerId: true } });
    const 上一任 = 放?.fromOwnerId ?? (p.ownerId || null);
    if (me.id === 上一任 && !(await 回避豁免(me))) return { 种: "无" };
  }
  return { 种: "客户页", 到: 客户页项目地址(p.customerId, p.id) };
}

/** 存字典项名的格（项目标签、物流状态）：现值 + 下拉选项（「其他」要另写一句，这里一改就存，不给选）；存着、后来停用的那项也摆上 */
async function 字典格(种类: "projTag" | "projLogistics", v: string | null): Promise<{ 值: string | null; 选项: string[] }> {
  const 启用 = (await 页面可选项(种类)).filter((x) => x !== 其他项);
  return { 值: v, 选项: 有值(v) && !启用.includes(v) ? [...启用, v] : 启用 };
}

/**
 * 交付卡、完成节点框的备货 / 物流三格。已签收（客户 11-19 定稿：物流要选到「已签收」才算）：算数的名字（字典那一项现在的名字 + 改名前的默认名）、
 * 现在叫什么（提示里写）；那一项停用了、项目上又没存着 = 下拉里选不到，完成节点框提示管理员去启用
 */
async function 备货物流格(p: { stockStatus: string | null; logisticsStatus: string | null; trackingNo: string | null }) {
  // 物流状态的选项和「已签收」认法用同一份行（页面字典，和客户页项目区预读的是一份）：不另查一句（客户详情查询条数上限）
  const 行们 = 企业版() ? await 页面字典("projLogistics") : [];
  const 签收 = 已签收认法(行们);
  const 启用 = 可选名们(行们).filter((x) => x !== 其他项);
  const v = p.logisticsStatus;
  const 物流状态 = { 值: v, 选项: 有值(v) && !启用.includes(v) ? [...启用, v] : 启用 };
  return {
    备货状态: 备货状态显示(p.stockStatus), 物流状态, 物流单号: p.trackingNo,
    已签收: { 名们: 签收.名们, 现名: 签收.现名, 能选: 物流状态.选项.some((x) => 签收.名们.includes(x)) },
    // 算「运输中」的名字（db.ts 改项目：运输中时物流单号必填）：交付卡就地改、完成节点框提前知道要单号，不先发一次被拒
    运输中: 运输中认法(行们).名们,
  };
}

/** 项目详情这一屏读的字典（回收 / 无效原因、项目画像各项、关联的身份 / 角色 / 立场）：客户页项目区和项目页开头一起预读，合成两句 */
export const 项目详情字典们: readonly 字典种类[] = ["recycle", "invalid", ...项目画像项.map((x) => x.种类), "projTag", "projLogistics", "projCustRole", "projContactRole", "projStance"];

/** 节点变更（logs）最多取几条：页面上的历史只摆最近这些 */
const 留痕取几条 = 200;

/** 项目详情（团队版项目模式 1a）：改节点、勾尾款 / 验收、节点变更和挂在项目上的沟通。开关关着时不存在 */
/** 怎么进的公海：超时系统收的 / 办停用时放的（操作人是办的那位管理员，不是离职的人）/ 有人手动放回（QA 第 14 条）。客户详情「历史变更」也用 */
export const 认放回 = (reason: string | null): 放回方式 => (reason === 超时理由 ? "超时" : reason === 停用项目进公海理由 ? "停用" : "手动");

/**
 * 不取留痕（客户详情嵌入、右栏不摆「项目进程变更」卡，11-24 挪进「历史变更」弹窗）：那 200 条节点记录不取，
 * 换成一句 SQL 只数条数（删前清点）、取最近一条不是超时自动转的时刻（超时回收起点，同 是超时自动转痕 / 算回收起点的留痕）
 */
async function 留痕概况(projectId: string): Promise<{ 条数: number; 回收起点留痕: Date | undefined }> {
  const 原因 = `COALESCE(l."reason", '')`;
  const [r] = await prisma.$queryRawUnsafe<{ n: bigint | number; t: bigint | number | string | null }[]>(
    `SELECT COUNT(*) AS n, MAX(CASE WHEN NOT (l."kind" = 'transfer' AND l."userId" = ? AND (instr(${原因}, ?) > 0 OR instr(${原因}, ?) > 0)) THEN l."at" END) AS t
     FROM "ProjectNodeLog" l WHERE l."projectId" = ?`,
    系统.id, 超时自动转理由, 放弃转理由, projectId,
  );
  const t = r?.t == null ? undefined : typeof r.t === "string" && !/^\d+$/.test(r.t) ? new Date(r.t) : new Date(Number(r.t));
  return { 条数: Number(r?.n ?? 0), 回收起点留痕: t };
}

export async function 读项目详情(me: SessionUser, id: string, 选项?: { 不取留痕?: boolean }): Promise<项目详情载入> {
  const 不取留痕 = !!选项?.不取留痕;
  const p = await prisma.project.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, shortName: true, customerNo: true, school: true, lastFollowAt: true, salesOwnerId: true, channelOwnerId: true, pool: { select: { customerId: true } }, channelId: true, channel: { select: { name: true } } } },
      channel: { select: { name: true } },
      contact: { select: { id: true, name: true, position: true } },
      exceptionCategory: { select: { name: true } },
      // 不取留痕：take 0（Prisma 不为它发查询，类型照旧），条数和回收起点走下面 留痕概况 一句
      logs: { orderBy: { at: "desc" }, take: 不取留痕 ? 0 : 留痕取几条 },
      members: { orderBy: { createdAt: "asc" } },
      followUps: { include: { followUp: { select: { id: true, type: true, title: true, method: true, initiator: true, content: true, occurredAt: true, ownerId: true, customerId: true, createdAt: true, updatedAt: true, afterSale: true } } } },
    },
  });
  if (!p) return { 种: "无" };
  if (企业版()) 预读页面字典(项目详情字典们);
  // 11-01 只认业务角色（lib/enterprise/permissions.ts）：企业版 org 一定读；没设业务角色的什么都看不到
  const org = await 权限组织();
  const 已加入 = p.members.filter((m) => m.inviteStatus === "JOINED").map((m) => m.userId);
  // 市场角色：已分给圈外的人的那条只在项目页看进度，详情（含直接输网址）一律不给（11-04 P-看-06）。
  // 先问这个：自己建的线索分给销售后，原来存的链接点进来不再是「找不到」——转回项目页、搜上项目名、指出那一行（客户 11-05）。
  // 只转列表里真有这一行的（建的人在我的圈里、已有负责人，同 market-view.ts 市场项目条件），别的照旧 404，不借转向露出项目名
  const 市场 = await 市场去向(me, p, 已加入);
  if (市场) return 市场;
  // 数据层（lib/team-scope.ts 看得到的项目）在「按组织看客户」开着时已经筛过；关着也按业务角色再挡一遍
  if (企业版() && !能看项目(me, { ...p, 已加入 }, org)) return { 种: "无" };
  const 能改 = 能管项目(me, p, org);
  const 能转 = 能转让项目(me, p, org);
  // 公海里同事客户的项目：只给项目本身，客户、联系人、沟通内容领了再看（lib/project/db.ts 露客户）
  const 看得到客户 = await 页面看得到的客户([p.customerId]);
  const 露 = 露客户(me, p, 看得到客户);
  // 客户那一格点了去哪（E①）：看得到客户 = 客户详情；只负责项目的人和实线上级 = 只读卡；只露名字的（比如虚线上级）= 文字，不链到一个报「没有找到」的页。
  // 露 的含义不变，只读卡不改限定层
  const 客户入口 = !企业版() || 看得到客户.has(p.customerId) ? "详情" as const
    : (await 只读卡放行(me, { ...p, 已加入, 客户在公海: !!p.customer.pool }, org)) ? "只读卡" as const : "文字" as const;
  const [候选, 在职, 联系人们, 角色们, 类别们, 放回过, 规则, 概况] = await Promise.all([
    负责人候选(),
    prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
    能改 ? prisma.contact.findMany({ where: { customerId: p.customerId }, select: { id: true, name: true, position: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] }) : [],
    角色字典(),
    异常类别字典(),
    // 历史负责人（企业版才显示）：放回过公海的人。单独查，不受上面节点变更只取 200 行的限
    !企业版() ? [] : prisma.projectNodeLog.findMany({ where: { projectId: p.id, kind: "pool-release" }, orderBy: { at: "desc" }, select: { fromOwnerId: true, userId: true, reason: true } }),
    生效组织规则(),
    不取留痕 ? 留痕概况(p.id) : null,
  ]);
  const 类别名 = new Map(类别们.map((c) => [c.id, c.name]));
  // 10-26 验收 #13：线索转出来的项目记着是哪条线索来的。线索后来删了就只说「已删除」
  const 来源线索 = !p.sourceLeadId || !露 ? null
    : await prisma.lead.findUnique({ where: { id: p.sourceLeadId }, select: { name: true, convertedAt: true } }).then((l) => ({ name: l?.name ?? null, convertedAt: l?.convertedAt ? dayjs(l.convertedAt).format("YYYY-MM-DD") : null }));
  const 公海 = !!p.pooledAt;
  const 企业 = 企业版();
  const 能领 = !企业 || 能新建和领取(me, org);
  // 沟通记录跟着项目走（11-03 C6-2）：企业版不在公海的项目，看得到项目（负责人、组员、管理者，上面 能看项目 挡过）就看得到上面谁记的沟通，
  // 包括前负责人记的、客户不归自己线的；客户本身、联系人照旧按 露。公海里照旧领了再看。附件照旧按 露（附件接口按客户认）
  const 露沟通 = 露 || (企业 && !p.pooledAt);
  // 公海里这个项目最后一次是谁放的（企业版 11-01 起进公海清负责人，原负责人只在留痕里，lib/project/pool-owner.ts）
  const 上一任 = 公海 ? 放回过[0]?.fromOwnerId ?? (p.ownerId || null) : null;
  // 历史负责人对公海里的这个项目没有任何权限（C-01）：看不到，总管理 / 管理员不算（回避豁免）
  if (公海 && 原负责人回避() && me.id === 上一任 && !(await 回避豁免(me))) return { 种: "无" };

  const 历史负责人 = [...new Set(放回过.map((l) => l.fromOwnerId).filter((x): x is string => !!x))];
  // 最近一次放回（页头「Y 放回的」、提示条「是你放回去的」）：认上面不限条数的放回留痕；p.logs 只取最近 200 条，进出公海多了会掉出去。
  // 不是企业版（放回过 = 空）照旧从 p.logs 找
  const 最近放回: { userId: string; reason: string | null } | undefined = 公海 ? 放回过[0] ?? p.logs.find((l) => l.kind === "pool-release") : undefined;
  const 人id = new Set<string>([...历史负责人, ...(上一任 ? [上一任] : []), ...(最近放回 ? [最近放回.userId] : []), p.ownerId, p.creatorId, ...(p.scheduledAssignTo ? [p.scheduledAssignTo] : []), ...p.members.map((m) => m.userId), ...p.logs.flatMap((l) => [l.userId, l.fromOwnerId, l.toOwnerId].filter((x): x is string => !!x)), ...(露沟通 ? p.followUps.map((f) => f.followUp.ownerId) : [])]);
  for (const x of [p.balanceSettledById, p.acceptancePassedById]) if (x) 人id.add(x);
  const 人 = await prisma.user.findMany({ where: { id: { in: [...人id] } }, select: { id: true, name: true } });
  const 名 = new Map(人.map((u) => [u.id, u.name]));
  // 超时回收记在「系统」名下（timeout.ts 系统，QA #16），不是真成员
  // system 不是真账号，按「系统」显示（创建人那一格按 系统补建，见下面 creatorName），共用 人名显示
  const 叫 = (uid: string | null) => (uid ? 人名显示(uid, 名, { 不在: "已不在的成员" }) : null);
  // 企业版「非原负责人均可领取」：原负责人看得到领取按钮、灰着（pool-rules.ts）
  const 原负责人领不回 = 公海 && me.id === 上一任 && 拦原负责人();

  // 企业版超时回收：线索 / 商机阶段记沟通要填下一步时间；算出哪天会自动回公海（和 lib/project/db.ts 公海超时收回 同一个起点）
  // 仅记录用的不回收时不强制（X-147 待定 6）
  const 要下一步 = 记沟通要下一步时间(规则, p);
  const 字典 = 字典of(企业, 企业 ? 规则.阶段.出口叫法 : null);
  // 最近一条留痕，超时自动转那行不算（同 lib/project/db.ts 补回收起点留痕，客户 11-19 第 14 题 B）
  const 回收起点 = 超时起点(p.createdAt, 概况 ? 概况.回收起点留痕 : p.logs.find((l) => !是超时自动转痕(l))?.at, 规则.超时回收.开 ? await 回收认的最近跟进(p.customerId, p.customer.lastFollowAt) : p.customer.lastFollowAt);
  // ↑ 客户最近跟进不算售后回访（E-318，同 lib/project/db.ts 项目回收日）；回收没开不查
  // 超时按项目业务线分内外贸天数（C7）：老项目没填业务线按负责人的线
  const 回收线 = 超时线(p, 规则.超时回收.开 ? await 超时成员线(规则) : null);
  const 回收日 = 超时回收日(规则, p, 回收起点, 字典, 回收线);
  // 验证中（等复核 / 等销售……）的线索不参与超时回收（X-78 → M-线索-02，和 lib/project/db.ts 验证中不收 同一个条件）：不写回收日，写「验证中，不回收」，记沟通也不预演
  const 验证不收 = 企业 && !!回收日 && !!(await prisma.entLeadVerify.findUnique({ where: { projectId: p.id }, select: { pending: true } }))?.pending;
  // 11-17：负责人或已进组的组员能记，已结束的不再记（和 lib/project/db.ts 记项目沟通 同一个判断）
  const 能记沟通 = 企业 && !公海 && !p.result && 能往项目记沟通(me, p, org, 已加入.includes(me.id) ? "JOINED" : null);
  // 售后回访（11-25，E-283）：交付结清的项目，客户不在公海（按客户 CustomerPool 判，交付结清的项目本身不进公海），项目负责人 / 已进组组员 / 客户负责人能记——「记售后回访」按钮
  const 能记售后回访 = 企业 && 是交付(p.result) && 能记售后回访of(me, { ownerId: p.ownerId, result: p.result, 客户负责人: p.customer.salesOwnerId, 客户在公海: !!p.customer.pool }, org, 已加入.includes(me.id) ? "JOINED" : null);
  // 下次回访（E-283）：记售后回访时能不能顺手排，同服务端 记项目沟通（客户事项挡：客户负责人、这位客户下项目的负责人；组员不给）
  const 能排下次回访 = 能记售后回访 && !(await 客户事项挡(me, p.customerId));
  // 沟通的「…」菜单（改 / 删，10-29）：不在公海、客户看得到，且不是同事 / 虚线下属的客户（和客户页不摆编辑删除同一条，服务端 改项目沟通 / 删项目沟通 再挡一遍）。
  // M-权限-09（11-09 原口径）：管理（销售管理 / 市场管理 / 总管理）以下的人，负责人本人也算，不能改、不能删。
  // 改 = 身为负责人（项目或客户的）的管理，删 = 系统管理员或身为负责人的管理（V3.5.1），两样分开给，和服务端同一套（lib/enterprise/follow-perm.ts）
  const 沟通能动 = 企业 && !公海 && 露 && !(await 只读客户(defaultClient, p.customer));
  const 可改沟通 = 沟通能动 && (能改沟通of(me, [p.ownerId], org) || (!!p.customerId && (await 页面能改沟通(me, p.customerId))));
  const 可删沟通 = 沟通能动 && (能删沟通of(me, [p.ownerId], org) || (!!p.customerId && (await 页面能删沟通(me, p.customerId))));
  // 企业版节点必填：这个节点配了必填才给；还差哪几样和 lib/project/db.ts 按必填推进 同一个算法
  // 企业版 D-37：直属上级（账号可能还是 SALES）、总管理员能改节点；负责人有直属上级时往前推只给直属上级和老板（都和 lib/project/db.ts 改节点 同一个判断）
  // 「仅上级推」开着：直属上级也给节点这块（服务端只放往前推，往后退、点结局照拦）
  // 待分配期间占着负责人一格的建的人：只能看和改字段，节点、删除都不给（P-转-21、X-68，和 lib/project/db.ts 改节点、删项目 同一个判断）
  const 占位 = 待分配占位(me, p);
  const 节点能改 = !占位 && (能改节点(me, p, org) || 上级只推(me, p, await 直属才推(org), 规则));
  // 有结局的也算（11-03 A5-1）：改回到后面的节点同样算往前推，下拉里照样灰着
  // 节点推进管的项目才列必填、灰下拉：默认全部项目（客户 11-19，存量也要补齐）；设置成只管新建的时，生效时刻之前建的不列
  // 读必填数据 只读一遍：必填差、存一下就推、有效沟通差共用；已签收认法用页面字典那一份（备货物流格 同一份行），不另查一句（客户详情查询条数上限）
  let 必填数据读: Promise<必填数据> | null = null;
  const 必填数据 = () => (必填数据读 ??= (async () => 读必填数据(prisma, p, 规则, 企业 ? 已签收认法(await 页面字典("projLogistics")) : undefined))());
  const 必填差 = !公海 && 项目按必填走(规则, p) ? 还差(规则, await 必填数据()) : null;
  // 「仅上级推」下上级手动推到一个已经齐了的节点会停在那（一次只推一格，客户 11-19 定稿）：负责人存一下就会自动推一格，项目页说一句。
  // 只在这个情况出：仅上级推、齐了、看的人能改字段、存一下真推得动（和 按必填推进 同一个判断）
  const 存一下就推 = !!必填差 && !必填差.length && !负责人可推(规则) && 能改 && !!(await 自动推得到(prisma, 规则, me, p, 必填数据));
  // 交付结清只在尾款结算（客户 11-19 定稿）：和 db.ts 改节点 传给 改节点问题 的同一个判断；不受开关管就改成 企业
  const 交付只在尾款 = 企业 && 节点推进管(规则, p);
  const 必填 = 必填差 ? { 配了: 节点必填(规则, p.node), 还差: 必填差, ...(存一下就推 ? { 存一下就推 } : {}) } : null;
  // 记沟通时预演回收日（10-30 P0-2，lib/enterprise/recycle-text.ts 预演回收日）：给起点日和这个进程的天数，浏览器按同一个算法算。
  // 配了必填的进程记完可能自动推到下一个进程（天数跟着换），算不准就不给，界面不显示那一句
  const 回收天数 = 企业 && 要下一步 && 回收日 && !必填 && !验证不收 ? 节点超时天数(规则, p.node, 字典, 回收线) : null;
  const 回收预演 = 回收天数 ? { 起点日: 计时起点(规则, 回收起点).format("YYYY-MM-DD"), 天数: 回收天数 } : null;
  // 需求状态补全期（M-权限-07）开着：只有经理、总管理员能往前推，和 lib/project/db.ts 改节点 同一个判断
  const 补全期挡 = 企业 && !公海 ? 补全期不给(me, org, 规则) : null;
  const 不给推 = 企业 && !公海 ? 补全期挡 ?? 往前推不给(me, p.ownerId, await 直属才推(org), 负责人可推(规则)) : null;
  // 不给推时谁能点「完成节点」（必填齐了那句提示用）：补全期只有销售管理、总管理；负责人可推下我不是负责人 → 负责人
  // （11-01 C2：上级只看、只转让，节点能改 不给上级）；仅上级推（负责人本人、组员都一样）→ 上级
  const 不给推谁能推 = !不给推 ? null : 补全期挡 ? "销售管理或总管理" : me.id !== p.ownerId && 负责人可推(规则) ? "负责人" : "上级";
  // 企业版：线索验证往后推要先有有效沟通 = 线索验证节点配的其他必填项都齐（没配看需求状态，11-05；经理和缺必填一样不拦；和 lib/project/db.ts 有效沟通差of 同一个算法）
  const 有效沟通差 = 企业 && p.phase === "线索" && !p.result ? 有效沟通还差(await 必填数据()).map(必填叫法) : [];
  // 企业版提成卡：只给组长、已进组的组员、管理员、主管和负责人的上级（lib/project/commission-db.ts 能看提成）；不是企业版不查
  const 提成 = 企业 ? await 读项目提成(me, p, p.members.filter((m) => m.inviteStatus === "JOINED").map((m) => m.userId), org, (uid) => 叫(uid)!, prisma) : null;
  // 企业版教练主题（11-17，lib/enterprise/coach-topic-db.ts）：看得到的才给；没有、也发不了就不给这一块
  const 主题们 = 企业 ? await 读项目主题(me, p.id) : null;
  const 教练主题 = 主题们 && (主题们.能发 || 主题们.们.length) ? 主题们 : null;

  // 企业版卡点（lib/project/blocker.ts）：沟通编号、卡点列表、发卡点的默认值和阻碍原因下拉；别的版本一样不查
  const [编号, 卡点们, 能发, 卡点默认, 卡点原因们] = 企业
    ? await Promise.all([沟通编号们(露沟通 ? p.followUps.map((f) => f.followUp.id) : []), 项目的卡点(me, p.id), 能发卡点(me, p.id), 读卡点默认(), 可选原因们()])
    : [new Map<string, { code: string; nextAt: Date | null }>(), [], false, null, []];
  const 卡点: 项目卡点 | null = 企业 && 卡点默认 ? { 们: 卡点们.map(卡点给界面), 能发: 能发 && 露, 默认: 卡点默认, 原因们: 卡点原因们 } : null;
  // 企业版联系人附件（2026-10-28）：项目卡联系人那一行下面给「附件」，和客户页同一个弹窗；不是企业版、公海里没领的不查
  const 联系人附件 = 企业 && 露 && p.contact ? await 联系人附件入口(p.contact.id) : null;
  // 企业版字典下拉（10-27）：不是企业版 可选项 给空
  const [回收原因们, 无效原因们] = await Promise.all([页面可选项("recycle"), 页面可选项("invalid")]);
  // 企业版项目来源 / 已立项天数 / AI 录入（10-29 P6）：项目自己选了渠道就用它，没选跟客户来源走（和渠道统计 lib/enterprise/channel-stats.ts 同一条规则）
  // 痛点标注、合同状态（迁移 101）：字段权限「藏」的那一项不给值（界面不摆那一行、编辑框不交那一项）
  const 权限 = 企业 ? await 字段权限of(me.id) : null;
  const 企业项目字段 = !企业 ? {} : {
    // 有没有值和节点必填同一个判断（required.ts 项目来源有值，是项目本身的属性，不随看的人变），不然这里显示有、必填说没填（或反过来）。
    // 跟客户来源的渠道名只给看得到客户的人（11-12 审查）；看不到客户的（只负责项目的人、实线上级）：11-20 总控判定「只露有无，不露来源值」——
    // name 空，界面写「随客户来源」，不写待填（免得误导去补填、改掉渠道归属），渠道名 / id 都不给
    项目来源: !项目来源有值(p.channelId, p.customer.channelId) ? null
      : p.channel ? { name: p.channel.name, 跟客户: false }
      : { name: 看得到客户.has(p.customerId) ? p.customer.channel?.name ?? "" : "", 跟客户: true },
    channelId: p.channelId,
    // 数据来源（迁移 151）：历史沟通分析回填的项目写「历史分析」；系统里正常建的不给（界面不摆那一行）
    // 仅记录用（X-147）推进出潜客培育后照常统计：标签照留、后面说一句
    ...(p.source ? { 数据来源: p.source === 仅记录用来源 && !是仅记录用(p) ? `${来源字(p.source)}（已推进，照常统计）` : 来源字(p.source) } : {}),
    // 老客户重复咨询（重复咨询第一步）：现算这位客户别的在推项目，给负责人判是不是同一需求；验证框里提示选「重复线索」
    ...(是重复咨询(p) ? { 重复咨询: await 其他在推带去处(me, p.id, p.customerId) } : {}),
    // 只读来源字段（迁移 163，客户 E-218）：原始客户编号 + 第几次；没有编辑入口，改项目的动作都不写这两列
    ...(是重复咨询(p) && p.repeatOfCustomerId ? { 重复咨询来自: await 重复咨询原始客户(p) } : {}),
    // 合并客户第一批（11-25）：从另一位客户挪过来的（合并客户 / 项目换客户）写「从 NO.xxxxx「B」并入」；原客户名字只给看得到它的人
    // 后售培育（P-界面-63）：停在潜客培育、客户名下有交付结清的，进程条第一格和「现在在」写后售培育；存的仍是潜客培育。不停在潜客培育的不查库
    ...(企业 && (await 后售项目们([p])).has(p.id) ? { 后售: true as const } : {}),
    并入自: await 项目来历(prisma, p.id, p.customerId, async (id) => (await 页面看得到的客户([id])).has(id)),
    // 「换客户」：看得到客户、客户负责人本人（能删客户的角色）或系统管理员才摆；同事负责没结束的、交接中、业务线不同……在预览里说（同 project-move-customer.ts 拦的原因）
    能换客户: 看得到客户.has(p.customerId) && !!org && !只读角色(me, org) && !只看的人(org, me.id)
      && (是系统管理员(me, org) || (!p.customer.pool && 能删除(me, org, p.customer.salesOwnerId) && (!!p.result || 公海 || !p.ownerId || p.ownerId === me.id))),
    // 合并客户第二批 2a「并进另一个项目」：只摆给负责人本人或系统管理员（同 能并进的项目）；结束了、不在线索阶段、没有可并进的项目时灰着写原因。能不能并整套在预览里再判
    ...(企业 && !占位 ? { 并进: await 并进菜单(me, org, p) } : {}),
    // 跨负责人合并（E-380 阶段 2）：留下项目的负责人本人或系统管理员摆「把同事的项目并进来」；这个项目顶上的待确认申请一行（等谁确认、验证计时暂停）
    ...(企业 && !占位 ? { 跨并: await 跨并菜单(me, org, p), 跨并待确认: await 跨并待确认of(me, org, p.id) } : {}),
    // 合并客户第二批 2a：被并掉的项目（结束为重复线索、合并单没撤回）顶上一行「已并入 → 留下的项目」；留下的项目不给。没结束的不查库
    ...(企业 && !占位 && p.result ? { 已并入: await 已并入of(me, p.id) } : {}),
    // 线索流失拆出的两类（P-界面-66，同看板列）：结局是线索流失才现算（lost-split.ts 一批三句 + 字典一句），其他线索流失不带
    ...(企业 && !占位 && p.result === "线索流失" ? await 流失细分of(p) : {}),
    已立项天数: 已立项天数(p.createdAt),
    ...(能改 ? { 渠道们: await 可选渠道们(p.channelId) } : {}),
    aiEnabled: (能记沟通 || 能记售后回访) && 露 ? await llmEnabled() : false,
    // 项目级别、所在地（P11 定稿 -2 版，迁移 093）：级别是项目自己的，都给看；所在地跟客户资料一样，公海里同事客户的项目没领之前不给
    level: p.level,
    // 项目标签（迁移 153，F-项目-14）：和级别各一列、各自填，同样都给看。选项 = 字典里启用着的 + 这个项目存着、后来停用的那项（同项目画像）
    项目标签: await 字典格("projTag", p.projTag),
    // 备货状态、物流状态、物流单号（迁移 154，客户 11-19）：项目自己的，都给看；物流状态选项同项目标签（字典 projLogistics）
    备货物流: await 备货物流格(p),
    // 业务线（11-02）：编辑框里能改（改了不重新自动分配）；老项目没填是 null
    bizLine: p.bizLine,
    所在地: 露 ? { addrCountry: p.addrCountry, addrProvince: p.addrProvince, addrCity: p.addrCity, addrDistrict: p.addrDistrict, location: p.location } : null,
    // 成交需求、合同金额、定金金额（迁移 097）：和金额一样是项目自己的，都给看
    成交钱: { dealDemand: p.dealDemand, contractAmount: p.contractAmount, contractCurrency: p.contractCurrency, depositAmount: p.depositAmount, depositCurrency: p.depositCurrency },
    // 合同状态库里空的给 null（界面写「—」）
    项目新字段: {
      ...(权限?.("痛点标注") !== "藏" ? { painPoints: p.painPoints } : {}),
      ...(权限?.("合同状态") !== "藏" ? { contractStatus: 合同状态显示(p.contractStatus) } : {}),
    },
    // 卡片就地改（11-02）：不是「改」的这几项不摆入口；服务端 改项目 同一张字段权限表照旧拦
    只能看字段: (["商机金额", "预计签约", "痛点标注", "合同状态"] as const).filter((名) => 权限?.(名) !== "改"),
  };
  // 企业版线索验证（P12）：状态、时间线、我现在能做哪一步；不是企业版不查。11-01 起项目卡上一直摆「线索验证」结果，过了线索阶段也读
  const 线索验证 = 企业 ? await 读线索验证(me, p) : null;
  // 线索验证面板的「判定依据」照组织规则里「线索验证」节点配的必填写（员工反馈 #7；和 有效沟通差 同一份配置）
  const 线索验证必填 = 线索验证 ? 节点必填(规则, 有效线索节点) : [];
  // 企业版项目画像、项目附件（P11）：画像和附件是客户那边的资料，公海里同事客户的项目没领之前不给（同 联系人附件）。
  // 项目名单在中栏（@pane/projects/(detail)/layout.tsx → roster-panes.tsx 项目名单），不在这页里读
  const 存的需求 = 读产品需求(p.productNeeds);
  const 画像: 项目画像 | null = !企业 || !露 ? null : {
    项们: await Promise.all(项目画像项.map(async (项) => {
      // 选项 = 启用着的 + 这个项目已经存着、后来停用的（不然下拉里显示成一串值）；「其他」要另写一句，这里一改就存，不给选
      const 存着 = 项.多选 ? 存的需求 : [p[项.键]].filter((x): x is string => 有值(x));
      const 启用 = (await 页面可选项(项.种类)).filter((x) => x !== 其他项);
      return { 键: 项.键, 名: 字典定义[项.种类].名, 多选: 项.多选, 选项: [...启用, ...存着.filter((x) => !启用.includes(x))] };
    })),
    // 老库存的「暂未确认」这类占位按没选显示「—」（11-11）
    值: Object.fromEntries(项目画像项.map((项) => [项.键, 项.多选 ? 存的需求 : 去空(p[项.键])])) as 项目画像["值"],
  };
  const 项目附件 = 企业 && 露 ? await 项目附件入口(p.id) : null;
  // 企业版沟通记录的截图、录音（F-跟进-07）：和沟通记录同一个口径（露客户才给）；传 = 记这条的本人或能改沟通的，删 = 能改沟通的（api/attachments/access.ts 认沟通）
  // 记在本项目客户名下的，或记在别的客户名下、那位客户我也看得到的才给（11-24 审查后改）：关联客户带进来的那几条，
  // 附件接口 认沟通 用带限定的 followUp 查（FollowUp 跟客户走，lib/team-scope.ts），看不到那位客户就拒——
  // 这里用同一把尺（看得到的客户：带限定的 customer 查），总管理这类看得到对方客户的照给，界面和接口一致。
  // 给不了的那几条不带 附件 这一格（不是给空的）：界面就不出附件框和「加截图 / 录音」入口（ProjectDetail 里 f.附件 && …），不然传了也被拒
  const 别的客户们 = 企业 && 露 ? [...new Set(p.followUps.map((f) => f.followUp.customerId).filter((c): c is string => !!c && c !== p.customerId))] : [];
  const 看得到别的 = 别的客户们.length ? await 页面看得到的客户(别的客户们) : new Set<string>();
  const 给附件 = (c: string | null) => 企业 && 露 && !!c && (c === p.customerId || 看得到别的.has(c));
  const 带附件的 = new Set(p.followUps.filter((f) => 给附件(f.followUp.customerId)).map((f) => f.followUp.id));
  const 沟通附件 = 带附件的.size ? await 沟通附件们(prisma, [...带附件的]) : new Map<string, 附件[]>();
  // 企业版回款（10-31，迁移 100）：和合同金额一样是项目自己的钱，都给看
  const 回款们 = 企业 ? await 列回款(p.id) : null;
  // 企业版关联客户 / 联系人（P17）：同画像，公海里同事客户的项目没领之前不给
  const 关联 = 企业 && 露 ? await 项目关联们(me, p.id) : null;
  // 库里存着旧节点名 / 旧结局的（企业版 10-31 改名）按这套的新名给界面；节点变更历史（logs）照原样
  const 现 = 本套位置({ phase: p.phase, node: p.node, result: p.result }, 字典);
  // 沟通「已修改」小字、本人限时改（11-19）：一页一句留痕；最近记的那条按写入时刻（下一步跟着改认它）
  const 现在 = new Date();
  const 最近一条 = p.followUps.reduce<{ id: string; at: number } | null>((m, f) => (!m || f.followUp.createdAt.getTime() > m.at ? { id: f.followUp.id, at: f.followUp.createdAt.getTime() } : m), null)?.id ?? null;
  // 本人限时改的候选：我记的、30 分钟内、沟通类型（待办 / 提醒不算）；导入建的、系统留痕剔掉（一句）
  // 交付结清的项目：标了售后回访的那几条照样本人限时改（follow-perm.ts 同一道）
  const 本人改候选 = 企业 && (能记沟通 || 能记售后回访) ? p.followUps.map((f) => f.followUp).filter((f) => 本人限时可改of(me, f, 现在) && 要挂项目的类型(f.type) && (能记沟通 || f.afterSale)) : [];
  // 「已修改」和最近一条写没写过下一步合一句留痕（最近一条是候选、我能管时才问）
  const 问下一步 = !!最近一条 && 能改 && 本人改候选.some((f) => f.id === 最近一条) ? 最近一条 : null;
  const 留痕 = 企业 && 露沟通 && p.followUps.length ? await 沟通留痕们(p.followUps.map((f) => f.followUp.id), 问下一步) : { 改过的: new Set<string>(), 写过下一步: false };
  const 改过的 = 留痕.改过的;
  const 系统的 = 本人改候选.length ? await 系统记的沟通们(本人改候选) : new Set<string>();
  const 本人候选 = new Set(本人改候选.filter((f) => !系统的.has(f.id)).map((f) => f.id));
  const 最近写过下一步 = !!问下一步 && 本人候选.has(问下一步) && 留痕.写过下一步;
  // F-017：后台开了「前两节点要沟通」、停在线索验证、这个节点上还没记过沟通 → 推过线索验证的提示里一并写「记一条沟通」。
  // 读的是同一个开关、同一份节点表，判法照 lib/project/stage-gates.ts 企业版推进关（沟通挂的节点新旧名都算）；只管提示，拦照旧在服务端
  const 线索验证缺沟通 = 企业 && 现.phase === "线索" && 现.node === 有效线索节点 && !p.result && 规则.阶段.前两节点要沟通
    && 要沟通的节点().includes(有效线索节点) && !p.followUps.some((f) => 同名们(有效线索节点).includes(f.node));
  /*
    删项目前的确认框要「一共几条节点变更」。原来 include 里带 _count.logs：Prisma 把它写成「整张 ProjectNodeLog 先按项目分组数完、
    带着范围层的回避子查询，再按 id 接回来」，和取的是哪一个项目无关——8.6 万客户库拷贝上每次 270–300 ms（销售、销售管理进客户详情的大头，11-22 切页卡顿调研）。
    logs 是同一个关系、同一个范围，取回不到上限条就是全部，直接用条数；到了上限才另数一句（只数这一个项目）
  */
  const 留痕数 = 概况 ? 概况.条数 : p.logs.length < 留痕取几条 ? p.logs.length : await prisma.projectNodeLog.count({ where: { projectId: p.id } });
  const 详情: 项目详情 = {
    收藏了: await 项目收藏了吗(me.id, id),
    id: p.id, name: p.name, remark: p.remark, amount: p.amount, currency: p.currency,
    // 全称选填（11-19）：没全称的叫显名（简称 → 客户编号），项目资料卡「客户」那格不空白
    customer: 露 ? { id: p.customer.id, name: 客户显名(p.customer), school: p.customer.school } : null, contact: 露 ? p.contact : null,
    客户入口, 客户卡名: 客户入口 === "只读卡" ? { name: 客户显名(p.customer), school: p.customer.school } : null,
    // 在公海里 ownerName 给原负责人（界面写「原负责人 X」），企业版库里负责人已经清空，从留痕取；没这个人就是空串，界面写「暂无」
    ownerId: p.ownerId, ownerName: (公海 ? 叫(上一任) : 叫(p.ownerId)) ?? "", historyOwners: 历史负责人.map((x) => 叫(x)!), creatorName: 人名显示(p.creatorId, 名, { 创建人: true, 不在: "已不在的成员" }), createdAt: p.createdAt.toISOString(),
    phase: 现.phase, node: 现.node, result: 现.result, exceptionReason: p.exceptionReason, exceptionCategory: p.exceptionCategory?.name ?? null,
    pooled: 公海, 我是负责人: p.ownerId === me.id, 企业版: 企业, 出口叫法: 企业 ? 规则.阶段.出口叫法 : {}, 有效沟通差, ...(线索验证缺沟通 ? { 线索验证缺沟通 } : {}), 来源线索, ...(线索验证 ? { 线索验证, 线索验证必填 } : {}),
    原因选项: { 回收: 回收原因们, 无效: 无效原因们 },
    // 培育计划、无效原因字数上限（M-节点-03）：组织规则里管理员设的，没设 = null = 不限
    ...(企业 ? { 字数上限: { 培育计划: 规则.阶段.培育计划上限, 无效原因: 规则.阶段.无效原因上限 } } : {}),
    // 下一步时间只有日子：在服务端按业务日排成 YYYY-MM-DD，和回收日同一个钟，浏览器在别的时区也不差一天
    nextStepAt: p.nextStepAt ? dayjs(p.nextStepAt).format("YYYY-MM-DD") : null, nextStepText: p.nextStepText ?? null, 回收日, 验证不收, 回收预演,
    ...(企业 ? { expectedDealAt: p.expectedDealAt ? dayjs(p.expectedDealAt).format("YYYY-MM-DD") : null } : {}), ...企业项目字段,
    // 指定回复时间（11-17）：北京墙钟「YYYY-MM-DD HH:mm」，没填 null（lib/project/time-fields.ts）
    ...(企业 ? { 指定回复: { 开始: 时刻转北京墙钟(p.replyStartAt), 结束: 时刻转北京墙钟(p.replyEndAt) } } : {}),
    // 超时未跟进自动转过、客户留在别人名下（11-17，规则 3 的例外）：负责人本人看到「该客户在 XXX 名下」
    ...(企业 && !公海 && p.ownerId === me.id ? await 客户名下提示(p) : {}),
    // 主动放弃（豁免，32H）：负责人本人、新分配、还没记有效沟通才有
    ...(企业 && !公海 && p.ownerId === me.id && p.phase === "线索" ? await 放弃入口of(me, p.id) : {}),
    // 指定分配时间（PR3）：还没到点的定时，详情上写时间和分给谁；录入人、能分配的人能改 / 取消 / 改成现在分配
    ...(企业 && p.scheduledAssignAt && p.awaitAssignAt && !p.pooledAt ? { 定时分配: {
      时间: 时刻转北京墙钟(p.scheduledAssignAt)!, 给谁: p.scheduledAssignTo ? 叫(p.scheduledAssignTo) ?? "已不在的成员" : null, 能动: !!org && 能动定时(me, p, org),
    } } : {}), 要下一步, 能记沟通, ...(能记售后回访 ? { 能记售后回访: true } : {}), ...(能排下次回访 ? { 能排下次回访: true } : {}), 组员记沟通: 能记沟通 && !能改, 可改沟通, 可删沟通, ...(本人候选.size ? { 服务器现在: 现在.toISOString() } : {}), 必填, 不给推, 不给推谁能推, 交付只在尾款, 能改节点: 节点能改, ...(企业 && p.customer.pool ? { 客户在公海: true } : {}), 能转让: 能转,
    // 转给谁以后自己还看得到（11-03 A5-3）：总管理、上级转给下属照样能看，提示不说「看不到」，转完也不跳回列表。
    // 按转完的样子算：转让走 换负责人，同时清待分配（owner-write.ts）——不清的话本线管理靠「待分配放开」看得到，会误算成转给圈外的人也还能看（#392 审查）
    ...(企业版() && 能转 ? { 转后还能看: 候选.filter((c) => 能看项目(me, { ...p, ...换负责人(c.id), 已加入 }, org)).map((c) => c.id) } : {}),
    能放公海: !公海 && 能放回公海(me, p, org) && (能进公海的阶段 as readonly string[]).includes(p.phase) && !(企业 && p.result), // 已结束的不能单独放回（X-70）
    // 企业版删项目：项目负责人本人或系统管理员（V3.5.1，进回收站）；别的版本照旧按 能改
    能删: 企业 ? !占位 && 能删除(me, org, 公海 ? null : p.ownerId) : 能改,
    // 项目组员（V3.5.1）：进了组就能往组里拉人
    能加组员: 能加组员(me, p, org, 已加入.includes(me.id)),
    // 公海里的项目系统管理员能改组员（X-72）
    能改组员: 能改组员(me, p, org),
    // 原负责人领不回（企业版按 pool-rules.ts，别的版本本来就不能自己领回）；企业版按钮灰着摆、别的版本照旧不摆
    // 没设业务角色、只读管理员（11-03 D3-7 ④）：「领取」整个不摆，灰的也不摆
    能领取: 公海 && 能领 && (企业 ? !原负责人领不回 && !p.result && !拦单独领项目() && !拦客户公海里的项目(!!p.customer.pool) : me.id !== 上一任),
    // 项目不能单独领（10-31 晚定）：按钮灰着、说去领客户
    领取不给: !能领 ? null : 原负责人领不回 ? 原负责人不能领回提示 : 公海 && 企业 && p.result ? `这个项目已经结束（${p.result}），不能单独领取` : 公海 && 拦单独领项目() ? 项目不能单独领提示 : 公海 && 拦客户公海里的项目(!!p.customer.pool) ? 客户在公海项目不单领提示 : null,
    进公海: 最近放回 ? { 方式: 认放回(最近放回.reason), 谁: 叫(最近放回.userId)! } : null,
    // 最近一次是不是我放回的：公海提示条只对放回的那位说「是你放回去的」，别人（如看别人退回的管理员）不说。
    // 最近放回认的是不限条数的放回留痕；系统超时收回的操作人是「系统」，不算我；没留痕的老数据按原负责人认
    放回的是我: 公海 && (最近放回 ? 最近放回.userId === me.id : 上一任 === me.id),
    balanceSettled: p.balanceSettled, balanceSettledBy: 叫(p.balanceSettledById), balanceSettledAt: p.balanceSettledAt?.toISOString() ?? null,
    acceptancePassed: p.acceptancePassed, acceptancePassedBy: 叫(p.acceptancePassedById), acceptancePassedAt: p.acceptancePassedAt?.toISOString() ?? null,
    logs: p.logs.map((l) => ({
      id: l.id, at: l.at.toISOString(), who: 叫(l.userId)!,
      from: l.fromNode ? { phase: l.fromPhase ?? "", node: l.fromNode, result: l.fromResult } : null,
      to: { phase: l.toPhase, node: l.toNode, result: l.toResult }, reason: l.reason,
      category: l.categoryId ? 类别名.get(l.categoryId) ?? "已不在的类别" : null,
      kind: l.kind === "transfer" || l.kind === "pool-release" || l.kind === "pool-claim" ? l.kind : "node",
      transfer: l.kind === "node" ? null : { from: 叫(l.fromOwnerId) ?? "没人", to: 叫(l.toOwnerId) ?? "没人" },
      ...(l.kind === "pool-release" ? { 放回方式: 认放回(l.reason) } : {}),
    })),
    followUps: (露沟通 ? p.followUps : [])
      .map((f) => {
        const 编 = 编号.get(f.followUp.id);
        // 记录人本人 30 分钟内能改（11-19）：还能往这个项目记沟通才给；原本就能改的（可改沟通）界面上照旧不看这个
        const 本人可改 = 本人候选.has(f.followUp.id);
        const 跟着改下一步 = 本人可改 && 能改 && 下一步跟着改of(me, f.followUp, { ownerId: p.ownerId, 最近一条id: 最近一条, 能管: 能改, 写过下一步: 最近写过下一步 }, 现在);
        return {
          id: f.followUp.id, type: f.followUp.type, method: f.followUp.method, initiator: f.followUp.initiator, content: f.followUp.content, occurredAt: f.followUp.occurredAt.toISOString(), who: 叫(f.followUp.ownerId)!, node: f.node, 版本: f.followUp.updatedAt.toISOString(),
          ...(编 ? { code: 编.code, 提醒: 编.nextAt ? 时限标签(编.nextAt) : null } : {}),
          ...(企业 ? { ...(带附件的.has(f.followUp.id) ? { 附件: 沟通附件.get(f.followUp.id) ?? [] } : {}), 我记的: f.followUp.ownerId === me.id, 接手前: f.followUp.ownerId !== p.ownerId } : {}),
          ...(本人可改 ? { 本人可改到: 本人可改到(f.followUp.createdAt).toISOString() } : {}),
          ...(跟着改下一步 ? { 下一步: { 文字: p.nextStepText ?? "", 时间: 编?.nextAt ? dayjs(编.nextAt).format("YYYY-MM-DD") : null } } : {}),
          ...(改过的.has(f.followUp.id) ? { 已修改: true } : {}),
          ...(f.followUp.afterSale ? { 售后回访: true } : {}),
        };
      })
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
    members: p.members.map((m) => ({ id: m.id, userId: m.userId, name: 叫(m.userId)!, roleId: m.roleId, inviteStatus: m.inviteStatus })),
    提成,
    ...(联系人附件 ? { 联系人附件 } : {}),
    ...(画像 ? { 画像 } : {}),
    ...(关联 ? { 关联 } : {}),
    ...(项目附件 ? { 项目附件 } : {}),
    ...(回款们 ? { 回款们 } : {}),
    删前清点: { 留痕: 留痕数, 组员: p.members.length, 沟通: p.followUps.length },
  };
  return {
    种: "有", customerId: p.customerId, 露, 客户入口,
    props: { 卡点, 教练主题, p: 详情, 能改, 候选, 在职, 联系人们, 角色们: 角色们.map((r) => ({ id: r.id, name: r.name, active: r.active })), 类别们: 类别们.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name })) },
  };
}

/** 结局线索流失的细分（P-界面-66）：归项目合并 / 重复线索的给，其他线索流失、别的结局不给 */
async function 流失细分of(p: { id: string; result: string | null; closedAt: Date | null }): Promise<Pick<项目详情, "流失细分">> {
  const 类 = (await 线索流失细分([p])).get(p.id);
  return 类 === "项目合并" || 类 === "重复线索" ? { 流失细分: 类 } : {};
}

/** 这个项目并进了别的项目、合并单没撤回：那一张（能撤 和历史变更同一个预判；过了撤回期限照样写已并入，不带撤回、写明「合并已超过 N 天，不能撤回」——
 *  谁看都一样，系统管理员也不能代撤。没权的其他原因（不是合并的人、转给了别人……）照旧不写） */
async function 已并入of(me: SessionUser, projectId: string): Promise<项目详情["已并入"]> {
  const m = (await 项目的合并单(prisma, projectId, me)).find((x) => x.方向 === "并出去" && x.status === "已合并");
  return m ? { mergeId: m.id, 到id: m.到id, 到: m.到, at: m.at, 谁: m.谁, 能撤: m.能撤, ...(m.过期 ? { 过期话: 项目合并撤回过期话 } : {}) } : null;
}

/** 「并进另一个项目」那一项：null = 不摆；灰 = 摆着灰、悬停写原因（候选同 能并进的项目：同客户、同负责人、在推的；灰着列的候选也算有，框里写原因） */
async function 并进菜单(
  me: SessionUser, org: Awaited<ReturnType<typeof 权限组织>>,
  p: { id: string; customerId: string; ownerId: string | null; phase: string; result: string | null; pooledAt: Date | null; awaitAssignAt: Date | null; contractStatus: string | null },
): Promise<{ 灰?: string } | null> {
  if (!org || 只读角色(me, org) || 只看的人(org, me.id) || p.pooledAt || p.awaitAssignAt) return null;
  if (!是系统管理员(me, org) && p.ownerId !== me.id) return null;
  if (p.result) return { 灰: `项目已经结束（${p.result}），不能再并` };
  if (!能并的阶段.并掉.includes(p.phase)) return { 灰: `在${p.phase}阶段，只有${能并的阶段.并掉.join("、")}阶段的项目能并进另一个项目` };
  if (签了合同(p)) return { 灰: 已签合同的项目不能合并 };
  return (await 有并进的候选(prisma, { id: p.id, customerId: p.customerId, ownerId: p.ownerId ?? "" })) ? {} : { 灰: "这位客户名下没有同一位负责人在推的别的项目" };
}

/** 「把同事的项目并进来」那一项：null = 不摆；没有候选 / 结束了 / 不在线索阶段不摆。摆给留下项目的负责人本人、系统管理员、和任一候选的确认人（上级从下属的项目页也能发直接并，审查建议 S2，服务端发起前判本来就认）；候选 = 同客户别人负责、线索阶段在推的 */
async function 跨并菜单(
  me: SessionUser, org: Awaited<ReturnType<typeof 权限组织>>,
  p: { id: string; customerId: string; ownerId: string | null; phase: string; result: string | null; pooledAt: Date | null; awaitAssignAt: Date | null },
): Promise<{ 灰?: string } | null> {
  if (!org || 只读角色(me, org) || 只看的人(org, me.id) || p.pooledAt || p.awaitAssignAt || !p.ownerId) return null;
  // 结束了、不在线索阶段、客户名下没有同事在推的线索项目：不摆（跟「并进另一个项目」不同，这一项多数人用不上，灰着摆只会添乱）
  if (p.result || !能并的阶段.留下.includes(p.phase)) return null;
  // 我既不是留下的负责人、也不可能是任何人的确认人（不是系统管理员 / 条线总管理 / 谁的上级）：不用查候选（省一句）
  if (p.ownerId !== me.id && !可能是确认人(org, me.id)) return null;
  const 主 = p.ownerId;
  const 候选们 = await 看全部(() => prisma.project.findMany({
    where: { customerId: p.customerId, id: { not: p.id }, ownerId: { not: 主, notIn: [""] }, deletedAt: null, result: null, pooledAt: null, awaitAssignAt: null, phase: "线索" },
    select: { ownerId: true, bizLine: true }, take: 30,
  }));
  const 我能发 = 是系统管理员(me, org) || p.ownerId === me.id
    ? 候选们.length > 0
    : 候选们.some((b) => b.ownerId && 算确认人(org, { ownerId: b.ownerId, bizLine: b.bizLine }).some((x) => x.userId === me.id));
  return 我能发 ? {} : null;
}

/** 这个项目有一张等确认的跨负责人合并申请（当留下的或被并走的）：顶上那一行写等谁、验证计时暂停。没有给 null。人名现查，没读到的不写 */
async function 跨并待确认of(me: SessionUser, org: Awaited<ReturnType<typeof 权限组织>>, projectId: string): Promise<项目详情["跨并待确认"]> {
  const r = await 看全部(() => prisma.entProjectMergeRequest.findFirst({
    where: { status: 跨并状态.待确认, expiresAt: { gt: new Date() }, OR: [{ fromProjectId: projectId }, { intoProjectId: projectId }] },
    select: { id: true, fromProjectId: true, intoProjectId: true, byUserId: true, confirmerIds: true, fromOwnerId: true, expiresAt: true },
  }));
  if (!r) return null;
  const 们 = (() => { try { return JSON.parse(r.confirmerIds) as { userId: string; 层级: string }[]; } catch { return []; } })();
  const 另一 = r.fromProjectId === projectId ? r.intoProjectId : r.fromProjectId;
  const [人们, 另项, 被并项] = await 看全部(() => Promise.all([
    prisma.user.findMany({ where: { id: { in: 们.map((x) => x.userId) } }, select: { id: true, name: true } }),
    prisma.project.findFirst({ where: { id: 另一 }, select: { name: true } }),
    prisma.project.findFirst({ where: { id: r.fromProjectId }, select: { bizLine: true } }),
  ]));
  const 叫 = new Map(人们.map((u) => [u.id, u.name]));
  return {
    requestId: r.id, 角色: r.fromProjectId === projectId ? "并走" : "留下", 另一个: 另项?.name || "另一个项目",
    等: 们.map((x) => `${叫.get(x.userId) ?? "同事"}（${x.层级}）`).join("、"), 到期: r.expiresAt.toISOString(),
    我发起: r.byUserId === me.id, 我确认: 是确认人of(org, r, 被并项?.bizLine, me.id),
  };
}
