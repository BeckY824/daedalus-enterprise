"use server";

/**
 * 团队版项目模式 1a 的写（2026-10-23，D-31）。开关关着时每个动作都直接拦，一行不写。
 * 规矩在 lib/project/nodes.ts、读写在 lib/project/db.ts、建档向导在 lib/project/wizard.ts，这里只管登录、开关、操作日志和刷新。
 */
import { 能往项目记沟通 } from "@/lib/project/follow-needs-project";
import { revalidatePath } from "next/cache";
import { 读项目详情 } from "./[id]/load";
import type { 项目详情Props } from "./[id]/ProjectDetail";
import { prisma, defaultClient } from "@/lib/prisma";
import { 不能当负责人 } from "@/lib/owners";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { 不在了 } from "@/lib/not-there";
import { getBusiness } from "@/lib/business";
import { 读的我 } from "@/lib/team-scope";
import { 验号码, 号码类型叫法 } from "@/lib/enterprise/contact-format";
import { 验联系人号码, 企业号码查重, 全公司查号, 撞号结论, 记号码, 联系人号码撞了, 库类型到号码类型, 一行号全公司查, type 联系人的号, type 验好的号 } from "@/lib/enterprise/contact-dedupe";
import { 验联系人号码们, 号码种类表, 种类叫法, type 验好的行 } from "@/lib/enterprise/customer-v2-db";
import { 每人最多号码 } from "@/lib/enterprise/customer-v2";
import type { Prisma } from "@/generated/prisma";
import { 登记接着建, 记联系人带号 } from "@/lib/project/hook";
import { 签首条附件票 } from "@/lib/enterprise/first-follow-ticket";
import { 规整向导, 向导接着建, 规整只建客户, 只建客户接着建, 项目来源默认, 占位名提示, type 建好的, type 建好的客户, type 向导联系人, type 向导项目, type 向导跟进 } from "@/lib/project/wizard";
import { 补潜客培育 } from "@/lib/project/nurture";
import { 客户状态自动, 跟着项目重算 } from "@/lib/enterprise/cust-status-auto-db";
import { 带待办勾 } from "@/lib/project/carry-tasks";
import { 读必填数据, 能改节点, 上级只推, 直属才推, 只有负责人改进程, 改节点, 终止进程, 勾交付, 加角色, 改角色, 加异常类别, 改异常类别, 删项目, 交付项们, 改项目, type 编辑项目改动, 加组员, 回邀请, 换组员角色, 移出组员, 放回公海, 领取公海项目, 持有上限起点, 写前核上限, 整批超上限, 记项目沟通, 超时预览, 公海超时收回, 能进公海的阶段, 超时成员线, 超时线, 补回收起点留痕, 能管项目, type 交付项 } from "@/lib/project/db";
import { 合上改动, 是不限, 三态改动摘要, type 规则改动 } from "@/lib/project/org-rules";
import { 读组织规则, 生效组织规则, 存组织规则 } from "@/lib/project/org-rules-store";
import { 企业版 } from "@/lib/enterprise/switch";
import { 不能新建项目话, 是经理 } from "@/lib/enterprise/permissions";
import { 看全部 } from "@/lib/team-scope";
import { 挡改设置, 读改权限, 能改时限的节点, 挡时限改动, type 设置项名 } from "@/lib/enterprise/edit-perm";
import { 读组织, 权限组织 } from "@/lib/enterprise/org";
import { 新数据渠道不行, 落到渠道 } from "@/lib/enterprise/channel-main";
import { 是主渠道入口 } from "@/lib/enterprise/channel-main-core";
import { 认渠道触点, 渠道触点们, 新建来源还差 } from "@/lib/enterprise/touchpoint";
import { 指定问题 } from "@/lib/enterprise/assign-eta";
import { 记这个项目的自动推进, 客户存了推项目 } from "@/lib/project/auto-advance";
import { 记新建指定分配 } from "@/lib/enterprise/direct-assign";
import { 分给你通知, 项目分给你通知, 验证待办通知, 邀请通知, 转项目通知, 卡点发布通知, 项目被删通知, 项目放回公海通知, 市场改分通知 } from "@/lib/enterprise/notice-sources";
import { 算市场转客户, 转客户给销售 } from "@/lib/enterprise/market-transfer";
import { 市场分配进线索验证 } from "@/lib/enterprise/market-assign-node";
import { 超时回收日, 超时起点, 节点超时天数, 计时起点 } from "@/lib/project/timeout";
import { 项目按必填走, 是占位值, 还差 as 必填还差, 必填叫法 } from "@/lib/project/required";
import { dayjs } from "@/lib/utils";
import { 字典of } from "@/lib/project/stage-dict";
import type { 回收预演底子 } from "@/lib/enterprise/recycle-text";
import { 读团队 } from "@/lib/sync/client";
import { 要写原因, 本套位置, 节点序号, type 位置 } from "@/lib/project/nodes";
import { 判MQL, MQL合格去, MQL不合格去 } from "@/lib/project/mql";
import { 销售初判, 市场复核, 销售终验, 总管理终判, 销售认领, 撤回验证, type 初判 } from "@/lib/project/lead-verify";
import { saveCustomer, type CustomerInput } from "../customers/actions";
import { saveFollowUp, deleteFollowUp } from "../customers/[id]/actions";
import { 只读客户, 只读话 } from "@/lib/team-scope";
import { scheduleValue } from "@/lib/schedule-date";
import { 定分配方式, 建好再分, 认新建定时 } from "@/lib/project/after-create-assign";
import { 认业务线, 业务线必填 } from "@/lib/enterprise/assign-line";
import { 按区域分配of, 默认分配方向, 认分配方向, type 分配方向, type 定线号 } from "@/lib/enterprise/customer-region";
import { 本人线of } from "@/lib/enterprise/assign-direction-db";
import { 同号再次录入 } from "@/lib/enterprise/same-number-collab";
import { 字典定义, 项目画像项, 认跟进方式, 选的原因 } from "@/lib/enterprise/dict";
import { 改项目画像, type 画像改动, type 画像字段 } from "@/lib/project/profile";
import { 发布卡点, 读卡点默认, 能发卡点, 可选原因们 } from "@/lib/project/blocker";
import { 沟通卡点, type 沟通卡点输入, type 卡点默认 } from "@/lib/project/blocker-rules";
import { 短沟通提示 } from "@/lib/enterprise/tri-state-detail";
import { 存沟通后重算三态, 三态改天数预览 } from "@/lib/enterprise/tri-state-db";

const 没开 = { ok: false as const, error: "项目模式没开：请管理员在「设置 → 业务配置」里打开" };

async function 开着(): Promise<boolean> {
  return (await getBusiness()).projectMode === true;
}

function 刷新项目(projectId?: string, customerId?: string) {
  revalidatePath("/projects");
  if (projectId) revalidatePath(`/projects/${projectId}`);
  if (customerId) revalidatePath(`/customers/${customerId}`);
}

/** 要传附件：弹窗里给首条沟通挑了截图 / 附件（11-18）。交了 true 才回一张附件票（lib/enterprise/first-follow-ticket.ts），建好由浏览器凭票接着传 */
export type 建档向导输入 = { 客户: CustomerInput; 联系人: 向导联系人; 项目: 向导项目; 跟进: 向导跟进; 要传附件?: boolean };

/** 分配方向按电话判时看的号（11-18）：客户电话、企业号码（手机号）、联系人电话、联系人号码里的手机，按这个顺序 */
function 向导号们(input: Pick<建档向导输入, "客户" | "联系人">): 定线号[] {
  const 企号 = input.客户.企业号码?.类型 === "手机号" ? input.客户.企业号码.值 : null;
  const 行们 = Array.isArray(input.联系人?.号码们) ? input.联系人.号码们 : [];
  const 手机行 = 行们.filter((r) => r?.kind === "phone").map((r) => r.value);
  // WhatsApp（号码几行里 kind=whatsapp 的、客户 WhatsApp）排在电话后面，电话都判不出才看，按国际号读（审核 11-18 P1-6）
  const WA = [input.客户.extra?.whatsapp, ...行们.filter((r) => r?.kind === "whatsapp").map((r) => r.value)]
    .filter((x): x is string => typeof x === "string" && !!x.trim()).map((whatsapp) => ({ whatsapp }));
  return [...[input.客户.phone, 企号, input.联系人?.phone, ...手机行].filter((x): x is string => typeof x === "string" && !!x.trim()), ...WA];
}
/**
 * 新建弹窗没开「项目」开关（P-界面-36，11-15）：只建客户、主要联系人和首条沟通（团队版算客户沟通；企业版挂在新客户自带的潜客培育项目上，11-17）。
 * 首条沟通的截图 / 附件：企业版首条沟通挂在潜客培育项目上，交了 要传附件 同样签一张附件票、挂到这条首条沟通上（11-18 起）；
 * 团队版没建项目、首条沟通不挂项目，不签票
 */
export type 只建客户输入 = Omit<建档向导输入, "项目">;

/** 建档时指派给别人超了持有上限：「超了上限，」后面那半句 */
const 建档超上限尾 = "客户和项目都没有建；先推进或放回一些，或者换一位负责人";

/**
 * 建档向导的最后一步：客户、主要联系人、项目、首条跟进一笔建好。
 * 客户查重撞了、哪一步写失败了，整笔都不留；中途关掉向导时根本没走到这里
 */
