import { notFound } from "next/navigation";
import { prisma, defaultClient } from "@/lib/prisma";
import { 只读客户 } from "@/lib/team-scope";
import { requireUser } from "@/lib/auth";
import { getBusiness } from "@/lib/business";
import { 能管项目, 能改节点, 代管节点, 往前推不给, 补全期不给, 直属才推, 角色字典, 异常类别字典, 能进公海的阶段, 看得到的客户, 露客户, 读必填数据 } from "@/lib/project/db";
import { 按必填走, 节点必填, 还差 } from "@/lib/project/required";
import { 负责人候选 } from "@/lib/owners";
import { 企业版 } from "@/lib/enterprise/switch";
import { 可选渠道们 } from "@/lib/enterprise/channel-options";
import { llmEnabled } from "@/lib/llm";
import { 已立项天数 } from "@/lib/project/project-fields";
import { 可选项 } from "@/lib/enterprise/dict";
import { 读组织 } from "@/lib/enterprise/org";
import { 能删改沟通 } from "@/lib/enterprise/follow-perm";
import { 沟通附件们 } from "@/lib/attachments";
import type { 附件 } from "@/lib/attachment-rules";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 负责人可推 } from "@/lib/project/org-rules";
import { 读项目提成 } from "@/lib/project/commission-db";
import { 超时回收日, 超时起点, 超时理由, 系统, 节点超时天数, 计时起点 } from "@/lib/project/timeout";
import { 停用项目进公海理由 } from "@/lib/offboard-db";
import { 拦原负责人, 原负责人不能领回提示, 拦单独领项目, 项目不能单独领提示 } from "@/lib/enterprise/pool-rules";
import { 字典of } from "@/lib/project/stage-dict";
import { 本套位置 } from "@/lib/project/nodes";
import { 有效沟通数 } from "@/lib/project/stage-gates";
import { 读线索验证 } from "@/lib/project/lead-verify";
import { dayjs } from "@/lib/utils";
import { 项目的卡点, 能发卡点, 读卡点默认, 卡点可选的人, 卡点给界面, 沟通编号们 } from "@/lib/project/blocker";
// 附件接口认权限的同一份（不是路由文件，只是放在接口旁边）：项目页给不给入口、能不能传删和接口一个口径
import { 联系人附件入口, 项目附件入口 } from "@/app/api/attachments/access";
import { 列回款 } from "@/lib/project/payment-db";
import { 项目画像项, 其他项, 字典定义 } from "@/lib/enterprise/dict-kinds";
import { 读产品需求 } from "@/lib/project/profile-rules";
import { 项目关联们 } from "@/lib/project/relate";
import { 字段权限of } from "@/lib/enterprise/field-perm";
import { 合同状态显示 } from "@/lib/project/proj-fields";
import type { 项目画像 } from "./ProjectExtras";
import ProjectDetail, { type 项目详情, type 项目卡点, type 放回方式 } from "./ProjectDetail";

export const dynamic = "force-dynamic";

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