export async function 建档向导(输入: 建档向导输入) {
  try {
    const me = await requireUser();
    const 挡 = await 建档前挡(me, 输入);
    if (挡) return 挡;
    // 企业版分配方式（A7，10-27）：只能用分配方式字典里这个人能用、还启用着的那几种（assign-use.ts）。
    // 指定分配 = 负责人是选的那位；另外四种都先建在我名下，自动分配建好后按自动分配转出去、公海捞取建好后放进项目公海
    const 分配 = 企业版() ? await 定分配方式(me, 输入.项目) : null;
    if (分配 && "error" in 分配) return { ok: false as const, error: 分配.error };
    // 指定分配时间（11-17 PR3）：选了「指定时间」= 先建在我名下待分配（定时），到点再分；指定分配的接手人就是选的负责人
    const 定时 = 分配 && 输入.项目 ? 认新建定时(分配, 输入.项目.定时分配, 输入.项目.ownerId) : null;
    if (定时 && "error" in 定时) return { ok: false as const, error: 定时.error };
    if (定时?.接手人) {
      const 接 = await prisma.user.findUnique({ where: { id: 定时.接手人 }, select: { active: true } });
      if (!接?.active) return { ok: false as const, error: "项目负责人不存在或已停用，请选一位在职成员" };
      const 问题 = (await 不能当负责人(定时.接手人)) ?? (await 指定问题(await 读组织(), 定时.接手人));
      if (问题) return { ok: false as const, error: 问题 };
    }
    let input = 分配 && (分配.i !== 0 || 定时)
      ? { ...输入, 客户: { ...输入.客户, salesOwnerId: me.id }, 项目: { ...输入.项目, ownerId: me.id } }
      : 输入;
    // 来源选的是「只有主渠道」的占位（没有子渠道的主渠道）：先落成子渠道名留空的那条渠道，后面一律按真的渠道 id 走（channel-main.ts 落到渠道）
    if (企业版()) {
      const 客源 = await 落到渠道(input.客户.channelId ? String(input.客户.channelId) : null, me);
      if (!客源.ok) return { ok: false as const, error: 客源.error };
      const 项源 = await 落到渠道(input.项目?.channelId ? String(input.项目.channelId) : null, me);
      if (!项源.ok) return { ok: false as const, error: 项源.error };
      if (是主渠道入口(input.客户.channelId) || 是主渠道入口(input.项目?.channelId)) {
        input = { ...input, 客户: { ...input.客户, channelId: 客源.id }, 项目: input.项目 ? { ...input.项目, channelId: 项源.id } : input.项目 };
      }
    }
    // 开了超时回收：项目建在线索阶段，首条跟进也得填下一步时间
    const 规则 = await 生效组织规则();
    // 下一步时间：开了超时回收必填；企业版没开也能选填（验收 #4）；不是企业版没有这格，老草稿里留着的也不认、不写，和原来一样
    const 要下一步 = 规则.超时回收.开;
    const 认 = input.跟进 ? await 认跟进方式(input.跟进) : input.跟进;
    if (认 && "error" in 认) return { ok: false as const, error: 认.error };
    const 带方式 = 认 ? { ...input, 跟进: 认 } : input;
    const 好 = 规整向导(me, 要下一步 || 企业版() || !带方式.跟进 ? 带方式 : { ...带方式, 跟进: { ...带方式.跟进, 下一步时间: null } }, new Date(), 要下一步, 企业版());
    if ("error" in 好) return { ok: false as const, error: 好.error };
    /** 市场成员选自动分配：业务线按客户区域定（下面企业版那段算） */
    let 区域定线 = false;
    /** 市场成员自动分配的分配方向（11-18）：建档时算一次，记业务线、建好再分 都用这一个（审核 11-18 P2-4） */
    let 建档方向: 分配方向 | undefined;
    // 企业版新建线索要选渠道或渠道触点（10-26：直接选渠道，不是来源类型；P-渠道-08 起触点也算）
    if (企业版()) {
      if (是占位值(String(input.客户.name ?? ""))) return { ok: false as const, error: 占位名提示("客户名称") };
      // 渠道和渠道触点至少一个（P-渠道-08）：公司资源 / 客户介绍来的主渠道留空、选触点
      const 触点 = 认渠道触点(input.客户.touchpoint);
      if (触点 === undefined) return { ok: false as const, error: `渠道触点只能是 ${渠道触点们.join(" / ")}` };
      const 来源还差 = 新建来源还差(input.客户.channelId, 触点);
      if (来源还差) return { ok: false as const, error: 来源还差 };
      // 历史渠道（P-渠道-06）只承载历史客户：新建线索不收，和停用的一样挡
      const 渠道不行 = input.客户.channelId ? await 新数据渠道不行(String(input.客户.channelId)) : null;
      if (渠道不行) return { ok: false as const, error: 渠道不行 === "停用" ? "这个渠道不存在或已停用，换一个" : 渠道不行 };
      // 项目来源（迁移 077）：没另选 = 跟客户来源；另选了也得是还启用着、不是历史渠道的。只选了触点、项目也没选渠道的 = 空着
      const 客户渠道 = input.客户.channelId ? String(input.客户.channelId) : null;
      const 来源 = 项目来源默认(input.项目?.channelId, 客户渠道);
      if (来源 && 来源 !== 客户渠道) {
        const 项目渠道不行 = await 新数据渠道不行(来源!);
        if (项目渠道不行) return { ok: false as const, error: 项目渠道不行 === "停用" ? "项目来源这个渠道不存在或已停用，换一个" : 项目渠道不行 };
      }
      if (好.企业) {
        好.企业.项目来源 = 来源;
        // 分配方式记在项目上（11-01 迁移 106）
        if (分配) 好.企业.分配方式名 = 分配.名;
        // 市场成员（按岗位）选自动分配（P-转-26 自动分配这一半，用户 11-17）：业务线不用选、交了也不认，按客户区域定——
        // 大陆 内贸、非大陆（含港澳台）外贸；客户地址空看项目所在地；都空 = 项目不记线（null，分完按负责人的线），自动分配两条线都算
        const 组织 = await 读组织();
        区域定线 = 分配?.i === 1 && 按区域分配of(组织, me.id);
        if (区域定线) {
          // 分配方向（11-18）：人在界面上改过就按改的（只认内贸 / 外贸）；没改按 客户区域 → 项目所在地 → 电话 → 本人事业部；都判不出 = 不记线、两条线都算
          const 向 = 认分配方向(input.项目?.分配方向);
          if (!向.ok) return { ok: false as const, error: 向.error };
          建档方向 = 向.线 ? { 线: 向.线, 来源: "手动" } : 默认分配方向({
            客户: input.客户.企业资料 ?? null, 项目: 好.企业.所在地 ?? null, 号们: 向导号们(input), 本人线: await 本人线of(组织, me.id),
          });
          好.企业.业务线 = 建档方向.线;
          // 手动改的存在项目上（Project.assignDir），之后定时到点、超时自动转、列表 / 批量自动分配都认它（审核 11-18 P0-1）
          if (向.线) 好.企业.手选方向 = 向.线;
        } else {
          // 业务线（11-01 清单 A1，16:1x 拍板三选一）：手动选；没选 = 跟客户上选的。企业版新建必填，不填不让建
          if (!好.企业.业务线) {
            const 客线 = 认业务线(input.客户.企业资料?.bizLine);
            if (客线) 好.企业.业务线 = 客线;
          }
          if (!好.企业.业务线) return { ok: false as const, error: 业务线必填 };
        }
      }
    }
    const 负责人 = await prisma.user.findUnique({ where: { id: 好.项目.ownerId }, select: { name: true, active: true } });
    if (!负责人?.active) return { ok: false as const, error: "项目负责人不存在或已停用，请选一位在职成员" };
    const 不行 = await 不能当负责人(好.项目.ownerId);
    if (不行) return { ok: false as const, error: 不行 };
    // 负责人选了别人 = 指派，开了持有上限的要算；自己建给自己不拦（lib/project/db.ts 超上限）
    let 转客户 = false;
    if (好.项目.ownerId !== me.id) {
      // 企业版指定分配给别人：和分配线索同一条（11-03 A2-1）——只能给销售 / 销售管理；业务线这里不比；
      // 参与状态要「正常」（11-18 第 8 题 B，和新线索列表「分配」一致：暂停、禁止的不能被指定）
      if (企业版()) {
        const org = await 读组织();
        const 问题 = await 指定问题(org, 好.项目.ownerId);
        if (问题) return { ok: false as const, error: 问题 };
        // 市场指定给销售 = 市场首次分配，算转客户（X-18，和自动分配同一条）；其余角色指定给别人，客户留在建的人名下（P-转-03）
        转客户 = 算市场转客户(org, { salesOwnerId: me.id, pool: null }, 好.项目.ownerId);
      }
      // 持有上限不在这里核：企业版建档的事务里核（接着 里 写前核上限，11-11），两次同时建不会都过；不是企业版不拦
    }

    /*
      企业版：联系人那一步的电话 / 邮箱 / 微信也按类型验格式、全公司查重（QA #3「邮箱不去重」），
      和第一步选了号码类型的那个号同一套；事务里再比一次（查完再写），建好后记进联系方式子表、挂在这位联系人上。
      开关关着不走：联系人的号和原来一样不查
    */
    const 企 = 企业版();
    const 第一步 = 企 && input.客户.企业号码 ? 验号码(input.客户.企业号码.类型, input.客户.企业号码.值) : null;
    const 联号 = 企 ? 验联系人号码(好.联系人, 第一步?.ok ? 第一步 : null) : [];
    if ("error" in 联号) return { ok: false as const, error: 联号.error };
    // 联系方式几行（AI 新线索卡交的、向导第一行下面多加的 联系人.号码们）：四类并进 联号 一起查重，别的类型事务里记
    const 号码行 = 企 ? await 并号码行(input.联系人?.号码们, 联号, 第一步?.ok ? 第一步 : null) : null;
    if (号码行 && "error" in 号码行) return { ok: false as const, error: 号码行.error };
    const 别的号行 = 号码行?.别的 ?? [];
    const 别撞 = await 别的号撞了(别的号行, me.id);
    if (别撞) return { ok: false as const, error: 别撞 };
    // 撞到有人在跟的客户：这次录的写进现有项目（同号再次录入），不建；公海、占位、停用的照原来的提示拦
    const 同号录入 = { 入口: "手工建档", 渠道id: input.客户.channelId, 内容: 好.跟进.content };
    if (第一步?.ok) {
      const 结论 = await 企业号码查重(prisma, 第一步, me.id, await 读的我(defaultClient));
      const 协同 = 结论.状态 !== "首次录入" ? await 同号再次录入(me, 第一步, 同号录入) : null;
      if (协同?.走) return { ok: false as const, error: 协同.反馈, 同号协同: true as const };
    }
    const 要查 = 联号.filter((号) => !号.同第一步);
    for (const 号 of 要查) {
      const 结论 = await 企业号码查重(prisma, 号, me.id, await 读的我(defaultClient));
      if (结论.状态 !== "首次录入") {
        const 协同 = await 同号再次录入(me, 号, 同号录入);
        if (协同.走) return { ok: false as const, error: 协同.反馈, 同号协同: true as const };
        return { ok: false as const, error: `${号.格}：${结论.提示}` };
      }
    }

    const 建了: Partial<建好的> = {};
    const 向导 = 向导接着建(me, 好, 建了);
    // 企业版客户状态跟着项目算（cust-status-auto-db.ts）：开关事务外读，建好项目后在同一笔事务里算
    const 状态开 = 企 && (await 客户状态自动());
    // 这笔事务只写刚建的这个客户和它名下的东西，放开范围（11-05 bug）：
    // 指定给别人时，客户一建好在我这儿就可能是只读的（市场成员建的、负责人不是我），
    // 后面写「最后跟进时间」、联系号码、客户状态会被范围拦下，整笔回滚
    const 接着 = !企 ? 登记接着建((tx, customerId) => 看全部(() => 向导(tx, customerId))) : 登记接着建((tx, customerId) => 看全部(async () => {
      // 持有上限（M-公海-18）：指派给别人，新建的线索项目算 1 个，和建在同一个事务里核（11-11），超了整笔回滚、客户项目都没建
      if (好.项目.ownerId !== me.id) await 写前核上限(tx, await 持有上限起点(tx, 规则, 好.项目.ownerId), 1, "分配", 建档超上限尾);
      for (const 号 of 要查) {
        const ids = await 全公司查号(tx, 号.类型, 号.值, 号.键, customerId);
        if (ids.length) throw new 联系人号码撞了(ids, 号.格);
      }
      await 向导(tx, customerId);
      // 客户先落在我名下（下面 saveCustomer 那一格）；市场指定给销售才转过去
      if (转客户) await 转客户给销售(tx, customerId, me.id, 好.项目.ownerId, me.id, 分配?.名 ?? "指定分配");
      // 市场指定给销售：刚建的项目停在潜客培育的进线索验证（审核 11-18，market-assign-node.ts）
      if (转客户) await 市场分配进线索验证(tx, [建了.projectId], 好.项目.ownerId, me.id);
      for (const 号 of 联号) await 记号码(tx, { 刚建的: customerId }, 建了.contactId ?? null, 号);
      await 记别的号行(tx, customerId, 建了.contactId ?? null, 别的号行);
      await 跟着项目重算(tx, 状态开, [customerId]);
    }));
    // 联系人带着号：客户本身可以没有电话（M-必填-01 任一联系方式；只有座机这类占不了企业号码的号也能建）
    if (号码行?.有) 记联系人带号(接着);
    let r: Awaited<ReturnType<typeof saveCustomer>>;
    try {
      // 新客户的业务线跟项目走（客户那一步没另选时；交了个空的也算没选，M-必填-13）。
      // 按客户区域定、区域又没填的（项目不记线）：客户记「暂不分配」（客户业务线必填，同导入没选线时）
      const 跟的线 = 好.企业?.业务线 ?? (区域定线 ? "暂不分配" : null);
      const 客户线 = 企 && 跟的线 && 认业务线(input.客户.企业资料?.bizLine) === null
        ? { 企业资料: { ...(input.客户.企业资料 ?? {}), bizLine: 跟的线 } }
        : {};
      // 企业版指定给别人：项目归接手人，客户不跟着改（P-转-03，三处同一条）。总管理不走 新建只给自己，这里统一落到建的人
      const 客户负责人 = 企 && 好.项目.ownerId !== me.id ? { salesOwnerId: me.id } : {};
      // 项目分配（新建客户给市场成员的那一格，11-18）只给只建客户用：带项目的分配方式在 项目.分配方式，这里不认客户上交的
      r = await saveCustomer({ ...input.客户, ...客户线, ...客户负责人, 项目分配: undefined, id: undefined, updatedAt: null, base: null }, 接着);
    } catch (e) {
      if (e instanceof 整批超上限) return { ok: false as const, error: e.话 };
      if (!(e instanceof 联系人号码撞了)) throw e;
      return { ok: false as const, error: `${e.格}：${(await 撞号结论(prisma, e.ids, me.id, await 读的我(defaultClient))).提示}` };
    }
    if (!r.ok) return r;
    await recordAudit({
      user: me, action: "create", entity: "Project", entityId: 建了.projectId,
      summary: `建档：新建项目「${好.项目.name}」（负责人 ${负责人.name}${分配 ? `，分配方式「${分配.名}」` : ""}），连同主要联系人「${好.联系人.name || "—"}」和首条跟进`,
      detail: { 项目: 好.项目.name, 负责人: 负责人.name, 金额: 好.项目.amount, 币种: 好.项目.currency, 联系人: 好.联系人.name, ...(分配 ? { 分配方式: 分配.名 } : {}) },
    });
    // 首条跟进记在潜客培育上：配的必填建档时就齐了的，接着往前推。
    // 客户是刚建的、名下只有这一个项目；指定给了别人时在我这儿已只读，放开范围，不然推进被拦、静默跳过
    await 看全部(() => 客户存了推项目(me, r.id));
    // 客户三态：向导带了首条跟进，马上重算这位的钟（关着不查库，出错不影响建档）
    await 存沟通后重算三态(r.id);
    刷新项目(建了.projectId, r.id);
    // 指定给了别人：项目不在我名下，跳详情页会是「不存在或无权查看」（11-03 A2-1），和自动分配一样回线索列表
    const 再分 = 分配 ? await 建好再分(me, 分配, 建了.projectId!, 好.项目.name, 好.企业?.业务线 ?? null, 定时, 区域定线 ? 建档方向 : undefined) : null;
    // 指定给了别人：告诉接手人。客户转过去了链客户详情（看得到联系方式）；客户没转就是项目分给他，链项目详情。自动分配、进公海走 建好再分 里自己的通知，这里不重复
    if (!再分 && 好.项目.ownerId !== me.id) {
      if (转客户 || !企) await 分给你通知(me, 好.项目.ownerId, [r.id], 好.项目.name);
      else await 项目分给你通知(me, 好.项目.ownerId, 建了.projectId!, 好.项目.name, r.id);
      // 市场成员当场指定给销售 = 指定分配，记进分配数（11-18，direct-assign.ts）。自动分配、定时、进公海走 建好再分（分配线索写记录），这里不重复
      if (企) await 记新建指定分配(me, 建了.projectId);
    }
    const 分了 = 分配 ? 再分 ?? (好.项目.ownerId !== me.id ? { 提示: `已指派给 ${负责人.name}`, 转走: true } : null) : null;
    // contactId：名片原图存到这位联系人的附件上（企业版才有联系人附件；开关关着返回和原来逐字段一样）
    // 首条沟通的截图 / 附件（11-18）：建好这一刻签票给录入人，浏览器凭票接着传（建好就分走了也传得上）
    const 附件票 = 企业版() && 输入.要传附件 === true && 建了.followUpId ? { followUpId: 建了.followUpId, 票: await 签首条附件票(me.id, 建了.followUpId) } : null;
    return { ok: true as const, customerId: r.id, projectId: 建了.projectId!, ...(企业版() ? { contactId: 建了.contactId ?? null } : {}), ...(分了 ?? {}), ...(附件票 ? { 附件票 } : {}) };
  } catch (e) { return 不在了(e); }
}


/**
 * 新建弹窗没开「项目」开关（P-界面-36，11-15）：客户、主要联系人、首条沟通一笔建好，哪一样写失败整笔不留。
 * 权限和建档同一套：项目模式开关、新建挡由 建档向导 先拦；客户负责人（企业版普通销售只能建给自己）、客户查重、
 * 客户业务线必填都由 saveCustomer 管；号码按类型验格式、全公司查重同建档。不走分配方式、不建项目
 */
export async function 建档只建客户(输入: 只建客户输入) {
  try {
    const me = await requireUser();
    const 挡 = await 建档前挡(me, 输入);
    if (挡) return 挡;
    return await 只建客户写(me, 输入);
  } catch (e) { return 不在了(e); }
}

/** 建档、只建客户共用的门：项目模式开关（关着一行不写）、交上来的形状、没设业务角色 / 只读管理员不能新建（11-03 D3-7 ④） */
async function 建档前挡(me: Awaited<ReturnType<typeof requireUser>>, 输入: unknown) {
  if (!(await 开着())) return 没开;
  const 客户 = 输入 && typeof 输入 === "object" ? (输入 as { 客户?: unknown }).客户 : null;
  if (!客户 || typeof 客户 !== "object") return { ok: false as const, error: "建档信息不完整，请从头再走一遍" };
  // 页面上「新建」「新线索」不摆，这里再拦
  const 新建挡 = 企业版() ? 不能新建项目话(me, await 权限组织()) : null;
  return 新建挡 ? { ok: false as const, error: 新建挡 } : null;
}