/** 项目详情（团队版项目模式 1a）：改节点、勾尾款 / 验收、节点变更和挂在项目上的沟通。开关关着时不存在 */
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  if ((await getBusiness()).projectMode !== true) notFound();
  const { id } = await params;
  const p = await prisma.project.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, school: true, lastFollowAt: true, salesOwnerId: true, channelOwnerId: true, pool: { select: { customerId: true } }, channel: { select: { name: true } } } },
      channel: { select: { name: true } },
      contact: { select: { id: true, name: true, position: true } },
      exceptionCategory: { select: { name: true } },
      logs: { orderBy: { at: "desc" }, take: 200 },
      members: { orderBy: { createdAt: "asc" } },
      followUps: { include: { followUp: { select: { id: true, type: true, method: true, content: true, occurredAt: true, ownerId: true, updatedAt: true } } } },
      _count: { select: { logs: true } },
    },
  });
  if (!p) notFound();
  const 能改 = 能管项目(me, p);
  // 公海里同事客户的项目：只给项目本身，客户、联系人、沟通内容领了再看（lib/project/db.ts 露客户）
  const 露 = 露客户(me, p, await 看得到的客户([p.customerId]));
  const [候选, 在职, 联系人们, 角色们, 类别们, 放回过, 规则] = await Promise.all([
    负责人候选(),
    prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
    能改 ? prisma.contact.findMany({ where: { customerId: p.customerId }, select: { id: true, name: true, position: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] }) : [],
    角色字典(),
    异常类别字典(),
    // 历史负责人（企业版才显示）：放回过公海的人。单独查，不受上面节点变更只取 200 行的限
    !企业版() ? [] : prisma.projectNodeLog.findMany({ where: { projectId: p.id, kind: "pool-release" }, orderBy: { at: "desc" }, select: { fromOwnerId: true } }),
    生效组织规则(),
  ]);
  const 类别名 = new Map(类别们.map((c) => [c.id, c.name]));
  // 10-26 验收 #13：线索转出来的项目记着是哪条线索来的。线索后来删了就只说「已删除」
  const 来源线索 = !p.sourceLeadId || !露 ? null
    : await prisma.lead.findUnique({ where: { id: p.sourceLeadId }, select: { name: true, convertedAt: true } }).then((l) => ({ name: l?.name ?? null, convertedAt: l?.convertedAt ? dayjs(l.convertedAt).format("YYYY-MM-DD") : null }));
  const 公海 = !!p.pooledAt;
  const 企业 = 企业版();

  const 历史负责人 = [...new Set(放回过.map((l) => l.fromOwnerId).filter((x): x is string => !!x))];
  const 人id = new Set<string>([...历史负责人, p.ownerId, p.creatorId, ...p.members.map((m) => m.userId), ...p.logs.flatMap((l) => [l.userId, l.fromOwnerId, l.toOwnerId].filter((x): x is string => !!x)), ...(露 ? p.followUps.map((f) => f.followUp.ownerId) : [])]);
  for (const x of [p.balanceSettledById, p.acceptancePassedById]) if (x) 人id.add(x);
  const 人 = await prisma.user.findMany({ where: { id: { in: [...人id] } }, select: { id: true, name: true } });
  const 名 = new Map(人.map((u) => [u.id, u.name]));
  // 超时回收记在「系统」名下（timeout.ts 系统，QA #16），不是真成员
  const 叫 = (uid: string | null) => (uid ? (uid === 系统.id ? 系统.name : 名.get(uid) ?? "已不在的成员") : null);
  // 怎么进的公海：超时系统收的 / 办停用时放的（操作人是办的那位管理员，不是离职的人）/ 有人手动放回（QA #14）
  const 认放回 = (reason: string | null): 放回方式 => (reason === 超时理由 ? "超时" : reason === 停用项目进公海理由 ? "停用" : "手动");
  const 最近放回 = 公海 ? p.logs.find((l) => l.kind === "pool-release") : undefined;
  // 企业版「非原负责人均可领取」：原负责人看得到领取按钮、灰着（pool-rules.ts）
  const 原负责人领不回 = 公海 && me.id === p.ownerId && 拦原负责人();

  // 企业版超时回收：线索 / 商机阶段记沟通要填下一步时间；算出哪天会自动回公海（和 lib/project/db.ts 公海超时收回 同一个起点）
  const 要下一步 = 规则.超时回收.开 && !p.result && (能进公海的阶段 as readonly string[]).includes(p.phase);
  const 字典 = 字典of(企业, 企业 ? 规则.阶段.出口叫法 : null);
  const 回收起点 = 超时起点(p.createdAt, p.logs[0]?.at, p.customer.lastFollowAt);
  const 回收日 = 超时回收日(规则, p, 回收起点, 字典);
  const 能记沟通 = 企业 && !公海 && (能改 || p.members.some((m) => m.userId === me.id && m.inviteStatus === "JOINED"));
  // 沟通的「…」菜单（改 / 删，10-29）：能记沟通、客户看得到，且不是同事 / 虚线下属的客户（和客户页不摆编辑删除同一条，服务端 改项目沟通 / 删项目沟通 再挡一遍）。
  // M-权限-09（10-31）：普通成员记完不能改、不能删，只有总管理员和经理（lib/enterprise/follow-perm.ts）
  const 可改沟通 = 能记沟通 && 露 && !(await 只读客户(defaultClient, p.customer)) && (await 能删改沟通(me));
  // 企业版节点必填：这个节点配了必填才给；还差哪几样和 lib/project/db.ts 按必填推进 同一个算法
  // 企业版 D-37：直属上级（账号可能还是 SALES）、总管理员能改节点；负责人有直属上级时往前推只给直属上级和老板（都和 lib/project/db.ts 改节点 同一个判断）
  const org = 企业 ? await 读组织() : null;
  const 节点能改 = 能改节点(me, p, org);
  const 必填 = !公海 && !p.result && 按必填走(规则, p.node)
    ? { 配了: 节点必填(规则, p.node), 还差: 还差(规则, await 读必填数据(prisma, p)), 只能靠填齐: me.role !== "ADMIN" && me.role !== "MANAGER" && !代管节点(me, p.ownerId, org) }
    : null;
  // 记沟通时预演回收日（10-30 P0-2，lib/enterprise/recycle-text.ts 预演回收日）：给起点日和这个进程的天数，浏览器按同一个算法算。
  // 配了必填的进程记完可能自动推到下一个进程（天数跟着换），算不准就不给，界面不显示那一句
  const 回收天数 = 企业 && 要下一步 && 回收日 && !必填 ? 节点超时天数(规则, p.node, 字典) : null;
  const 回收预演 = 回收天数 ? { 起点日: 计时起点(规则, 回收起点).format("YYYY-MM-DD"), 天数: 回收天数 } : null;
  // 需求状态补全期（M-权限-07）开着：只有经理、总管理员能往前推，和 lib/project/db.ts 改节点 同一个判断
  const 不给推 = 企业 && !公海 && !p.result ? 补全期不给(me, org, 规则) ?? 往前推不给(me, p.ownerId, await 直属才推(org), 负责人可推(规则)) : null;
  // 企业版：线索验证往后推要先有一条客户明确回复的沟通（lib/project/stage-gates.ts）
  const 有效沟通 = 企业 && p.phase === "线索" ? await 有效沟通数(prisma, p.id) : 0;
  // 企业版提成卡：只给组长、已进组的组员、管理员、主管和负责人的上级（lib/project/commission-db.ts 能看提成）；不是企业版不查
  const 提成 = 企业 ? await 读项目提成(me, p, p.members.filter((m) => m.inviteStatus === "JOINED").map((m) => m.userId), org, (uid) => 叫(uid)!, prisma) : null;

  // 企业版卡点（lib/project/blocker.ts）：沟通编号、时限提醒、卡点列表和发卡点；别的版本一样不查
  const [编号, 卡点们, 能发, 卡点默认, 卡点人们] = 企业
    ? await Promise.all([沟通编号们(露 ? p.followUps.map((f) => f.followUp.id) : []), 项目的卡点(me, p.id), 能发卡点(me, p.id), 读卡点默认(), 卡点可选的人(me, p.id)])
    : [new Map<string, { code: string; nextAt: Date | null }>(), [], false, null, []];
  const 卡点: 项目卡点 | null = 企业 && 卡点默认 ? { 们: 卡点们.map(卡点给界面), 能发: 能发 && 露, 默认: 卡点默认, 人们: 卡点人们 } : null;
  // 企业版联系人附件（2026-10-28）：项目卡联系人那一行下面给「附件」，和客户页同一个弹窗；不是企业版、公海里没领的不查
  const 联系人附件 = 企业 && 露 && p.contact ? await 联系人附件入口(p.contact.id) : null;
  // 企业版字典下拉（10-27）：不是企业版 可选项 给空
  const [回收原因们, 无效原因们] = await Promise.all([可选项("recycle"), 可选项("invalid")]);
  // 企业版项目来源 / 已立项天数 / AI 录入（10-29 P6）：项目自己选了渠道就用它，没选跟客户来源走（和渠道统计 lib/enterprise/channel-stats.ts 同一条规则）
  // 痛点标注、合同状态（迁移 101）：字段权限「藏」的那一项不给值（界面不摆那一行、编辑框不交那一项）
  const 权限 = 企业 ? await 字段权限of(me.id) : null;
  const 企业项目字段 = !企业 ? {} : {
    项目来源: p.channel ? { name: p.channel.name, 跟客户: false } : 露 && p.customer.channel ? { name: p.customer.channel.name, 跟客户: true } : null,
    channelId: p.channelId,
    已立项天数: 已立项天数(p.createdAt),
    ...(能改 ? { 渠道们: await 可选渠道们(p.channelId) } : {}),
    aiEnabled: 能记沟通 && 露 ? await llmEnabled() : false,
    // 项目级别、所在地（P11 定稿 -2 版，迁移 093）：级别是项目自己的，都给看；所在地跟客户资料一样，公海里同事客户的项目没领之前不给
    level: p.level,
    所在地: 露 ? { addrCountry: p.addrCountry, addrProvince: p.addrProvince, addrCity: p.addrCity, addrDistrict: p.addrDistrict, location: p.location } : null,
    // 成交需求、合同金额、定金金额（迁移 097）：和金额一样是项目自己的，都给看
    成交钱: { dealDemand: p.dealDemand, contractAmount: p.contractAmount, contractCurrency: p.contractCurrency, depositAmount: p.depositAmount, depositCurrency: p.depositCurrency },
    // 合同状态库里空的（老项目）按「起草中」显示，不改库
    项目新字段: {
      ...(权限?.("痛点标注") !== "藏" ? { painPoints: p.painPoints } : {}),
      ...(权限?.("合同状态") !== "藏" ? { contractStatus: 合同状态显示(p.contractStatus) } : {}),
    },
  };
  // 企业版线索验证（P12）：状态、时间线、我现在能做哪一步；不是企业版不查
  const 线索验证 = 企业 && p.phase === "线索" ? await 读线索验证(me, p) : null;
  // 企业版项目画像、项目附件（P11）：画像和附件是客户那边的资料，公海里同事客户的项目没领之前不给（同 联系人附件）。
  // 项目名单在中栏（@pane/projects/[id] → panes.tsx 项目名单），不在这页里读
  const 存的需求 = 读产品需求(p.productNeeds);
  const 画像: 项目画像 | null = !企业 || !露 ? null : {
    项们: await Promise.all(项目画像项.map(async (项) => {
      // 选项 = 启用着的 + 这个项目已经存着、后来停用的（不然下拉里显示成一串值）；「其他」要另写一句，这里一改就存，不给选
      const 存着 = 项.多选 ? 存的需求 : [p[项.键]].filter((x): x is string => !!x);
      const 启用 = (await 可选项(项.种类)).filter((x) => x !== 其他项);
      return { 键: 项.键, 名: 字典定义[项.种类].名, 多选: 项.多选, 选项: [...启用, ...存着.filter((x) => !启用.includes(x))] };
    })),
    值: Object.fromEntries(项目画像项.map((项) => [项.键, 项.多选 ? 存的需求 : p[项.键]])) as 项目画像["值"],
  };
  const 项目附件 = 企业 && 露 ? await 项目附件入口(p.id) : null;
  // 企业版沟通记录的截图、录音（F-跟进-07）：和沟通记录同一个口径（露客户才给）；传 = 记这条的本人或能改沟通的，删 = 能改沟通的（api/attachments/access.ts 认沟通）
  const 沟通附件 = 企业 && 露 && p.followUps.length ? await 沟通附件们(prisma, p.followUps.map((f) => f.followUp.id)) : new Map<string, 附件[]>();
  // 企业版回款（10-31，迁移 100）：和合同金额一样是项目自己的钱，都给看
  const 回款们 = 企业 ? await 列回款(p.id) : null;
  // 企业版关联客户 / 联系人（P17）：同画像，公海里同事客户的项目没领之前不给
  const 关联 = 企业 && 露 ? await 项目关联们(me, p.id) : null;
  // 库里存着旧节点名 / 旧结局的（企业版 10-31 改名）按这套的新名给界面；节点变更历史（logs）照原样
  const 现 = 本套位置({ phase: p.phase, node: p.node, result: p.result }, 字典);
  const 详情: 项目详情 = {
    id: p.id, name: p.name, remark: p.remark, amount: p.amount, currency: p.currency,
    customer: 露 ? { id: p.customer.id, name: p.customer.name, school: p.customer.school } : null, contact: 露 ? p.contact : null,
    ownerId: p.ownerId, ownerName: 叫(p.ownerId)!, historyOwners: 历史负责人.map((x) => 叫(x)!), creatorName: 叫(p.creatorId)!, createdAt: p.createdAt.toISOString(),
    phase: 现.phase, node: 现.node, result: 现.result, exceptionReason: p.exceptionReason, exceptionCategory: p.exceptionCategory?.name ?? null,
    pooled: 公海, 企业版: 企业, 出口叫法: 企业 ? 规则.阶段.出口叫法 : {}, 有效沟通, 来源线索, ...(线索验证 ? { 线索验证 } : {}),
    原因选项: { 回收: 回收原因们, 无效: 无效原因们 },
    // 下一步时间只有日子：在服务端按业务日排成 YYYY-MM-DD，和回收日同一个钟，浏览器在别的时区也不差一天
    nextStepAt: p.nextStepAt ? dayjs(p.nextStepAt).format("YYYY-MM-DD") : null, nextStepText: p.nextStepText ?? null, 回收日, 回收预演,
    ...(企业 ? { expectedDealAt: p.expectedDealAt ? dayjs(p.expectedDealAt).format("YYYY-MM-DD") : null } : {}), ...企业项目字段, 要下一步, 能记沟通, 可改沟通, 必填, 不给推, 能改节点: 节点能改,
    能放公海: !公海 && me.id === p.ownerId && (能进公海的阶段 as readonly string[]).includes(p.phase),
    // 原负责人领不回（企业版按 pool-rules.ts，别的版本本来就不能自己领回）；企业版按钮灰着摆、别的版本照旧不摆
    能领取: 公海 && (企业 ? !原负责人领不回 && !拦单独领项目() : me.id !== p.ownerId),
    // 项目不能单独领（10-31 晚定）：按钮灰着、说去领客户
    领取不给: 原负责人领不回 ? 原负责人不能领回提示 : 公海 && 拦单独领项目() ? 项目不能单独领提示 : null,
    进公海: 最近放回 ? { 方式: 认放回(最近放回.reason), 谁: 叫(最近放回.userId)! } : null,
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
    followUps: (露 ? p.followUps : [])
      .map((f) => {
        const 编 = 编号.get(f.followUp.id);
        return {
          id: f.followUp.id, type: f.followUp.type, method: f.followUp.method, content: f.followUp.content, occurredAt: f.followUp.occurredAt.toISOString(), who: 叫(f.followUp.ownerId)!, node: f.node, 版本: f.followUp.updatedAt.toISOString(),
          ...(编 ? { code: 编.code, 提醒: 编.nextAt ? 时限标签(编.nextAt) : null } : {}),
          ...(企业 ? { 附件: 沟通附件.get(f.followUp.id) ?? [], 我记的: f.followUp.ownerId === me.id } : {}),
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
    删前清点: { 留痕: p._count.logs, 组员: p.members.length, 沟通: p.followUps.length },
  };
  return <ProjectDetail key={p.id} 卡点={卡点} p={详情} 能改={能改} 候选={候选} 在职={在职} 联系人们={联系人们} 角色们={角色们.map((r) => ({ id: r.id, name: r.name, active: r.active }))} 类别们={类别们.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name }))} />;
}