/*
  联系方式几行（联系人.号码们，企业版 11-17）：首页 AI 新线索卡交的、建档向导第一行号码下面多加的，都按联系人表单同一套验
  （号码类型字典 V-号码类型 八种、格式、占位号，最多 每人最多号码 个）。手机 / 邮箱 / 微信 / 阿里国际站ID 并进 联号，和第一行、
  联系人那几格一样全公司查重、记子表（同类同号只记一次）；座机、WhatsApp 这些别的类型只验格式，返回给调用方事务里记到主要联系人名下。
  有 = 交了至少一个号（联系人带号，客户本身可以没有电话）
*/
async function 并号码行(行们: 向导联系人["号码们"], 联号: 联系人的号[], 第一步: 验好的号 | null): Promise<{ 别的: 验好的行[]; 有: boolean } | { error: string }> {
  if (!行们?.length) return { 别的: [], 有: false };
  const 验 = await 验联系人号码们(行们);
  if (!验.ok) return { error: 验.error };
  for (const 行 of 验.行们) {
    const 类型 = 库类型到号码类型[行.kind];
    if (!类型 || 联号.some((h) => h.类型 === 类型 && h.键 === 行.numberKey)) continue;
    const 同第一步 = !!第一步 && 第一步.类型 === 类型 && 第一步.键 === 行.numberKey;
    联号.push({ 类型, 值: 行.value, 键: 行.numberKey, 格: `联系人${号码类型叫法(类型)}`, 同第一步 });
  }
  const 别的 = 验.行们.filter((行) => !库类型到号码类型[行.kind]);
  // 连联系人那几格（向导第一行带进联系人电话）一共最多 每人最多号码 个，同联系人表单
  if (联号.length + 别的.length > 每人最多号码) return { error: `一位联系人最多记 ${每人最多号码} 个号码` };
  return { 别的, 有: 验.行们.length > 0 };
}
/**
 * 别的类型的号（座机、WhatsApp、传真、Telegram、自定的）也全公司查重（11-17）：座机、WhatsApp 和手机共用号键，
 * 撞了客户电话、联系人、子表里的同号都算；在用的撞了说首条那位（同第一行号码的提示）。没撞回 null
 */
async function 别的号撞了(行们: readonly 验好的行[], 我: string): Promise<string | null> {
  if (!行们.length) return null;
  const 表 = await 号码种类表();
  for (const 行 of 行们) {
    const ids = await 一行号全公司查(prisma, 行);
    const 论 = ids.length ? await 撞号结论(prisma, ids, 我, await 读的我(defaultClient)) : null;
    if (论 && 论.状态 !== "首次录入") return `联系人${种类叫法(表, 行.kind)}：${论.提示}`;
  }
  return null;
}
async function 记别的号行(tx: Prisma.TransactionClient, customerId: string, contactId: string | null, 行们: readonly 验好的行[]) {
  for (const 行 of 行们) {
    await tx.contactMethod.create({ data: { customerId, contactId, kind: 行.kind, value: 行.value, numberKey: 行.numberKey, formatStatus: "ok", region: 行.region } });
  }
}

async function 只建客户写(me: Awaited<ReturnType<typeof requireUser>>, 输入: 只建客户输入) {
  const 企 = 企业版();
  let 客户 = 输入.客户;
  if (企) {
    const 客源 = await 落到渠道(客户.channelId ? String(客户.channelId) : null, me);
    if (!客源.ok) return { ok: false as const, error: 客源.error };
    if (是主渠道入口(客户.channelId)) 客户 = { ...客户, channelId: 客源.id };
    if (是占位值(String(客户.name ?? ""))) return { ok: false as const, error: 占位名提示("客户名称") };
    const 触点 = 认渠道触点(客户.touchpoint);
    if (触点 === undefined) return { ok: false as const, error: `渠道触点只能是 ${渠道触点们.join(" / ")}` };
    const 来源还差 = 新建来源还差(客户.channelId, 触点);
    if (来源还差) return { ok: false as const, error: 来源还差 };
    const 渠道不行 = 客户.channelId ? await 新数据渠道不行(String(客户.channelId)) : null;
    if (渠道不行) return { ok: false as const, error: 渠道不行 === "停用" ? "这个渠道不存在或已停用，换一个" : 渠道不行 };
  }
  const 认 = 输入.跟进 ? await 认跟进方式(输入.跟进) : 输入.跟进;
  if (认 && "error" in 认) return { ok: false as const, error: 认.error };
  const 好 = 规整只建客户({ 联系人: 输入.联系人, 跟进: 认 ?? undefined }, new Date(), 企);
  if ("error" in 好) return { ok: false as const, error: 好.error };

  // 号码：第一步那个号、联系人的号按类型验格式、全公司查重（同建档）；撞到有人在跟的走同号再次录入，不建
  const 第一步 = 企 && 客户.企业号码 ? 验号码(客户.企业号码.类型, 客户.企业号码.值) : null;
  const 联号 = 企 ? 验联系人号码(好.联系人, 第一步?.ok ? 第一步 : null) : [];
  if ("error" in 联号) return { ok: false as const, error: 联号.error };
  const 号码行 = 企 ? await 并号码行(输入.联系人?.号码们, 联号, 第一步?.ok ? 第一步 : null) : null;
  if (号码行 && "error" in 号码行) return { ok: false as const, error: 号码行.error };
  const 别的号行 = 号码行?.别的 ?? [];
  const 别撞 = await 别的号撞了(别的号行, me.id);
  if (别撞) return { ok: false as const, error: 别撞 };
  const 同号录入 = { 入口: "手工建档", 渠道id: 客户.channelId, 内容: 好.跟进.content };
  if (第一步?.ok) {
    const 结论 = await 企业号码查重(prisma, 第一步, me.id, await 读的我(defaultClient));
    const 协同 = 结论.状态 !== "首次录入" ? await 同号再次录入(me, 第一步, 同号录入) : null;
    if (协同?.走) return { ok: false as const, error: 协同.反馈, 同号协同: true as const };
  }
  const 要查 = 联号.filter((号) => !号.同第一步);
  for (const 号 of 要查) {
    const 结论 = await 企业号码查重(prisma, 号, me.id, await 读的我(defaultClient));
    if (结论.状态 !== "首次录入") {
      const 协同 = await 同号再次录入(me, 号, 同号录入);
      if (协同.走) return { ok: false as const, error: 协同.反馈, 同号协同: true as const };
      return { ok: false as const, error: `${号.格}：${结论.提示}` };
    }
  }

  const 建了: Partial<建好的客户> = {};
  const 建 = 只建客户接着建(me, 好, 建了, 补潜客培育);
  // 只写刚建的这个客户和它名下的东西，放开范围（同建档：负责人不是我时客户一建好在我这儿可能是只读的）
  const 接着 = 登记接着建((tx, customerId) => 看全部(async () => {
    for (const 号 of 要查) {
      const ids = await 全公司查号(tx, 号.类型, 号.值, 号.键, customerId);
      if (ids.length) throw new 联系人号码撞了(ids, 号.格);
    }
    await 建(tx, customerId);
    for (const 号 of 联号) await 记号码(tx, { 刚建的: customerId }, 建了.contactId ?? null, 号);
    await 记别的号行(tx, customerId, 建了.contactId ?? null, 别的号行);
  }));
  if (号码行?.有) 记联系人带号(接着);
  let r: Awaited<ReturnType<typeof saveCustomer>>;
  try {
    r = await saveCustomer({ ...客户, id: undefined, updatedAt: null, base: null }, 接着);
  } catch (e) {
    if (!(e instanceof 联系人号码撞了)) throw e;
    return { ok: false as const, error: `${e.格}：${(await 撞号结论(prisma, e.ids, me.id, await 读的我(defaultClient))).提示}` };
  }
  if (!r.ok) return r;
  await recordAudit({
    user: me, action: "create", entity: "Customer", entityId: r.id,
    summary: `新建客户${String(客户.name ?? "").trim() ? `「${String(客户.name ?? "").trim()}」` : "（没填名称）"}，连同主要联系人「${好.联系人.name || "—"}」和首条沟通（${建了.projectId ? "挂在潜客培育项目上" : "没建项目"}）`,
    detail: { 联系人: 好.联系人.name, 下一步时间: 好.跟进.nextStepAt ? 好.跟进.nextStepAt.toISOString().slice(0, 10) : null },
  });
  await 存沟通后重算三态(r.id);
  // 市场成员新建客户时直接选了销售当负责人 = 指定分配（11-18，direct-assign.ts）：记在刚建的潜客培育项目上；负责人是自己的不记
  if (企) await 记新建指定分配(me, 建了.projectId);
  刷新项目(建了.projectId ?? undefined, r.id);
  revalidatePath("/customers");
  // 首条沟通的截图 / 附件：挂在潜客培育项目上的这条首条沟通，同建档签票给录入人（凭票认首条沟通 要它挂着项目）
  const 附件票 = 企 && 输入.要传附件 === true && 建了.followUpId && 建了.projectId ? { followUpId: 建了.followUpId, 票: await 签首条附件票(me.id, 建了.followUpId) } : null;
  // 市场成员选了项目分配方式（11-18）：自动分配分给谁 / 已指派给谁 / 暂不分配那句；转走 = 客户已不在我名下，弹窗不跳客户页
  const 去向 = { ...(r.提示 ? { 提示: r.提示 } : {}), ...(r.转走 ? { 转走: true } : {}) };
  return { ok: true as const, customerId: r.id, projectId: null, ...(企 ? { contactId: 建了.contactId ?? null } : {}), ...去向, ...(附件票 ? { 附件票 } : {}) };
}

/** 改节点。进异常状态时带上异常类别（必选）和备注（可空）；企业版点线索流失、丢单时 备注 = 原因（必填） */
/**
 * 判无效（dt.invalid，P-界面-42）：前端交「无效原因」（字典 invalid 里点选的一项，或「其他：xxx」），服务端照公海标无效同一个 选的原因("invalid") 核
 * （停用了、不在字典里、「其他」没写的都拒），合成「无效原因：X」+ 补充说明记进节点变更的备注。没给 = 照旧只用 备注
 */
async function 合无效原因(附: { 备注?: string | null; 无效原因?: string | null } | null | undefined): Promise<{ ok: true; 备注: string | null } | { ok: false; error: string }> {
  const 备注 = typeof 附?.备注 === "string" ? 附.备注 : null;
  if (!附 || 附.无效原因 == null || 附.无效原因 === "") return { ok: true, 备注 };
  const 选 = await 选的原因("invalid", 附.无效原因);
  if (!选.ok) return 选;
  if (!选.值) return { ok: true, 备注 };
  return { ok: true, 备注: [`无效原因：${选.值}`, (备注 ?? "").trim()].filter(Boolean).join("\n") };
}

export async function 改项目节点(projectId: string, 到: 位置, 异常?: { categoryId?: string | null; 备注?: string | null; 无效原因?: string | null } | null) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    if (!到 || typeof 到 !== "object") return { ok: false as const, error: "要改到哪个进程？" };
    const 因 = await 合无效原因(异常);
    if (!因.ok) return { ok: false as const, error: 因.error };
    const 异 = 异常 && typeof 异常 === "object" ? { categoryId: 异常.categoryId ?? null, 备注: 因.备注 } : undefined;
    const r = await 改节点(me, projectId, 到, 异);
    if (r.ok && r.变了) {
      const p = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true, customerId: true, exceptionCategory: { select: { name: true } } } });
      const 类别 = 到.result === "异常状态" ? p?.exceptionCategory?.name ?? null : null;
      await recordAudit({
        user: me, action: "update", entity: "Project", entityId: projectId,
        summary: `项目「${p?.name ?? ""}」改到 ${到.phase}·${到.node}${到.result ? `（${到.result}${类别 ? `：${类别}` : ""}）` : ""}`,
        detail: { 阶段: 到.phase, 节点: 到.node, 结局: 到.result ?? null, 异常类别: 类别, 备注: 类别 || (企业版() && 要写原因(到.result)) ? 异?.备注?.trim() || null : null },
      });
      await 记这个项目的自动推进(me, projectId, r.自动推到);
      刷新项目(projectId, p?.customerId);
    }
    return r;
  } catch (e) { return 不在了(e); }
}

/**
 * 看板拖到别的进程之前先问一句（P-界面-45，原型 pr.drag / cu.board）：这一步往前推、当前进程配了必填、还没填齐的，
 * 回还差哪几项（显示名）和能不能留空先推（总管理、销售管理 = 是经理，和 改节点 里放行的是同一拨人）。
 * 只是预演：真推照旧走 改项目节点，权限、推进关、必填都在那里再判一遍；改不了进程的人这里就回那句原因，卡片弹回
 */
/**
 * 看板拖动缺必填时就地补填（原型 pr.drag / cu.board「小框里直接填」）：给小框读和项目页同一份项目料（同一个 读项目详情，看得见才回）。
 * 能不能就地改的口径照项目页：能改 && 不在公海 && 企业版
 */
export async function 看板补必填料(projectId: string): Promise<
  | { ok: true; p: 项目详情Props["p"]; 联系人们: 项目详情Props["联系人们"]; 能就地改: boolean; 改不了话: string }
  | { ok: false; error: string }
> {
  // 认人放在 try 外：没登录照常抛（按未登录处理），不被下面「没读到这个项目」那句盖住
  const me = await requireUser();
  try {
    if (!(await 开着())) return 没开;
    const r = await 读项目详情(me, String(projectId ?? ""));
    if (r.种 !== "有") return { ok: false, error: "这个项目现在看不到，进项目里补" };
    const { p, 能改, 联系人们 } = r.props;
    return {
      ok: true, p, 联系人们,
      能就地改: 能改 && !p.pooled && !!p.企业版,
      改不了话: p.企业版 ? "只有项目负责人能改，其他人只能看" : "只有项目负责人、老板或主管能改",
    };
  } catch {
    return { ok: false, error: "没读到这个项目，进项目里补" };
  }
}

export async function 看板推进预检(projectId: string, 到: 位置): Promise<{ ok: true; 还差: string[]; 能留空推: boolean } | { ok: false; error: string }> {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    if (!到 || typeof 到 !== "object" || typeof 到.phase !== "string" || typeof 到.node !== "string") return { ok: false, error: "要改到哪个进程？" };
    const p = await prisma.project.findUnique({ where: { id: String(projectId ?? "") } });
    if (!p) return { ok: false, error: "这个项目已经不在了，刷新看看" };
    const [规则, org] = await Promise.all([生效组织规则(), 权限组织()]);
    if (!能改节点(me, p, org) && !上级只推(me, p, await 直属才推(org), 规则)) {
      return { ok: false, error: p.pooledAt ? "这个项目在公海里，先领取再改" : 企业版() ? 只有负责人改进程 : "只有项目负责人、老板或主管能改进程" };
    }
    const 字典 = 字典of(企业版(), 企业版() ? 规则.阶段.出口叫法 : null);
    const 往前 = !p.result && 节点序号(本套位置({ ...到, result: null }, 字典), 字典) > 节点序号(本套位置(p, 字典), 字典);
    // 生效时刻之前建的存量项目不按必填拦（和 改节点 同一个判断，11-19 第 25 题）
    if (!往前 || !项目按必填走(规则, p)) return { ok: true, 还差: [], 能留空推: false };
    const 差 = 必填还差(规则, await 读必填数据(prisma, p, 规则));
    return { ok: true, 还差: 差.map(必填叫法), 能留空推: 是经理(me, org) };
  } catch (e) { return 不在了(e); }
}

/** 企业版「终止进程」（M-节点-04）：按所在阶段落到线索流失 / 丢单 / 异常状态；线索流失、丢单 备注 = 原因（必填），异常状态带类别。审计和 改项目节点 一样记 */
export async function 终止项目进程(projectId: string, 附?: { categoryId?: string | null; 备注?: string | null; 无效原因?: string | null } | null) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    const 因 = await 合无效原因(附);
    if (!因.ok) return { ok: false as const, error: 因.error };
    const 带 = 附 && typeof 附 === "object" ? { categoryId: 附.categoryId ?? null, 备注: 因.备注 } : undefined;
    const r = await 终止进程(me, projectId, 带);
    if (r.ok && r.变了 && r.到) {
      const 到 = r.到;
      const p = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true, customerId: true, exceptionCategory: { select: { name: true } } } });
      const 类别 = 到.result === "异常状态" ? p?.exceptionCategory?.name ?? null : null;
      await recordAudit({
        user: me, action: "update", entity: "Project", entityId: projectId,
        summary: `终止进程：项目「${p?.name ?? ""}」在 ${到.phase}·${到.node} 终止（${到.result}${类别 ? `：${类别}` : ""}）`,
        detail: { 阶段: 到.phase, 节点: 到.node, 结局: 到.result ?? null, 异常类别: 类别, 备注: 带?.备注?.trim() || null, 终止进程: true },
      });
      刷新项目(projectId, p?.customerId);
    }
    return r;
  } catch (e) { return 不在了(e); }
}

/** 负责人把项目放回项目公海（线索 / 商机阶段） */
export async function 放回项目公海(projectId: string, 原因?: string | null) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    const r = await 放回公海(me, projectId, 原因);
    if (r.ok) {
      // 放回之后他自己看不到这个项目了（原负责人回避，11-03），留痕要的名字绕开限定读
      const p = await 看全部(() => prisma.project.findUnique({ where: { id: projectId }, select: { name: true, customerId: true, pooledAt: true, customer: { select: { pool: { select: { at: true } } } } } }));
      const 选了 = 企业版() && typeof 原因 === "string" && 原因.trim() ? 原因.trim() : null;
      await recordAudit({ user: me, action: "update", entity: "Project", entityId: projectId, summary: `把项目「${p?.name ?? ""}」放回线索公海${选了 ? `（${选了}）` : ""}`, ...(选了 ? { detail: { 回收原因: 选了 } } : {}) });
      刷新项目(projectId, p?.customerId);
      // P-公海-03：别人放的，告诉原负责人一声（自己放自己的不发）
      await 项目放回公海通知(me, projectId, 选了);
      // 客户同一笔跟着进了客户公海（pool-link.ts 单项目客户跟进公海，两边同一个时刻）：告诉页面，提示条说清（11-03 B4-2）
      const 进的 = p?.customer.pool?.at;
      if (进的 && p?.pooledAt && 进的.getTime() === p.pooledAt.getTime()) return { ...r, 客户跟着: true as const };
    }
    return r;
  } catch (e) { return 不在了(e); }
}

/** 从项目公海领取：领了就是负责人。带待办（C-06）：进公海时关掉的那批待办重新打开给我，没传按默认勾 */
export async function 领取项目(projectId: string, 带待办?: boolean) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    const r = await 领取公海项目(me, projectId, 带待办勾(带待办));
    if (r.ok) {
      const p = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true, customerId: true } });
      await recordAudit({ user: me, action: "update", entity: "Project", entityId: projectId, summary: `从线索公海领取项目「${p?.name ?? ""}」` });
      刷新项目(projectId, p?.customerId);
    }
    return r;
  } catch (e) { return 不在了(e); }
}

export async function 勾项目交付(projectId: string, 项: 交付项, 勾: boolean) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    const r = await 勾交付(me, projectId, 项, 勾 === true);
    if (r.ok && r.变了) {
      const p = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true, customerId: true } });
      await recordAudit({
        user: me, action: "update", entity: "Project", entityId: projectId,
        summary: `项目「${p?.name ?? ""}」${勾 ? "勾上" : "取消"}「${交付项们[项]}」`,
      });
      await 记这个项目的自动推进(me, projectId, r.自动推到);
      刷新项目(projectId, p?.customerId);
    }
    return r;
  } catch (e) { return 不在了(e); }
}

export async function 删除项目(projectId: string) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    const r = await 删项目(me, projectId);
    if (r.ok) {
      await recordAudit({ user: me, action: "delete", entity: "Project", entityId: projectId, summary: `删除项目「${r.name}」` });
      if (r.ownerId && r.ownerId !== me.id) await 项目被删通知(me, r.ownerId, r.name ?? "", r.customerId ?? "");
      刷新项目(undefined, r.customerId);
    }
    return r.ok ? { ok: true as const } : r;
  } catch (e) { return 不在了(e); }
}

export async function 加组员角色(name: string) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    const r = await 加角色(me, name);
    if (r.ok) {
      await recordAudit({ user: me, action: "create", entity: "ProjectRole", entityId: r.id, summary: `加了项目组员角色「${String(name).trim()}」` });
      revalidatePath("/settings");
    }
    return r;
  } catch (e) { return 不在了(e); }
}

export async function 改组员角色(id: string, patch: { name?: string; active?: boolean }) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    const 原 = await prisma.projectRole.findUnique({ where: { id: String(id ?? "") }, select: { name: true } });
    const r = await 改角色(me, id, patch ?? {});
    if (r.ok) {
      const 做了 = patch.active === false ? "停用" : patch.active === true ? "启用" : "改名";
      await recordAudit({
        user: me, action: "update", entity: "ProjectRole", entityId: id,
        summary: `${做了}项目组员角色「${原?.name ?? ""}」${patch.name ? ` → 「${String(patch.name).trim()}」` : ""}`,
      });
      revalidatePath("/settings");
    }
    return r;
  } catch (e) { return 不在了(e); }
}

export async function 加项目异常类别(name: string) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    const r = await 加异常类别(me, name);
    if (r.ok) {
      await recordAudit({ user: me, action: "create", entity: "ProjectExceptionCategory", entityId: r.id, summary: `加了项目异常类别「${String(name).trim()}」` });
      revalidatePath("/settings");
    }
    return r;
  } catch (e) { return 不在了(e); }
}

export async function 改项目异常类别(id: string, patch: { name?: string; active?: boolean }) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    const 原 = await prisma.projectExceptionCategory.findUnique({ where: { id: String(id ?? "") }, select: { name: true } });
    const r = await 改异常类别(me, id, patch ?? {});
    if (r.ok) {
      const 做了 = patch.active === false ? "停用" : patch.active === true ? "启用" : "改名";
      await recordAudit({
        user: me, action: "update", entity: "ProjectExceptionCategory", entityId: id,
        summary: `${做了}项目异常类别「${原?.name ?? ""}」${patch.name ? ` → 「${String(patch.name).trim()}」` : ""}`,
      });
      revalidatePath("/settings");
    }
    return r;
  } catch (e) { return 不在了(e); }
}

// 地址四格留痕都叫「所在地」、金额和币种都叫「合同金额」/「定金金额」，拼摘要时去重
const 项目字段名: Record<string, string> = {
  name: "名称", ownerId: "负责人", amount: "金额", currency: "币种", remark: "备注", contactId: "主联系人", expectedDealAt: "预计成交日期", channelId: "项目来源",
  level: "项目级别", projTag: "项目标签", addrCountry: "所在地", addrProvince: "所在地", addrCity: "所在地", addrDistrict: "所在地", location: "详细地址",
  dealDemand: "需求描述", contractAmount: "合同金额", contractCurrency: "合同金额", depositAmount: "定金金额", depositCurrency: "定金金额",
  painPoints: "痛点标注", contractStatus: "合同状态", bizLine: "业务线",
  replyStartAt: "指定回复时间", replyEndAt: "指定回复时间",
};

/** 编辑项目：名称、负责人、金额、币种、备注、主联系人；企业版还有预计成交日期、项目来源、项目级别、项目标签、所在地、需求描述、合同金额、定金金额、痛点标注、合同状态、业务线（改了不重新自动分配） */
export async function 编辑项目(projectId: string, patch: 编辑项目改动, 带待办?: boolean) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    // 换了负责人时原负责人的待办（C-06，转让弹窗的勾）：没传按默认勾
    // 换负责人之前在谁名下（不在公海、不是待分配才算）：市场管理改分要告诉原负责人和上级（11-19）
    const 改前 = patch && typeof patch === "object" && "ownerId" in patch
      ? await 看全部(() => prisma.project.findUnique({ where: { id: String(projectId ?? "") }, select: { ownerId: true, pooledAt: true, awaitAssignAt: true } }))
      : null;
    const r = await 改项目(me, projectId, patch, 带待办勾(带待办));
    if (r.ok && r.变了?.length) {
      const p = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true, customerId: true } });
      await recordAudit({
        user: me, action: "update", entity: "Project", entityId: projectId,
        summary: `编辑项目「${p?.name ?? ""}」：改了${[...new Set(r.变了.map((k) => 项目字段名[k] ?? k))].join("、")}`,
      });
      await 记这个项目的自动推进(me, projectId, r.自动推到);
      if (r.变了.includes("ownerId")) {
        await 转项目通知(me, projectId);
        if (改前 && !改前.pooledAt && !改前.awaitAssignAt && typeof patch.ownerId === "string") await 市场改分通知(me, [{ 原: 改前.ownerId, 新: patch.ownerId, projectId }]);
      }
      刷新项目(projectId, p?.customerId);
    }
    return r.ok ? { ok: true as const, ...(r.自动推到 ? { 自动推到: r.自动推到 } : {}) } : r;
  } catch (e) { return 不在了(e); }
}

/** 留痕里画像字段的叫法：跟字典的名字 */
const 画像字段名 = (k: 画像字段): string => 字典定义[项目画像项.find((x) => x.键 === k)!.种类].名;

/** 企业版项目画像（P11）：详情页「项目画像」卡改一项存一项；规矩见 lib/project/profile.ts */
export async function 改项目画像Action(projectId: string, patch: 画像改动) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    const r = await 改项目画像(me, projectId, patch);
    if (r.ok && r.变了.length) {
      const p = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true, customerId: true } });
      await recordAudit({
        user: me, action: "update", entity: "Project", entityId: projectId,
        summary: `编辑项目「${p?.name ?? ""}」：改了${r.变了.map(画像字段名).join("、")}`,
      });
      await 记这个项目的自动推进(me, projectId, r.自动推到);
      刷新项目(projectId, p?.customerId);
    }
    return r.ok ? { ok: true as const, ...(r.自动推到 ? { 自动推到: r.自动推到 } : {}) } : r;
  } catch (e) { return 不在了(e); }
}

/** 企业版 MQL 人工判定：线索验证上判合格（推到线索推进）/ 不合格（退回潜客培育 + 培育跟进计划） */
export async function 判MQLAction(projectId: string, 合格: boolean, 下一步时间?: string | null, 计划内容?: string | null) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    if (!企业版()) return { ok: false as const, error: "MQL 判定只在企业版有" };
    const r = await 判MQL(me, projectId, 合格 === true, 下一步时间 ?? null, new Date(), 计划内容 ?? null);
    if (r.ok) {
      const p = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true, customerId: true } });
      await recordAudit({
        user: me, action: "update", entity: "Project", entityId: projectId,
        summary: 合格 ? `项目「${p?.name ?? ""}」MQL 判合格，推到 ${MQL合格去}` : `项目「${p?.name ?? ""}」MQL 判不合格，退回 ${MQL不合格去}，${下一步时间 ?? ""} 再跟进：${String(计划内容 ?? "").trim()}`,
      });
      await 记这个项目的自动推进(me, projectId, r.自动推到);
      刷新项目(projectId, p?.customerId);
    }
    return r;
  } catch (e) { return 不在了(e); }
}

/** 线索验证（P12）五个入口共用：登录、项目模式、企业版，成了记审计（谁判了什么）、刷新列表和详情 */
async function 验证一步(projectId: string, 说法: (项目: string) => string, 做: (me: Awaited<ReturnType<typeof requireUser>>) => Promise<{ ok: true; 自动推到?: string[] } | { ok: false; error: string }>) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    if (!企业版()) return { ok: false as const, error: "线索验证只在企业版有" };
    const r = await 做(me);
    if (r.ok) {
      const p = await 看全部(() => prisma.project.findUnique({ where: { id: projectId }, select: { name: true, customerId: true } }));
      await recordAudit({ user: me, action: "update", entity: "EntLeadVerify", entityId: projectId, summary: 说法(p?.name ?? "") });
      await 验证待办通知(me, projectId);
      await 记这个项目的自动推进(me, projectId, r.自动推到);
      刷新项目(projectId, p?.customerId);
      revalidatePath("/leads");
    }
    return r;
  } catch (e) { return 不在了(e); }
}

const 短 = (v: unknown) => String(v ?? "").trim().slice(0, 100);

/** 1. 销售初判：有效 / 无效（要无效原因，交复核）/ 还需培育（同 MQL 不合格，要下一次培育日期和计划） */
export async function 线索初判Action(
  projectId: string, 判: 初判,
  附: { invalidReason?: string | null; verifyNote?: string | null; 下一步时间?: string | null; 计划内容?: string | null } = {},
) {
  return 验证一步(projectId, (名) => `项目「${名}」线索初判：${判}${判 === "无效" ? `，无效原因：${短(附.invalidReason)}` : ""}${附.verifyNote ? `；${短(附.verifyNote)}` : ""}`,
    (me) => 销售初判(me, projectId, 判, 附 ?? {}));
}

/** 2. 市场复核：判有效（回销售终验）/ 判无效（线索流失） */
export async function 市场复核Action(projectId: string, 有效: boolean, reviewNote?: string | null) {
  return 验证一步(projectId, (名) => `项目「${名}」市场复核：判${有效 ? "有效" : "无效"}${reviewNote ? `；${短(reviewNote)}` : ""}`,
    (me) => 市场复核(me, projectId, 有效 === true, reviewNote));
}

/** 3. 销售终验：接受复核（推到线索推进）/ 提交异议（要说明，交总管理终判） */
export async function 销售终验Action(projectId: string, 接受: boolean, disputeNote?: string | null) {
  return 验证一步(projectId, (名) => `项目「${名}」销售终验：${接受 ? "接受复核" : `提交异议；${短(disputeNote)}`}`,
    (me) => 销售终验(me, projectId, 接受 === true, disputeNote));
}

/** 4. 总管理终判：判有效（回销售认领）/ 判无效（线索流失） */
export async function 总管理终判Action(projectId: string, 有效: boolean, finalNote?: string | null) {
  return 验证一步(projectId, (名) => `项目「${名}」总管理终判：判${有效 ? "有效" : "无效"}${finalNote ? `；${短(finalNote)}` : ""}`,
    (me) => 总管理终判(me, projectId, 有效 === true, finalNote));
}

/** 总管理判有效后，销售认领继续推，或自己退回公海（算主动退回） */
export async function 销售认领Action(projectId: string, 继续: boolean) {
  return 验证一步(projectId, (名) => `项目「${名}」终判有效后${继续 ? "认领继续推进" : "放回公海"}`,
    (me) => 销售认领(me, projectId, 继续 === true));
}

/** 撤回验证（X-77）：提交验证的人、系统管理员；线索回到提交验证前，之后能改派 */
export async function 撤回验证Action(projectId: string) {
  return 验证一步(projectId, (名) => `项目「${名}」撤回线索验证`, (me) => 撤回验证(me, projectId));
}

async function 组员说法(projectId: string, userId: string) {
  const [p, u] = await Promise.all([
    // 回邀请的人同意前看不到项目：这里只取名字写日志
    看全部(() => prisma.project.findUnique({ where: { id: projectId }, select: { name: true } })),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
  ]);
  return `项目「${p?.name ?? ""}」的项目组：${u?.name ?? "已不在的成员"}`;
}

export async function 加项目组员(projectId: string, userId: string, roleId?: string | null) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    const r = await 加组员(me, projectId, userId, roleId);
    if (r.ok) {
      const 邀请 = 企业版() && userId !== me.id;
      await recordAudit({ user: me, action: "create", entity: "ProjectMember", entityId: projectId, summary: `${邀请 ? "邀请进" : "加进"}${await 组员说法(projectId, userId)}` });
      if (邀请) await 邀请通知(me, projectId, userId);
      刷新项目(projectId);
    }
    return r;
  } catch (e) { return 不在了(e); }
}

/** 企业版：被邀请的人点同意 / 拒绝 */
export async function 回项目邀请(memberId: string, 同意: boolean) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    if (!企业版()) return { ok: false as const, error: "项目组邀请是企业版的功能" };
    const r = await 回邀请(me, memberId, 同意 === true);
    if (r.ok && r.projectId) {
      await recordAudit({ user: me, action: "update", entity: "ProjectMember", entityId: r.projectId, summary: `${同意 === true ? "同意加入" : "拒绝加入"}${await 组员说法(r.projectId, me.id)}` });
      刷新项目(r.projectId);
    }
    return r.ok ? { ok: true as const } : r;
  } catch (e) { return 不在了(e); }
}

export async function 换项目组员角色(memberId: string, roleId: string | null) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    const m = await prisma.projectMember.findUnique({ where: { id: String(memberId ?? "") }, select: { projectId: true, userId: true, roleId: true } });
    const r = await 换组员角色(me, memberId, roleId);
    if (r.ok && m && (roleId || null) !== m.roleId) {
      const 角色 = roleId ? (await prisma.projectRole.findUnique({ where: { id: roleId }, select: { name: true } }))?.name : null;
      await recordAudit({ user: me, action: "update", entity: "ProjectMember", entityId: m.projectId, summary: `${await 组员说法(m.projectId, m.userId)} 角色改成「${角色 ?? "不填"}」` });
      刷新项目(m.projectId);
    }
    return r;
  } catch (e) { return 不在了(e); }
}

export async function 移出项目组员(memberId: string) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    const m = await prisma.projectMember.findUnique({ where: { id: String(memberId ?? "") }, select: { projectId: true, userId: true } });
    const r = await 移出组员(me, memberId);
    if (r.ok && m) {
      await recordAudit({ user: me, action: "delete", entity: "ProjectMember", entityId: m.projectId, summary: `移出${await 组员说法(m.projectId, m.userId)}` });
      刷新项目(m.projectId);
    }
    return r;
  } catch (e) { return 不在了(e); }
}

/**
 * 这次改动碰到的每一块都得能改：公海 = 持有上限，超时回收 = 节点时限（再按节点拆），节点推进 = 必填字段
 * （「后台设置谁能改」，lib/enterprise/edit-perm-table.ts；老板总能改）
 */
async function 挡组织规则(me: { id: string; role: string }, 改: 规则改动): Promise<string | null> {
  const 块: [keyof 规则改动, 设置项名, string][] = [["公海", "持有上限", "项目持有上限"], ["超时回收", "节点时限", "各进程时限"], ["节点推进", "必填字段", "进程必填字段"], ["阶段", "阶段规则", "阶段结束状态叫法和往前推权限"],
    // 客户三态接的是超时回收的班，过同一道门：这一项「可选」是空，只有系统管理员能改（M-公海-20）
    ["三态", "节点时限", "客户三态规则"]];
  // 一块都没传就不过任何门，不能当「允许」放过去（10-29 权限枚举表扫出：空改动谁都能存一次规则、留审计）
  if (!块.some(([k]) => 改?.[k] !== undefined)) return "没有要改的规则";
  for (const [k, 项, 叫法] of 块) {
    if (改?.[k] === undefined) continue;
    const 挡 = await 挡改设置(me, 项);
    if (挡) return `${叫法}${挡}`;
  }
  // 节点时限再按节点拆：销售管理 / 市场管理只能动自己那几个节点，开关只有老板、总管理员（edit-perm-table.ts 时限可改节点）
  if (改?.超时回收 !== undefined && 企业版()) {
    const [org, 配置, 现在] = await Promise.all([读组织(), 读改权限(), 读组织规则()]);
    const 挡 = 挡时限改动(能改时限的节点(org, me, 配置), 现在.超时回收, 改.超时回收);
    if (挡) return 挡;
  }
  return null;
}

/** 企业版组织规则（持有上限等）：不是企业版改不了；谁能改见 挡组织规则，每条默认关（lib/project/org-rules.ts） */
export async function 改组织规则(改: 规则改动) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    if (!企业版()) return { ok: false as const, error: "组织规则是企业版的功能" };
    const 挡 = await 挡组织规则(me, 改);
    if (挡) return { ok: false as const, error: 挡 };
    const 旧 = await 读组织规则();
    const 新 = 合上改动(旧, 改);
    if ("error" in 新) return { ok: false as const, error: 新.error };
    await 存组织规则(新);
    const g = 新.公海, t = 新.超时回收;
    const 推 = 新.节点推进;
    const 说 = 改.三态 !== undefined
      ? 三态改动摘要(旧.三态, 新.三态)
      : 改.阶段 !== undefined
      ? 改.阶段.培育计划上限 !== undefined || 改.阶段.无效原因上限 !== undefined
        ? `组织规则：培育计划字数上限 ${新.阶段.培育计划上限 ?? "不设"}，无效原因字数上限 ${新.阶段.无效原因上限 ?? "不设"}`
        : `组织规则：往前推权限 ${新.阶段.推进权限}，改了 ${Object.keys(新.阶段.出口叫法).length} 个阶段的结束状态叫法`
      : 改.节点推进 !== undefined
      ? 推.开 ? `组织规则：节点推进开，${Object.keys(推.必填).length} 个进程配了必填${推.生效于 ? `，只管 ${dayjs(推.生效于).format("YYYY-MM-DD HH:mm")} 之后新建的项目` : ""}` : "组织规则：节点推进关"
      : 改.超时回收 !== undefined
      ? (t.开 ? `组织规则：超时回收开，设了 ${Object.keys(t.节点天数).length} 个进程的处理时长${Object.keys(t.外贸节点天数 ?? {}).length ? `（外贸单设 ${Object.keys(t.外贸节点天数 ?? {}).length} 个）` : ""}` : "组织规则：超时回收关") + (改.超时回收.起算日 !== undefined ? `，起算日 ${t.起算日 ?? "不设"}` : "")
      : 改.公海?.多项目客户 !== undefined
      ? `组织规则：多项目客户公海走法 ${g.多项目客户}`
      : g.持有上限开 ? `组织规则：项目持有上限开，默认 ${是不限(g.默认上限) ? "不限" : `${g.默认上限} 个`}，单独设了 ${Object.keys(g.每人上限).length} 人` : "组织规则：项目持有上限关";
    await recordAudit({ user: me, action: "update", entity: "Setting", entityId: "orgRules", summary: 说, detail: 新 });
    // 改了时长当场按新的扫一遍（老板保存前已经看过会回收几个）
    const 收回 = 改.超时回收 !== undefined ? await 公海超时收回(me) : 0;
    revalidatePath("/settings");
    if (收回) revalidatePath("/projects");
    return { ok: true as const, 收回 };
  } catch (e) { return 不在了(e); }
}

/** 老板保存超时回收设置前先看：按改完的规则，现在会有几个项目回到公海 */
export async function 预览超时回收(改: 规则改动) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    if (!企业版()) return { ok: false as const, error: "组织规则是企业版的功能" };
    const 挡 = await 挡组织规则(me, 改);
    if (挡) return { ok: false as const, error: 挡 };
    const 新 = 合上改动(await 读组织规则(), 改);
    if ("error" in 新) return { ok: false as const, error: 新.error };
    return { ok: true as const, 个数: await 超时预览(新), 团队: !!读团队() };
  } catch (e) { return 不在了(e); }
}

/**
 * 设置 →「客户回收」改天数前先看（PR10a）：按改完的天数，现在约有几位客户的状态会变、其中几位会到期进客户公海。
 * 三态关着 = 预览 null（关着改天数不重算任何人）。谁能看同 改组织规则 的三态那一块
 */
export async function 预览客户回收(改: 规则改动) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    if (!企业版()) return { ok: false as const, error: "组织规则是企业版的功能" };
    if (改?.三态 === undefined) return { ok: false as const, error: "没有要改的客户回收设置" };
    const 挡 = await 挡组织规则(me, 改);
    if (挡) return { ok: false as const, error: 挡 };
    const 新 = 合上改动(await 读组织规则(), 改);
    if ("error" in 新) return { ok: false as const, error: 新.error };
    return { ok: true as const, 预览: await 三态改天数预览(新.三态) };
  } catch (e) { return 不在了(e); }
}

/**
 * 在项目上记一条沟通（项目详情「记一条」）。下一步做什么必填一句话；开了超时回收的线索 / 商机阶段还要带下一步时间。
 * 10-31 F-跟进-08：可顺带一个卡点（类型 / 影响 / 描述都选填，类型「暂无」就不生成，lib/project/blocker-rules.ts 沟通卡点）。
 * 卡点先验好再记沟通；沟通记上了、卡点没发成（比如没有发卡点的权限）不回滚沟通，回一句 卡点没发 给界面提示
 */
export async function 记项目沟通Action(projectId: string, input: 向导跟进, 卡点?: 沟通卡点输入) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    if (!企业版()) return { ok: false as const, error: "在项目上记沟通是企业版的功能，请去客户页记" };
    const 要发 = 卡点 == null ? null : 沟通卡点(卡点, await 读卡点默认());
    if (要发 && "error" in 要发) return { ok: false as const, error: `卡点：${要发.error}` };
    const r = await 记项目沟通(me, projectId, input, new Date(), { 要下一步文字: true });
    let 卡点结果: { 卡点?: string; 卡点没发?: string } = {};
    if (r.ok && 要发 && r.followUpId) {
      const b = await 发布卡点(me, r.followUpId, 要发);
      if (b.ok && b.code) {
        卡点结果 = { 卡点: b.code };
        await recordAudit({ user: me, action: "create", entity: "EntBlocker", entityId: projectId, summary: `记沟通时发布卡点 ${b.code}` });
        await 卡点发布通知(me, b.code);
      } else if (!b.ok) 卡点结果 = { 卡点没发: b.error };
    }
    if (r.ok) {
      const p = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true, customerId: true } });
      await recordAudit({
        user: me, action: "create", entity: "FollowUp", entityId: r.followUpId,
        summary: `在项目「${p?.name ?? ""}」上记了一条沟通（${input.阶段 ?? ""}阶段）`,
      });
      await 记这个项目的自动推进(me, projectId, r.自动推到);
      // 客户三态：记了一条沟通（可能还推了节点），马上重算这位的钟（关着不查库，出错不影响保存）
      await 存沟通后重算三态(p?.customerId);
      刷新项目(projectId, p?.customerId);
    }
    // 客户三态（C12）：这条不算有效沟通，回原因给前端一句轻提示（不拦；三态关着不查库）
    const 短沟通 = r.ok ? await 短沟通提示(r.followUpId).catch(() => null) : null;
    return r.ok ? { ok: true as const, followUpId: r.followUpId, ...(r.自动推到 ? { 自动推到: r.自动推到 } : {}), ...卡点结果, ...(短沟通 ? { 短沟通 } : {}) } : r;
  } catch (e) { return 不在了(e); }
}

export type 项目沟通须知结果 =
  /** 卡点默认：能发卡点才给（F-跟进-08，表单摆卡点那一块）；null = 不摆 */
  | { ok: true; 能记: true; phase: string; 要下一步: boolean; 回收预演: 回收预演底子 | null; contactId: string | null; 卡点默认: 卡点默认 | null; 卡点原因们: string[];
    /** 记的人是组员（不是能改项目的人，11-19 客户答复）：下一步是负责人的格，表单不摆下一步、服务端也不写 */
    组员记: boolean }
  | { ok: true; 能记: false }
  | { ok: false; error: string };

/**
 * 客户页记沟通时选了关联项目（10-30 P0-3）：只读，告诉表单这条能不能走「记项目沟通Action」那条路、
 * 要不要填下一步时间、回收日怎么预演。谁能记和 lib/project/db.ts 记项目沟通 同一个判断；
 * 回收预演和项目详情 page.tsx 同一套（配了必填的进程记完可能自动推走，算不准就给 null）
 */
export async function 项目沟通须知(projectId: string): Promise<项目沟通须知结果> {
  try {
    const me = await requireUser();
    if (!(await 开着()) || !企业版() || typeof projectId !== "string" || !projectId) return { ok: true, 能记: false };
    const p = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, ownerId: true, pooledAt: true, phase: true, node: true, result: true, nextStepAt: true, createdAt: true, customerId: true, contactId: true, bizLine: true } });
    // 已结束 / 在公海的不走项目那条（11-17 沟通必须挂在推项目：落到 saveFollowUp 也会拦下、说清楚）
    if (!p || p.pooledAt || p.result) return { ok: true, 能记: false };
    // 11-17：负责人或已进组的组员能记（和 lib/project/db.ts 记项目沟通 同一个判断）
    const 组员 = await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: p.id, userId: me.id } }, select: { inviteStatus: true } });
    const org = await 权限组织();
    if (!能往项目记沟通(me, p, org, 组员?.inviteStatus)) return { ok: true, 能记: false };
    const 组员记 = !能管项目(me, p, org);
    const 规则 = await 生效组织规则();
    const 要下一步 = !组员记 && 规则.超时回收.开 && !p.result && (能进公海的阶段 as readonly string[]).includes(p.phase);
    let 回收预演: 回收预演底子 | null = null;
    // 验证中的线索不参与超时回收（X-78）：不预演回收日
    const 验证中 = !!(await prisma.entLeadVerify.findUnique({ where: { projectId: p.id }, select: { pending: true } }))?.pending;
    if (要下一步 && !项目按必填走(规则, p) && !验证中) {
      const 字典 = 字典of(true, 规则.阶段.出口叫法);
      const c = await 看全部(() => prisma.customer.findUnique({ where: { id: p.customerId }, select: { lastFollowAt: true } }));
      // 最近一条留痕：超时自动转那行不算（Even 11-19 第 14 题 B，同 lib/project/db.ts 项目回收日）
      const [留] = await 补回收起点留痕([p]);
      const 起点 = 超时起点(p.createdAt, 留.logs[0]?.at, c?.lastFollowAt);
      const 线 = 超时线(p, await 超时成员线(规则));  // 按项目业务线分内外贸天数（C7）
      const 天数 = 超时回收日(规则, p, 起点, 字典, 线) ? 节点超时天数(规则, p.node, 字典, 线) : null;
      if (天数) 回收预演 = { 起点日: 计时起点(规则, 起点).format("YYYY-MM-DD"), 天数 };  // 起算日之前不算（10-31）
    }
    const 能发 = await 能发卡点(me, p.id);
    const 卡点默认 = 能发 ? await 读卡点默认() : null;
    const 卡点原因们 = 能发 ? await 可选原因们() : [];
    return { ok: true, 能记: true, phase: p.phase, 要下一步, 回收预演, contactId: p.contactId ?? null, 卡点默认, 卡点原因们, 组员记 };
  } catch (e) { return 不在了(e); }
}

/**
 * 项目详情里一条沟通的「…」菜单（10-29）。改、删都走客户页那一套（saveFollowUp / deleteFollowUp），规矩不另写：
 * 只认挂在这个项目上的沟通；同事的客户 / 虚线下属的客户（只读客户）改不了、删不了，和客户页不摆编辑删除一致。
 * 删 = 企业版软删，进「设置 → 回收站」，30 天内系统管理员、回收站副手能恢复
 */
async function 项目上的沟通(projectId: string, followUpId: string) {
  if (typeof projectId !== "string" || typeof followUpId !== "string" || !projectId || !followUpId) return { ok: false as const, error: "这条沟通的信息不完整，刷新看看" };
  const 挂 = await prisma.followUpProject.findUnique({ where: { followUpId }, select: { projectId: true } });
  if (!挂 || 挂.projectId !== projectId) return { ok: false as const, error: "这条沟通不在这个项目上了，刷新看看" };
  const f = await prisma.followUp.findUnique({ where: { id: followUpId } });
  if (!f) return { ok: false as const, error: "这条沟通已经不在了（可能在别处删了），刷新看看" };
  const c = await prisma.customer.findUnique({ where: { id: f.customerId }, select: { id: true, salesOwnerId: true, channelOwnerId: true, pool: { select: { customerId: true } } } });
  if (!c) return { ok: false as const, error: "这位客户已经不在了，刷新看看" };
  const 只读档 = await 只读客户(defaultClient, c);
  if (只读档 === "全") return { ok: false as const, error: await 只读话(defaultClient) };
  if (只读档) return { ok: false as const, error: "这是同事的客户：只能新加沟通，改、删已有的请找负责人" };
  return { ok: true as const, f };
}

export type 改沟通输入 = { type: string; method?: string | null; /** 发起主体（企业版，11-01）：没带不动 */ initiator?: string | null; content: string; occurredAt: string; 版本?: string };

/** 改项目上的一条沟通：只改沟通方式、发起主体、时间、内容，别的格子（状态、时长、提醒、联系人、与会人）原样带回去 */
export async function 改项目沟通(projectId: string, followUpId: string, input: 改沟通输入) {
  try {
    await requireUser();
    if (!(await 开着())) return 没开;
    if (!企业版()) return { ok: false as const, error: "在项目上改沟通是企业版的功能，请去客户页改" };
    if (!input || typeof input !== "object") return { ok: false as const, error: "沟通信息格式不正确" };
    const 查 = await 项目上的沟通(projectId, followUpId);
    if (!查.ok) return 查;
    const f = 查.f;
    const r = await saveFollowUp({
      id: f.id, customerId: f.customerId, type: input.type, method: input.method, initiator: input.initiator, content: input.content, occurredAt: input.occurredAt,
      title: f.title, status: f.status, durationMinutes: f.duration != null ? f.duration / 60 : null,
      dueAt: scheduleValue(f.dueAt, f.dueOn), dueHasTime: f.dueHasTime ?? undefined,
      contactId: f.contactId, opportunityId: f.opportunityId, participants: f.participants,
      版本: input.版本 ?? f.updatedAt.toISOString(),
    });
    if (!r.ok) return r;
    刷新项目(projectId, f.customerId);
    return { ok: true as const };
  } catch (e) { return 不在了(e); }
}

/** 删项目上的一条沟通：企业版软删进回收站（11-09 起不给本人撤回，找回走回收站） */
export async function 删项目沟通(projectId: string, followUpId: string) {
  try {
    await requireUser();
    if (!(await 开着())) return 没开;
    if (!企业版()) return { ok: false as const, error: "在项目上删沟通是企业版的功能，请去客户页删" };
    const 查 = await 项目上的沟通(projectId, followUpId);
    if (!查.ok) return 查;
    const r = await deleteFollowUp(followUpId, 查.f.customerId);
    if (!r.ok) return r;
    刷新项目(projectId, 查.f.customerId);
    return { ok: true as const };
  } catch (e) { return 不在了(e); }
}
