"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { DownOutlined, MoreOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { App, Alert, Button, Card, Checkbox, Dropdown, Input, Menu, Modal, Progress, Radio, Select, Space, Tag, Timeline, Tooltip, type MenuProps } from "antd";
import DatePicker from "@/components/BusinessDatePicker";
import DictSelect from "@/components/DictSelect";
import InlineConfirm from "@/components/InlineConfirm";
import { 其他没写好 } from "@/lib/enterprise/dict-kinds";
import { 项目不能单独领提示 } from "@/lib/enterprise/pool-rules";
import { 必填叫法 } from "@/lib/project/required";
import { PageHead, CustomerLink, FollowTypeCell } from "@/components/ui";
import { useBusiness } from "@/lib/business-client";
import { dayjs, fmtDateTime, 成员选项, 独自一人 } from "@/lib/utils";
import { 回公海文案, 回公海颜色, 预演回收日, type 回收预演底子 } from "@/lib/enterprise/recycle-text";
import { 跟进类型们 } from "@/lib/constants";
import FollowMethodSelect from "@/components/FollowMethodSelect";
import { 对得上的方式 } from "@/lib/follow-method";
import { 外贸精简 } from "@/lib/business-config";
import { 金额, 合计文字, 按币种合计, 默认币种 } from "@/lib/currency";
import { 阶段们, 交付还差, 终止结局, 下一步, 节点序号, 节点总数of, 原因上限, 要写原因, 字典of, 结局叫法, 是交付, 团队版字典, type 位置, type 阶段字典 } from "@/lib/project/nodes";
import { 超时理由 } from "@/lib/project/timeout";
import { 阶段与进程, type 出口叫法改动 } from "@/lib/project/stage-dict";
import { 有效线索节点, 缺有效沟通 } from "@/lib/project/stage-gates";
import type { 线索验证 } from "@/lib/project/lead-verify";
import LeadVerifyPanel from "./LeadVerifyPanel";
import ProjectStages from "./ProjectStages";
import AiWait from "@/components/AiWait";
import AiCost, { AiRemaining, useAiOutOfCredits } from "@/components/AiCost";
import { clearJob, runJob } from "@/lib/ai-jobs";
import type { 可选渠道 } from "@/components/ChannelPicker";
import { 拼地址, 企业级别, 企业级别说明, type 客户地址 } from "@/lib/enterprise/customer-v2";
import { 级别星 } from "@/lib/enterprise/level-stars";
import { 项目区域, type 项目成交钱 } from "@/lib/project/profile-rules";
import type { 合同状态 } from "@/lib/project/proj-fields";
import { 项目沟通预填, 沟通时间格式, 下一步文字上限 } from "@/lib/project/project-fields";
import { parseFollowUpDraft } from "../../customers/[id]/ai";
import { 改项目节点, 终止项目进程, 勾项目交付, 删除项目, 放回项目公海, 领取项目, 记项目沟通Action, 改项目沟通, 删项目沟通, 撤销删项目沟通, 编辑项目 } from "../actions";
import type { 可选成员 } from "@/lib/utils";
import { ProjectEditModal, ProjectTeamCard, type 组员, type 角色, type 联系人 } from "./ProjectTeam";
import { BlockerList, PublishBlockerModal, type 卡点卡, type 可选人 } from "../BlockerPanel";
import type { 卡点默认 } from "@/lib/project/blocker-rules";
import { ProjectCommissionCard, SplitModal } from "./ProjectCommission";
import { ContactAttachmentsButton } from "../../customers/[id]/ContactAttachments";
import type { 提成卡 } from "@/lib/project/commission";
import PaneToggle from "@/components/PaneToggle";
import { ProjectAttachmentsCard, ProjectPaymentsCard, ProjectProfileCard, type 项目画像 } from "./ProjectExtras";
import type { 回款 } from "@/lib/project/payment-db";
import ProjectRelate from "./ProjectRelate";
import type { 项目关联 } from "@/lib/project/relate";

export type 项目详情 = {
  id: string; name: string; remark: string | null; amount: number; currency: string;
  /** null = 公海里同事客户的项目，领取后再给（page.tsx 露客户）；联系人、沟通这时也是空的 */
  customer: { id: string; name: string; school: string | null } | null;
  contact: { id: string; name: string; position: string | null } | null;
  /** 企业版联系人附件（2026-10-28）：联系人那一行下面的「附件」入口；只读 = 同事的 / 虚线下属的客户，只能看。别的版本、看不到这位联系人时没有这个字段 */
  联系人附件?: { 个数: number; 只读: boolean };
  /** 线索转出来的项目：来源线索的名字（null = 那条线索已删除）和转化日；不是线索转的、或公海里还没领时是 null */
  来源线索: { name: string | null; convertedAt: string | null } | null;
  /** 企业版字典下拉（10-27）：放回公海选「回收原因」、线索流失选「无效原因」；不是企业版两个都是空的，界面照旧 */
  原因选项: { 回收: string[]; 无效: string[] };
  /** 企业版线索阶段：线索有效性验证（P12）的判定、待哪步、时间线 */
  线索验证?: 线索验证;
  ownerId: string; ownerName: string; creatorName: string; createdAt: string;
  /** 历史负责人（只企业版有，别的版本是空的）：把这个项目放回过公海的人，最近放回的在前，同一个人只列一次 */
  historyOwners: string[];
  phase: string; node: string; result: string | null;
  /** 异常状态时：选的异常类别名、备注（可空） */
  exceptionReason: string | null; exceptionCategory: string | null;
  /** 在项目公海里；能放公海 = 我是负责人且在线索 / 商机阶段；能领取 = 在公海里，且我不是原负责人（企业版按 pool-rules.ts） */
  pooled: boolean; 能放公海: boolean; 能领取: boolean;
  /** 企业版原负责人领不回时那句话：领取按钮照样摆、灰着，悬停给这句；null = 不用灰 */
  领取不给: string | null;
  /** 在公海里时最近一次怎么进来的（ownerName 这时是原负责人）：谁放的、超时系统收 / 办停用时放 / 手动放回 */
  进公海: { 方式: 放回方式; 谁: string } | null;
  /** 服务端读的 企业版()：放回公海的说法跟着它走 */
  企业版: boolean;
  /** 企业版组织规则里改过的出口叫法（设置 → 项目 → 阶段规则）；别的版本是空的 */
  出口叫法: 出口叫法改动;
  /** 企业版线索阶段：客户明确回复了的沟通有几条（0 = 推不过线索验证）；别的阶段、别的版本是 0 */
  有效沟通: number;
  /**
   * 企业版超时回收：nextStepAt 是最近一次沟通填的下一步时间（服务端排好的 YYYY-MM-DD）；回收日 = 哪天没人跟进就自动回公海（null = 不会）；
   * 要下一步 = 记沟通必须填下一步时间；能记沟通 = 企业版里的负责人、老板、主管、项目组成员，且不在公海（不是企业版照原来去客户页记）
   * nextStepText = 下一步做什么（10-29 起记沟通时自己写一句话，时间可空）；老数据只有时间没有这句，就只摆时间
   */
  nextStepAt: string | null; nextStepText?: string | null; 回收日: string | null;
  /** 企业版记沟通时预演回收日的底子（page.tsx，lib/enterprise/recycle-text.ts 预演回收日）；算不准（规则关着、配了必填会自动推）= null，弹窗里不写那一句 */
  回收预演?: 回收预演底子 | null;
  /** 企业版预计成交日期（10-27 从客户挪到项目，服务端排好的 YYYY-MM-DD）；不是企业版不传 */
  expectedDealAt?: string | null; 要下一步: boolean; 能记沟通: boolean;
  /** 沟通的「…」菜单（改 / 删，10-29）：能记沟通、看得到客户，且不是同事 / 虚线下属的客户 */
  可改沟通?: boolean;
  /**
   * 企业版（10-29 P6）：项目来源 = 项目自己选的渠道（没选 = 跟客户来源走，null = 客户也没有）；已立项天数从建项目那天按自然日数；
   * 渠道们 = 能改时编辑框里选项目来源用的；aiEnabled = 「记一条沟通」里给不给 AI 解析（没配模型不给）。不是企业版都不传
   */
  项目来源?: { name: string; 跟客户: boolean } | null; channelId?: string | null; 已立项天数?: number; 渠道们?: 可选渠道[]; aiEnabled?: boolean;
  /**
   * 企业版（P11 定稿 -2 版，迁移 093）：项目级别 S / A / B / C（null = 没分级），显示成星；
   * 所在地 = 地址四格 + 详细地址，跟客户资料一样公海里同事客户的项目没领之前是 null（不摆）。不是企业版都不传
   */
  level?: string | null; 所在地?: (客户地址 & { location: string | null }) | null;
  /** 企业版需求描述（10-31 前叫成交需求）、合同金额 + 币种、定金金额 + 币种（迁移 097）；不是企业版不传 */
  成交钱?: 项目成交钱;
  /**
   * 企业版痛点标注、合同状态（迁移 101）：不是企业版不传；某一项字段权限是「藏」就没有那个键（不摆那一行、编辑框不交）。
   * 合同状态老项目库里空的，page.tsx 已经按「起草中」兜底
   */
  项目新字段?: { painPoints?: string | null; contractStatus?: 合同状态 };
  /**
   * 企业版节点必填：这个节点配了必填才有（没开 / 没配 / 有结局 / 在公海 = null）。填齐了自动往前推；
   * 只能靠填齐 = 不是老板、主管，手动往前推不给（往后退、点结局照旧）
   */
  必填: { 配了: string[]; 还差: string[]; 只能靠填齐: boolean } | null;
  /** 企业版 D-37：负责人有直属上级、我又不是这位上级（也不是老板）时，往前推不给的那句话；null = 能推 */
  不给推: string | null;
  /** 能改节点：能改的人 + 企业版负责人的直属上级（账号可能是 SALES）；只管节点这一块 */
  能改节点: boolean;
  balanceSettled: boolean; balanceSettledBy: string | null; balanceSettledAt: string | null;
  acceptancePassed: boolean; acceptancePassedBy: string | null; acceptancePassedAt: string | null;
  /** kind 不是 node 的行是换负责人（转让 / 放回公海 / 从公海领取），transfer 记从谁到谁；category 是进异常时选的类别 */
  logs: {
    id: string; at: string; who: string; from: 位置 | null; to: 位置; reason: string | null; category: string | null;
    kind: "node" | "transfer" | "pool-release" | "pool-claim"; transfer: { from: string; to: string } | null;
    /** pool-release 才有：超时系统收的、办停用时放的（who 是办的那位）、手动放回 */
    放回方式?: 放回方式;
  }[];
  /** 企业版：code 是沟通编号（只在服务端用，界面不摆），提醒按下一步时间写事实（page.tsx 时限标签），没填下一步时间不给 */
  followUps: { id: string; type: string; method?: string | null; content: string; occurredAt: string; who: string; node: string; /** 打开修改时的 updatedAt：别人先改了就报版本冲突 */ 版本?: string; code?: string | null; 提醒?: { 级别: "稳" | "拿捏" | "超时"; 文字: string } | null }[];
  members: 组员[];
  /** 企业版提成卡：不是企业版、我看不了（不是组长 / 组员 / 管理员 / 上级）= null，卡片不出 */
  提成: 提成卡 | null;
  /** 删项目时一起删掉的：节点留痕（含转让痕）、项目组、沟通和项目的关联 */
  删前清点: { 留痕: number; 组员: number; 沟通: number };
  /** 企业版项目画像（P11）：不是企业版、公海里没领的不给 */
  画像?: 项目画像;
  /** 企业版关联客户 / 联系人（P17）：不是企业版、公海里没领的不给 */
  关联?: 项目关联;
  /** 企业版项目附件（P11）：看得到才有；只读 = 不能改这个项目（api/attachments/access.ts 项目附件入口） */
  项目附件?: { 合同: number; 方案: number; 其它: number; 只读: boolean };
  /** 企业版项目回款（10-31，迁移 100）：一笔一行；项目卡上写「当前回款」= 按币种加 */
  回款们?: 回款[];
};

const 行样: React.CSSProperties = { display: "flex", gap: 12, alignItems: "center", marginBottom: 8, minWidth: 0 };
// 四个字的键（来源线索 / 预计成交）在 14px 下要 ~56px，48px 会折成两行（10-27）
const 键样: React.CSSProperties = { color: "var(--text-muted)", flex: "0 0 4.3em", whiteSpace: "nowrap" };

/** 删项目的确认框：列出一起删掉的几样，说清沟通记录本身不删 */
function 删除说明(n: 项目详情["删前清点"], 客户叫法: string, 进回收站 = false) {
  const 删 = [`${n.留痕} 条进程留痕`, n.组员 ? `项目组 ${n.组员} 人` : "", n.沟通 ? `${n.沟通} 条沟通和这个项目的关联` : ""].filter(Boolean);
  // 企业版（P9）：删了进回收站，留痕、项目组原样留着，恢复时一起回来
  if (进回收站) return (
    <div style={{ maxWidth: 320 }}>
      <div>删了进回收站，30 天内可在 设置 → 回收站 恢复。</div>
      <div>一起收起来：{删.join("、")}，恢复时原样回来；沟通记录本身留在{客户叫法}下</div>
    </div>
  );
  return (
    <div style={{ maxWidth: 280 }}>
      <div>一起删掉：{删.join("、")}</div>
      <div>沟通记录本身留在{客户叫法}下，不删。删了找不回来</div>
    </div>
  );
}

/** 「线索·潜客培育」「订单·验收交付（异常状态）」；结局按字典的叫法（后台改了出口叫法就用改的） */
function 位置文字(p: 位置, 字典: 阶段字典 = 团队版字典): string {
  return `${p.phase}·${p.node}${p.result ? `（${结局叫法(p.result, 字典)}）` : ""}`;
}

/**
 * 下拉里的去处：每个阶段的节点，加上这个阶段的「没走成」结局（订单阶段是成功交付和异常状态）。
 * 异常状态只在项目已经在订单阶段时出现，线索、商机阶段不给这个入口。
 * 往前只能一步（比现在多走超过一步的灰着），往后随便退——和 lib/project/nodes.ts 改节点问题 同一条规矩。
 * 企业版（字典跨阶段不能退）：前面阶段的节点、结局都灰着；线索、商机阶段多列一条「→ 转商机 / → 赢单」，
 * 选它 = 进下一阶段第一个节点（和直接选那个节点一样），让「线索只能流失或转商机、商机只能流失或赢单」在下拉里看得见
 */
function 去处们(当前: 位置, 不能往前 = false, 字典: 阶段字典 = 团队版字典) {
  // 配了必填、不是老板主管：往前的节点灰着（靠填齐自动推），结局照旧能点
  const 太远 = (到: 位置) => 节点序号(到, 字典) > 节点序号(当前, 字典) + (不能往前 && !到.result ? 0 : 1);
  const 退不回 = (s: string) => !字典.跨阶段能退 && 阶段们.indexOf(s as never) < 阶段们.indexOf(当前.phase as never);
  return 阶段们.map((s, i) => {
    const 列 = 字典.节点们[s];
    const 尾 = 列[列.length - 1];
    const 结局 = (s === "订单" ? 字典.出口们.订单 : [字典.出口们[s][1]])
      .map((o) => o.结局)
      .filter((r): r is NonNullable<typeof r> => !!r && (r !== "异常状态" || 当前.phase === "订单"));
    const 下阶段 = 阶段们[i + 1];
    const 走成 = !字典.跨阶段能退 && 下阶段 ? 字典.出口们[s][0] : null;
    return {
      label: s,
      options: [
        ...列.map((n) => {
          const 到 = { phase: s, node: n };
          return { value: JSON.stringify(到), label: n, disabled: (!当前.result && 当前.phase === s && 当前.node === n) || 太远(到) || 退不回(s) };
        }),
        // 结局落在哪个节点：没走成的停在当前节点（同阶段时），否则停在阶段最后一个节点
        ...结局.map((r) => {
          const 到 = { phase: s, node: 当前.phase === s ? 当前.node : 尾, result: r };
          return { value: JSON.stringify(到), label: `→ ${结局叫法(r, 字典)}`, disabled: 当前.result === r || 太远(到) || 退不回(s) };
        }),
        // 走成那条（只在项目还在这个阶段时能点）：值里带个 出口 记号，免得和下一阶段第一个节点撞值；改到 之前去掉
        ...(走成 && 下阶段
          ? [(() => {
              const 到 = { phase: 下阶段, node: 字典.节点们[下阶段][0] };
              return { value: JSON.stringify({ ...到, 出口: 走成.叫法 }), label: `→ ${走成.叫法}`, disabled: 当前.phase !== s || 太远(到) };
            })()]
          : []),
      ],
    };
  });
}

/** 项目怎么进的公海（page.tsx 按理由分）：超时 = 系统收的；停用 = 管理员办停用时放的；手动 = 有人放回 */
export type 放回方式 = "超时" | "停用" | "手动";

/** 节点变更里换负责人那几种行怎么说。放回公海按真正的操作人说（QA #14：超时是系统、停用是办的那位管理员，不是原负责人） */
function 换人文字(l: 项目详情["logs"][number]): string {
  const t = l.transfer ?? { from: "没人", to: "没人" };
  if (l.kind === "pool-release") {
    // 老数据没带方式的按理由认超时
    const 方式 = l.放回方式 ?? (l.reason === 超时理由 ? "超时" : "手动");
    if (方式 === "超时") return `${t.from} 的项目超时没跟进，系统自动收回到项目公海`;
    if (方式 === "停用") return `${l.who} 办成员停用，把 ${t.from} 的项目放回项目公海`;
    return l.who === t.from ? `${t.from} 把项目放回项目公海` : `${l.who} 把 ${t.from} 的项目放回项目公海`;
  }
  if (l.kind === "pool-claim") return `${t.to} 从项目公海领取，成为负责人`;
  return `负责人从 ${t.from} 转给 ${t.to}`;
}

/** 负责人那一行括号里：怎么进的公海 */
/** 空着的字段写「待填写X / 待选择X」（浅灰，和输入框占位同色）；只是显示，不存。0 算填了，由调用方用 !== null 判 */
const 待填 = (名: string, 动 = "填写") => <span style={{ color: "var(--text-faint)" }}>待{动}{名}</span>;
/** 这个进程配了必填、还没填的那几格写「占位确认」（10-31 用户：「未填且必填的地方…显示的是占位确认这四个字」）；别的空格照旧写待填写 / 待选择 */
const 占位确认 = (名: string) => <span style={{ color: "var(--text-faint)" }} title={`必填：${名}，填齐后自动往前推`}>占位确认</span>;

/** 项目级别格（企业版 P11）：星 + 档名（「★★★☆ A 重点」）；没分级写「没分级」，认不出的原样给 */
function 级别格(v: string | null) {
  if (!v) return <span style={{ color: "var(--text-muted)" }}>没分级</span>;
  const 档 = 企业级别(v);
  if (!档) return <span>{v}</span>;
  return (
    <span title={企业级别说明[档]}>
      <span aria-hidden style={{ color: "var(--warning-text)", letterSpacing: 1 }}>{级别星(档)}</span>
      {" "}<span style={{ color: "var(--text-muted)" }}>{企业级别说明[档].replace(/^\S+\s*/, "")}</span>
    </span>
  );
}

function 进公海说法(进: 项目详情["进公海"], 原负责人: string): string {
  if (!进) return "";
  if (进.方式 === "超时") return " · 超时没跟进，系统自动收回";
  if (进.方式 === "停用") return ` · 成员停用，${进.谁} 放回`;
  return 进.谁 === 原负责人 ? " · 自己放回的" : ` · ${进.谁} 放回的`;
}

/**
 * 项目详情：顶上是节点进度和「下一步」，中间改节点 / 点结局、勾尾款结清和验收通过，下面是节点变更和挂在这个项目上的沟通。
 * 只有负责人、老板、主管能改；其他人看得到、按钮灰着
 */
/** 企业版卡点：项目详情上的卡点列表、发卡点要的默认值和可指认的人；不是企业版不给（null） */
export type 项目卡点 = { 们: 卡点卡[]; 能发: boolean; 默认: 卡点默认; 人们: 可选人[] };

const 无效原因前缀 = "无效原因：";

// 规则 E：红只给已经过了的，当天橙，还早的不上色
const 提醒色 = { 稳: undefined, 拿捏: "gold", 超时: "red" } as const;

/** 菜单项两行：上面是名字，下面一行淡色小字说明（会跳过哪几步、到此结束…） */
function 两行(名: string, 注?: string) {
  return (
    <div style={{ lineHeight: 1.4, padding: "2px 0", maxWidth: 280, whiteSpace: "normal" }}>
      <div>{名}</div>
      {注 && <div style={{ fontSize: "var(--dt-aux, 12px)", color: "var(--text-muted)" }}>{注}</div>}
    </div>
  );
}

/**
 * 节点卡「更多」里的去处（10-30 P0-8 / P2）：按 往前 / 退回 / 结束 分组，每项写明会跳过哪几步。
 * 能不能点还是 去处们 那一套（往前只能一步、企业版不能退回前面的阶段）；紧挨着的下一步就是主按钮，菜单里不重复。
 * 已经有结局（流失 / 异常 / 成功交付）的：改回某个进程、或换个结局
 */
/** 企业版页头具名按钮开的框（10-31 R6）→ 框的标题 */
const 头部框叫法 = {
  推进: "改进程",
  完成: "完成节点",
  线索判定: "线索判定",
  画像: "项目画像",
  关联客户: "关联客户",
  关联联系人: "关联联系人",
  管理关联: "管理关联",
  附件: "附件",
  成员: "项目组成员",
  改分配: "改分配",
  管理沟通: "管理沟通",
} as const;
type 头部框 = keyof typeof 头部框叫法;

function 更多去处(当前: 位置, 组们: ReturnType<typeof 去处们>, 字典: 阶段字典): NonNullable<MenuProps["items"]> {
  const 序 = 节点序号(当前, 字典);
  const 全路 = 阶段们.flatMap((s) => 字典.节点们[s].map((n) => ({ phase: s as string, node: n })));
  const 叫 = (到: 位置) => (到.phase === 当前.phase ? 到.node : `${到.phase}·${到.node}`);
  const 项们 = 组们.flatMap((g) => g.options.map((o) => {
    const v = JSON.parse(o.value) as 位置 & { 出口?: string };
    return { key: o.value, 到: { phase: v.phase, node: v.node, ...(v.result ? { result: v.result } : {}) } as 位置, 出口: v.出口, disabled: o.disabled };
  }));
  const 结束注 = (r: string) => (r === "异常状态" ? "标成异常，处理好了改回进程就恢复" : "项目到此结束，以后可以改回进程");
  const 结束们 = 项们.filter((x) => x.到.result && !x.disabled && x.到.result !== 当前.result)
    .map((x) => ({ key: x.key, label: 两行(结局叫法(x.到.result!, 字典), 结束注(x.到.result!)) }));
  const 组 = (key: string, label: string, children: NonNullable<MenuProps["items"]>) => (children.length ? [{ type: "group" as const, key, label, children }] : []);
  if (当前.result) {
    const 回 = 项们.filter((x) => !x.到.result && !x.出口 && !x.disabled).map((x) => ({ key: x.key, label: 两行(叫(x.到)) }));
    return [...组("back", "改回进程", 回), ...组("end", "结束", 结束们)];
  }
  // 走成那条（转商机 / 赢单）和下一阶段第一个节点是同一个去处：留有名字的那条
  const 走成到 = new Set(项们.filter((x) => x.出口).map((x) => `${x.到.phase}|${x.到.node}`));
  const 节点们 = 项们.filter((x) => !x.到.result && !(!x.出口 && 走成到.has(`${x.到.phase}|${x.到.node}`)));
  const 往前 = 节点们
    .map((x) => ({ ...x, n: 节点序号(x.到, 字典) }))
    .filter((x) => x.n > 序 + 1 && x.n <= 序 + 4)
    .map((x) => {
      const 跳 = 全路.slice(序 + 1, x.n).map(叫);
      return { key: x.key, disabled: x.disabled, label: 两行(x.出口 ?? 叫(x.到), `会跳过 ${跳.join("、")}${x.disabled ? "（只能一步步推）" : ""}`) };
    });
  const 退回 = 节点们
    .map((x) => ({ ...x, n: 节点序号(x.到, 字典) }))
    .filter((x) => x.n < 序 && !x.disabled)
    .sort((a, b) => b.n - a.n)
    .map((x) => ({ key: x.key, label: 两行(叫(x.到), `退回 ${序 - x.n} 步`) }));
  return [...组("forward", "往前", 往前), ...组("back", "退回", 退回), ...组("end", "结束", 结束们)];
}

export default function ProjectDetail({
  p, 能改, 候选, 在职, 联系人们, 角色们, 类别们, 卡点 = null,
}: {
  p: 项目详情;
  能改: boolean;
  候选: 可选成员[];
  在职: 可选成员[];
  联系人们: 联系人[];
  角色们: 角色[];
  /** 在用的异常类别（进异常状态时选） */
  类别们: { id: string; name: string }[];
  卡点?: 项目卡点 | null;
}) {
  const router = useRouter();
  const { message, modal } = App.useApp();
  const b = useBusiness();
  const [忙, set忙] = useState(false);
  const [异常框, set异常框] = useState<位置 | null>(null);
  const [没成框, set没成框] = useState<位置 | null>(null);
  /** 异常框 / 没成框是「终止进程」开的（M-节点-04）：确定时走 终止项目进程 */
  const [终止中, set终止中] = useState(false);
  const [无效原因, set无效原因] = useState<string | null>(null);
  const [放回框, set放回框] = useState(false);
  const [回收原因, set回收原因] = useState<string | null>(null);
  const [原因, set原因] = useState("");
  const [类别, set类别] = useState<string | null>(null);
  const [编辑开着, set编辑开着] = useState(false);
  const [记一条开着, set记一条开着] = useState<false | "手填" | "AI">(false);
  const [发卡点于, set发卡点于] = useState<string | null>(null);
  /** 沟通的「…」菜单：正在改哪一条 / 删除问句开在哪一条上 */
  const [改沟通于, set改沟通于] = useState<项目详情["followUps"][number] | null>(null);
  const [删问于, set删问于] = useState<string | null>(null);
  /** 转让项目（10-30，原名「转给…」）：弹窗开着、选了谁、点了转给以后 6 秒等撤销的那位 */
  const [转给框, set转给框] = useState(false);
  const [转给谁, set转给谁] = useState<string | null>(null);
  const [待转给, set待转给] = useState<string | null>(null);
  const 转给计时 = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 企业版页头具名按钮开的那个框（10-31 R6），一次只开一个 */
  const [头部框, set头部框] = useState<头部框 | null>(null);
  /** 附件框每关一次 +1：页面上那几格附件重新挂上，个数跟着刷新 */
  const [附件版, set附件版] = useState(0);
  const 当前: 位置 = { phase: p.phase, node: p.node, result: p.result };
  const 字典 = 字典of(p.企业版, p.出口叫法);
  const 节点总数 = 节点总数of(字典);
  const 下 = 下一步(当前, 字典);
  const 差 = 交付还差(p);
  // 订单走成的结局：团队版 成功交付、企业版 交付结清（10-31 改名）；叫法按字典（后台改了就用改的）
  const 交付结局 = 字典.出口们.订单[0].结局 ?? "成功交付";
  const 交付叫法 = 结局叫法(交付结局, 字典);
  const 交付了 = 是交付(p.result);
  const 异常 = p.result === "异常状态";
  const 可改 = 能改 && !p.pooled;
  const 不能改 = p.pooled ? "这个项目在项目公海里，领取了才能改" : 能改 ? undefined : "只有项目负责人、老板或主管能改";
  const 节点可改 = p.能改节点 && !p.pooled;
  const 节点不能改 = p.能改节点 ? (p.pooled ? 不能改 : undefined) : 不能改;
  // 企业版：线索阶段还没有客户明确回复的沟通，推不过「线索验证」（服务端 lib/project/stage-gates.ts 同一条）
  const 没有效沟通 = p.企业版 && p.phase === "线索" && !p.result && p.有效沟通 === 0;
  const 卡有效沟通 = 没有效沟通 && !!下 && 节点序号(下, 字典) > 节点序号({ phase: "线索", node: 有效线索节点 }, 字典);
  // 企业版线索阶段不显示交付（QA #5）：只有订单阶段才有尾款、验收
  const 显示交付 = !p.企业版 || p.phase === "订单";
  // 线索在等复核：服务端这时不给改进程、点结局、放回公海（lib/project/lead-verify-guard.ts），界面直接灰着说清在等谁
  const 等复核文字 = p.线索验证?.待 === "市场复核" ? "等管理员复核" : p.线索验证?.待 === "总管理终判" ? "等管理员最终确认" : undefined;
  const 等复核 = !!等复核文字;
  // 「下一步」灰着的原因写在按钮下面（规则：灰按钮要写为什么），不靠悬停
  const 动不了 = (节点可改 ? undefined : 节点不能改 ?? "只有项目负责人、老板或主管能改") ?? 等复核文字;
  // 往前推另外的关：直属上级才推 / 需求状态补全期（p.不给推）、线索验证缺有效沟通
  const 往前不了 = p.不给推 ?? (卡有效沟通 ? 缺有效沟通 : undefined);
  // 配了必填、不是老板主管：缺着必填不给往前推；填齐了（占位值不算）照样能推（M-节点-05/09）
  const 缺必填 = p.必填?.只能靠填齐 && p.必填.还差.length ? `还差必填：${p.必填.还差.map(必填叫法).join("、")}；补齐再推，要先推请找老板或主管` : undefined;
  const 推不了 = 动不了 ?? 往前不了 ?? 缺必填
    ?? (下 ? undefined : p.result ? "先改回某个进程再往前推" : "这是最后一个进程了，接下来点结局");
  const 下一步字 = 下 ? `下一步：${下.phase === p.phase ? 下.node : `${下.phase}·${下.node}`}` : "下一步";

  const 跑 = async (f: () => Promise<{ ok: boolean; error?: string; 自动推到?: string[] }>, 成了?: string) => {
    set忙(true);
    try {
      const r = await f();
      if (!r.ok) message.error(r.error ?? "没改成，请稍后再试");
      else {
        if (成了) message.success(成了);
        // 企业版节点必填：这次保存把必填填齐了，项目自动往前推了几步
        if (r.自动推到?.length) message.success(`必填齐了，自动推进到 ${r.自动推到.join(" → ")}`);
        router.refresh();
      }
      return r.ok;
    } catch {
      message.error("没改成，请稍后再试");
      return false;
    } finally {
      set忙(false);
    }
  };

  /** 删项目上的一条沟通：企业版软删进回收站；提示条上给一次撤销（和客户页删跟进一样 6 秒） */
  const 删沟通 = async (id: string) => {
    set忙(true);
    let r: Awaited<ReturnType<typeof 删项目沟通>>;
    try {
      r = await 删项目沟通(p.id, id);
    } catch {
      r = { ok: false, error: "没删成，请稍后再试" };
    } finally {
      set忙(false);
    }
    if (!r.ok) return void message.error(r.error);
    router.refresh();
    const 快照 = r.快照;
    const key = `project-follow-${id}`;
    message.success({
      key,
      duration: 6,
      content: (
        <span>
          已删除，30 天内可在「设置 → 回收站」恢复
          <Button
            type="link"
            size="small"
            onClick={async () => {
              message.destroy(key);
              await 跑(() => 撤销删项目沟通(p.id, 快照), "这条沟通回来了");
            }}
          >
            撤销
          </Button>
        </span>
      ),
    });
  };

  /** 终止 = true：异常框 / 没成框 点确定走 终止项目进程（M-节点-04，审计写「终止进程」）；成了 = 改成了以后的提示 */
  const 改到 = (到: 位置, 附: { 终止?: boolean; 成了?: string } = {}) => {
    set终止中(!!附.终止);
    if (到.result === "异常状态") {
      set原因("");
      set类别(null);
      set异常框(到);
      return;
    }
    if (p.企业版 && 要写原因(到.result)) {
      set原因("");
      set无效原因(null);
      set没成框(到);
      return;
    }
    if (是交付(到.result) && 差.length) {
      message.warning(`还差${差.join("、")}，勾上才能点${交付叫法}`);
      return;
    }
    void 跑(() => 改项目节点(p.id, 到), 附.成了 ?? `已改到 ${位置文字(到, 字典)}`);
  };

  /** 结束类（结局）的去处要二次确认（10-30 P2）；异常、要写原因的本来就有自己的框，成功交付没勾齐的 改到 会直接提示 */
  const 结束确认 = (到: 位置) => {
    if (!到.result || 到.result === "异常状态" || (p.企业版 && 要写原因(到.result)) || (是交付(到.result) && 差.length)) return 改到(到);
    modal.confirm({
      title: `改到「${结局叫法(到.result, 字典)}」？`,
      content: 是交付(到.result) ? `项目算${交付叫法}、到此结束；以后要改可以把进程改回去` : "项目到此结束；以后要捡回来可以把进程改回去",
      okText: "确定",
      onOk: () => 改到(到),
    });
  };
  const 不能往前 = !!缺必填 || !!p.不给推 || 卡有效沟通;
  const 更多去处项 = 节点可改 && !等复核 ? 更多去处(当前, 去处们(当前, 不能往前, 字典), 字典) : [];

  /**
   * 企业版「完成节点」（M-节点-05/06/09）：一次往前一个节点；本阶段最后一个节点完成 = 进下一阶段第一个节点（线索→已转商机、商机→商机赢单，
   * 同一条记录，字段都在）；订单最后一个节点完成 = 交付结清。有结局的不给完成（先改回进程）
   */
  const 完成到: 位置 | null = p.result ? null : 下 ?? { phase: p.phase, node: p.node, result: 交付结局 };
  const 完成到字 = !完成到 ? "" : 完成到.result
    ? 交付叫法
    : 完成到.phase !== p.phase ? `${字典.出口们[p.phase as (typeof 阶段们)[number]]?.[0]?.叫法 ?? "进下一阶段"}，进到 ${完成到.phase}·${完成到.node}` : `下一节点：${完成到.node}`;
  /** 「完成节点」为什么点不了（缺必填不算：点了在框里列出来）；undefined = 能点 */
  const 完成不了 = 动不了 ?? (p.result ? "项目已经有结局，先改回某个进程" : 下 ? 往前不了 : undefined);
  const 完成 = () => {
    if (!完成到) return;
    if (完成到.result) return 结束确认(完成到);
    改到(完成到, { 成了: 完成到.phase !== p.phase ? `${完成到字}` : `已推进到 ${完成到.node}` });
  };
  /** 「终止进程」（M-节点-04）：按所在阶段落到 线索流失 / 丢单 / 异常状态；先确认，再到写原因 / 选类别的框 */
  const 终止到 = p.企业版 && !p.result ? 终止结局(当前, 字典) : null;
  const 开终止 = () => {
    if (!终止到) return;
    const 叫 = 结局叫法(终止到, 字典);
    modal.confirm({
      title: "终止进程？",
      content: 终止到 === "异常状态"
        ? `项目停在「${位.阶段}·${位.进程}」，标成「${叫}」；下一步选异常类别。处理好了把进程改回去就恢复`
        : `项目停在「${位.阶段}·${位.进程}」，落到「${叫}」、到此结束；下一步写原因。以后要捡回来可以把进程改回去`,
      okText: "继续",
      okButtonProps: { danger: true },
      onOk: () => 改到({ phase: p.phase, node: p.node, result: 终止到 }, { 终止: true }),
    });
  };

  /** 转让项目：点了先等 6 秒（提示条上能撤销），到点才真的换负责人；换了以后原来的下一步清掉，你可能就看不到这个项目了，回项目列表 */
  const 开始转给 = (新: string) => {
    const 名 = 候选.find((m) => m.id === 新)?.name ?? "TA";
    const key = `project-transfer-${p.id}`;
    set转给框(false);
    set待转给(新);
    转给计时.current = setTimeout(async () => {
      转给计时.current = null;
      message.destroy(key);
      const ok = await 跑(() => 编辑项目(p.id, { name: p.name, ownerId: 新, amount: p.amount, currency: p.currency, remark: p.remark ?? "", contactId: p.contact?.id ?? null }), `已转给 ${名}`);
      set待转给(null);
      if (ok) router.push("/projects");
    }, 6000);
    message.info({
      key,
      duration: 6,
      content: (
        <span>
          6 秒后转给 {名}
          <Button
            type="link"
            size="small"
            onClick={() => {
              if (转给计时.current) clearTimeout(转给计时.current);
              转给计时.current = null;
              set待转给(null);
              message.destroy(key);
              message.info("已撤销，没有转");
            }}
          >
            撤销
          </Button>
        </span>
      ),
    });
  };
  const 转给名 = 转给谁 ? (候选.find((m) => m.id === 转给谁)?.name ?? "TA") : null;

  // 线索流失（企业版、字典里有启用的无效原因）：选一个或写一句，至少一样；合成「无效原因：X」+ 补充说明记进节点变更
  const 选无效原因 = 没成框?.result === "线索流失" && p.原因选项.无效.length > 0;
  const 没成备注 = 选无效原因 && 无效原因 ? [`${无效原因前缀}${无效原因}`, 原因.trim()].filter(Boolean).join("\n") : 原因.trim();

  const 删 = async () => {
    set忙(true);
    try {
      const r = await 删除项目(p.id);
      if (!r.ok) message.error(r.error);
      else {
        message.success("已删除项目，沟通记录还留在客户下");
        router.push("/projects");
      }
    } finally {
      set忙(false);
    }
  };

  // 各张卡先摆成常量：企业版两栏、别的版本照原来一栏，摆法不同、卡是同一份
  /**
   * 企业版节点卡阶段页签那一行右边的一组控件（M-节点-04 / U-项目-06）：左边线框「完成节点」+ ▼（终止进程、改到别的进程或结局），
   * 右边实心「新增沟通」（开记沟通的框，只记沟通、不动节点）。有结局的项目左边换成「改回进程」。
   * 看的不是所在阶段、或推不了，按钮灰掉、悬停写原因（灰按钮收不到鼠标，提示挂在外面那层 span 上）
   */
  const 进程钮 = (不在当前: string | undefined) => {
    const 灰着 = (原因: string | undefined, 钮: ReactNode) => (原因 ? <Tooltip title={原因}><span className="proj-stage-tip">{钮}</span></Tooltip> : 钮);
    const 完成灰 = 不在当前 ?? 完成不了;
    const 菜单: NonNullable<MenuProps["items"]> = [
      ...(终止到 ? [{ key: "stop", danger: true, disabled: !!(不在当前 ?? 动不了), label: 两行("终止进程", 不在当前 ?? 动不了 ?? `落到「${结局叫法(终止到, 字典)}」`) }] : []),
      ...(更多去处项.length ? [{ key: "more", disabled: !!不在当前, label: 两行("改到别的进程或结局…") }] : []),
    ];
    return (
      <>
        {节点可改 && (p.result
          ? 灰着(不在当前 ?? 动不了, <Button disabled={忙 || !!(不在当前 ?? 动不了)} onClick={() => set头部框("推进")}>改回进程</Button>)
          : (
            <Space.Compact>
              {灰着(完成灰, <Button disabled={忙 || !!完成灰} onClick={() => set头部框("完成")}>完成节点</Button>)}
              {菜单.length > 0 && (
                <Dropdown trigger={["click"]} placement="bottomRight" disabled={忙} menu={{ items: 菜单, onClick: ({ key }) => (key === "stop" ? 开终止() : set头部框("推进")) }}>
                  <Button icon={<DownOutlined />} aria-label="终止进程或改到别的进程" />
                </Dropdown>
              )}
            </Space.Compact>
          ))}
        {p.能记沟通 && <Button type="primary" disabled={忙} onClick={() => set记一条开着("手填")}>新增沟通</Button>}
      </>
    );
  };

  const 位 = 阶段与进程(p, 字典);
  const 显示回收日 = p.企业版 && !!p.回收日 && !p.pooled && !p.result;
  const 节点卡 = (
    <Card style={p.企业版 ? undefined : { marginBottom: 16 }}>
      {/* 企业版（F-项目-19）：「阶段」「进程」两格和下面的阶段页签重复，不摆，只留回收日；别的版本照旧 */}
      {(!p.企业版 || 显示回收日) && <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between" }}>
        {/* P11：阶段（线索/商机/订单）和进程（节点）分两格摆，不拼成一串；成功交付、异常状态的阶段算订单 */}
        <div className="proj-where">
          {!p.企业版 && <><div>
            <div className="proj-where-label">阶段</div>
            <div className="proj-where-value">{位.阶段}</div>
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="proj-where-label">进程</div>
            <div className="proj-where-value">
              <span className="proj-where-node" title={位.进程}>{位.进程}</span>
              {位.结局 && <Tag style={{ marginLeft: 8 }} color={异常 ? "error" : 交付了 ? "success" : "default"}>{位.结局}</Tag>}
            </div>
          </div></>}
          {/* 企业版：哪天回公海写在阶段、进程旁边（10-30 P0-1），3 天内橙、当天红 */}
          {显示回收日 && p.回收日 && (() => {
            const 回 = 回公海文案(p.回收日);
            return (
              <div style={{ minWidth: 0 }}>
                <div className="proj-where-label">回收日</div>
                <div style={{ lineHeight: "28px", color: 回公海颜色[回.级别], fontWeight: 回.级别 === "常" ? undefined : 600 }}>{回.文字}</div>
              </div>
            );
          })()}
        </div>
        {/* 只留「下一步」一个主按钮（10-30 P0-8）；改到别的进程、点结局收进「更多」。灰着的原因写在按钮下面。
            企业版「推进进程」（框里就是这两个按钮）摆在下面阶段页签那一行，推不了的原因也跟到那里（10-31） */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, maxWidth: 320, marginLeft: "auto" }}>
          {!p.企业版 && <Space wrap>
            {更多去处项.length > 0 && (
              <Dropdown trigger={["click"]} placement="bottomRight" disabled={忙} menu={{ items: 更多去处项, onClick: ({ key }) => 结束确认(JSON.parse(key) as 位置) }}>
                <Button aria-label="改到别的进程或结局">更多 <DownOutlined /></Button>
              </Dropdown>
            )}
            <Button type="primary" disabled={忙 || !!推不了} onClick={() => 下 && 改到(下)}>
              {下一步字}
            </Button>
          </Space>}
          {推不了 && !p.企业版 && <div style={{ color: "var(--text-muted)", fontSize: "var(--dt-aux, 12px)", textAlign: "right" }}>{推不了}</div>}
        </div>
      </div>}
      {/* 企业版：三个阶段页签 + 完成节点 ▼ / 新增沟通（M-节点-04）；别的版本照旧一条进度条 */}
      {p.企业版 ? (
        <ProjectStages
          key={位.阶段}
          字典={字典}
          所在阶段={位.阶段}
          所在进程={位.进程}
          结局={位.结局}
          结局色={异常 ? "error" : 交付了 ? "success" : "default"}
          成功交付={交付了}
          动作={节点可改 || p.能记沟通 ? 进程钮 : undefined}
          提示={p.result && 节点可改 ? undefined : 完成不了}
        />
      ) : (
        <Progress
          style={{ marginTop: 12, marginBottom: 0 }}
          percent={Math.round(((交付了 ? 节点总数 : 节点序号(当前, 字典)) / 节点总数) * 100)}
          showInfo={false}
          status={异常 ? "exception" : 交付了 ? "success" : "active"}
          aria-label={`第 ${节点序号(当前, 字典) + 1} 个进程，共 ${节点总数} 个`}
        />
      )}
      {p.线索验证 && <LeadVerifyPanel projectId={p.id} v={p.线索验证} 无效原因选项={p.原因选项.无效} 跑={跑} 忙={忙} 没有效沟通={没有效沟通} 不给推={p.不给推} />}
      {没有效沟通 && !p.线索验证?.我能 && (
        <div style={{ marginTop: 12, color: "var(--text-muted)" }}>还没有客户明确回复的沟通：记一条、选「客户明确回复了」，才能推过线索验证</div>
      )}
      {p.必填 && (
        <div style={{ marginTop: 12, color: p.必填.还差.length ? "var(--text-muted)" : "var(--success-text)", overflowWrap: "anywhere" }}>
          {p.必填.还差.length
            ? `这个节点还差必填：${p.必填.还差.map(必填叫法).join("、")}（「暂无」「-」这类占位不算填了）`
            : "这个节点的必填都齐了，可以点「完成节点」往前推"}
        </div>
      )}
    </Card>
  );
  const 项目卡 = (
    <Card title="项目" extra={可改 && !p.企业版 && <Button type="link" size="small" disabled={忙} onClick={() => set编辑开着(true)}>编辑</Button>}>
      <div style={行样}><span style={键样}>{b.customer}</span>{p.customer ? <CustomerLink id={p.customer.id} name={p.customer.name} company={p.customer.school} /> : <span style={{ color: "var(--text-muted)" }}>领取后可见</span>}</div>
      {p.来源线索 && (
        <div style={行样}><span style={键样}>来源线索</span><span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{p.来源线索.name ?? <span style={{ color: "var(--text-muted)" }}>已删除的线索</span>}{p.来源线索.convertedAt && <span style={{ color: "var(--text-muted)" }}>（{p.来源线索.convertedAt} 转入）</span>}</span></div>
      )}
      {/* 联系人名字、职位可能很长：在 1024 宽的项目卡里折行，不顶出卡片 */}
      {p.contact && <div style={行样}><span style={键样}>联系人</span><span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{p.contact.name}{p.contact.position ? ` · ${p.contact.position}` : ""}</span></div>}
      {p.contact && p.联系人附件 && <div style={行样}><span style={键样}>附件</span><ContactAttachmentsButton key={附件版} contactId={p.contact.id} 名字={p.contact.name} 起始个数={p.联系人附件.个数} 只读={p.联系人附件.只读} /></div>}
      {p.企业版 && p.level !== undefined && (
        <div style={行样}><span style={键样}>级别</span>{级别格(p.level)}</div>
      )}
      <div style={行样}><span style={键样}>金额</span>{p.必填?.还差.includes("金额") ? 占位确认("金额") : 金额(p.amount, p.currency)}</div>
      {p.企业版 && p.成交钱 && (
        <>
          <div style={行样}><span style={键样}>定金金额</span>{p.成交钱.depositAmount !== null ? 金额(p.成交钱.depositAmount, p.成交钱.depositCurrency ?? 默认币种) : 待填("定金金额")}</div>
          <div style={行样}><span style={键样}>合同金额</span>{p.成交钱.contractAmount !== null ? 金额(p.成交钱.contractAmount, p.成交钱.contractCurrency ?? 默认币种) : 待填("合同金额")}</div>
          {p.项目新字段?.contractStatus && <div style={行样}><span style={键样}>合同状态</span><span>{p.项目新字段.contractStatus}</span></div>}
          {p.回款们 && <div style={行样}><span style={键样}>当前回款</span><span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{p.回款们.length ? 合计文字(按币种合计(p.回款们, (x) => x.amount, (x) => x.currency)) : <span style={{ color: "var(--text-muted)" }}>没有</span>}</span></div>}
          <div style={行样}><span style={键样}>需求描述</span><span style={{ minWidth: 0, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{p.成交钱.dealDemand ?? 待填("需求描述")}</span></div>
          {p.项目新字段 && "painPoints" in p.项目新字段 && (
            <div style={行样}><span style={键样}>痛点标注</span><span style={{ minWidth: 0, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{p.项目新字段.painPoints ?? (p.必填?.还差.includes("痛点标注") ? 占位确认("痛点标注") : 待填("痛点标注"))}</span></div>
          )}
        </>
      )}
      {p.企业版 && <div style={行样}><span style={键样}>预计成交</span>{p.expectedDealAt ?? (p.必填?.还差.includes("预计成交日期") ? 占位确认("预计成交日期") : 待填("预计成交日期", "选择"))}</div>}
      {p.企业版 && p.已立项天数 !== undefined && <div style={行样}><span style={键样}>已立项</span>{p.已立项天数 === 0 ? "今天立项" : `${p.已立项天数} 天`}</div>}
      {p.企业版 && p.项目来源 !== undefined && (
        <div style={行样}><span style={键样}>项目来源</span><span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{p.项目来源 ? <>{p.项目来源.name}{p.项目来源.跟客户 && <span style={{ color: "var(--text-muted)" }}>（同{b.customer}来源）</span>}</> : 待填("项目来源", "选择")}</span></div>
      )}
      {p.企业版 && p.所在地 && (
        <>
          <div style={行样}><span style={键样}>区域</span>{项目区域(p.所在地) || 待填("区域", "选择")}</div>
          {(拼地址(p.所在地) || p.所在地.location) && (
            <div style={行样}><span style={键样}>地址</span><span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{[拼地址(p.所在地), p.所在地.location].filter(Boolean).join(" ")}</span></div>
          )}
        </>
      )}
      {/* 在公海里时 ownerName 是原负责人：不写成「负责人 X」，也不把系统收回说成 X 放回的（QA #14） */}
      <div style={行样}><span style={键样}>负责人</span>{p.pooled ? <span>在公海里<span style={{ color: "var(--text-muted)" }}>（原负责人 {p.ownerName}{进公海说法(p.进公海, p.ownerName)}）</span></span> : p.ownerName}</div>
      {p.historyOwners.length > 0 && (
        <div style={行样}><span style={键样}>历史</span><span style={{ minWidth: 0, overflowWrap: "anywhere" }} title="历史负责人：把这个项目放回过公海的人">{p.historyOwners.join("、")}</span></div>
      )}
      {(p.nextStepText || p.nextStepAt) && !p.pooled && (
        <div style={行样}>
          <span style={键样}>下一步</span>
          <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
            {p.nextStepText}
            {p.nextStepText && p.nextStepAt && <span style={{ color: "var(--text-muted)" }}> · </span>}
            {p.nextStepAt && <span style={p.nextStepText ? { color: "var(--text-muted)", whiteSpace: "nowrap" } : undefined}>{p.nextStepAt}</span>}
          </span>
        </div>
      )}
      {p.remark && <div style={{ marginTop: 8, whiteSpace: "pre-wrap", color: "var(--text-muted)" }}>{p.remark}</div>}
    </Card>
  );
  const 交付卡 = 显示交付 && (
    <Card title="交付">
      {(["balanceSettled", "acceptancePassed"] as const).map((k) => {
        const 勾了 = p[k];
        const 谁 = k === "balanceSettled" ? p.balanceSettledBy : p.acceptancePassedBy;
        const 何时 = k === "balanceSettled" ? p.balanceSettledAt : p.acceptancePassedAt;
        return (
          <div key={k} style={{ marginBottom: 8 }}>
            <Checkbox
              checked={勾了}
              disabled={!可改 || 忙 || (勾了 && 交付了)}
              title={不能改 ?? (勾了 && 交付了 ? `已经${交付叫法}了；要取消先把进程改回去` : undefined)}
              onChange={(e) => void 跑(() => 勾项目交付(p.id, k, e.target.checked))}
            >
              {k === "balanceSettled" ? "尾款结清" : "验收通过"}
            </Checkbox>
            {勾了 && 谁 && <span style={{ color: "var(--text-muted)", marginLeft: 4 }}>{谁} · {fmtDateTime(何时)}</span>}
          </div>
        );
      })}
      <div style={{ color: "var(--text-muted)", marginTop: 4 }}>
        {交付了 ? `已经${交付叫法}` : 差.length ? `两项都勾上才能点${交付叫法}（还差${差.join("、")}）` : `两项都勾上了，可以点${交付叫法}`}
      </div>
      {!交付了 && (
        <Button
          style={{ marginTop: 8 }}
          disabled={!可改 || 忙 || 差.length > 0}
          title={不能改 ?? (差.length ? `还差${差.join("、")}` : undefined)}
          onClick={() => 结束确认({ phase: "订单", node: p.phase === "订单" ? p.node : 字典.节点们.订单[字典.节点们.订单.length - 1], result: 交付结局 })}
        >
          {交付叫法}
        </Button>
      )}
    </Card>
  );
  const 项目组卡 = <ProjectTeamCard projectId={p.id} 组员们={p.members} 角色们={角色们} 在职={在职} 能改={可改} 忙={忙} 跑={跑} 企业版={p.企业版} 组长={p.ownerName} />;
  const 提成区 = p.提成 && <ProjectCommissionCard key={`${p.提成.项目底价}-${p.提成.实际?.固定于 ?? ""}`} projectId={p.id} t={p.提成} 忙={忙} 跑={跑} 不摆改={p.企业版} />;
  const 变更卡 = (
    <Card title="进程变更">
      <Timeline
        items={p.logs.map((l) => ({
          color: l.kind !== "node" ? "gray" : l.to.result === "异常状态" ? "red" : 是交付(l.to.result) ? "green" : "blue",
          content: (
            <div>
              <div>{l.kind !== "node" ? 换人文字(l) : l.from ? `${位置文字(l.from, 字典)} → ${位置文字(l.to, 字典)}` : `建档，落在 ${位置文字(l.to, 字典)}`}</div>
              {l.category && <div style={{ color: "var(--danger-text)" }}>异常类别：{l.category}</div>}
              {l.kind === "node" && l.reason && l.reason !== 超时理由 && <div style={{ color: "var(--danger-text)", whiteSpace: "pre-wrap" }}>{l.category ? "备注" : "原因"}：{l.reason}</div>}
              {/* 换人那几行：企业版记的回收原因 / 分配方式（10-27）原样淡色显示；超时、停用上一行已经说了 */}
              {l.kind !== "node" && l.reason && l.reason !== 超时理由 && (l.放回方式 ?? "手动") === "手动" && <div style={{ color: "var(--text-muted)", whiteSpace: "pre-wrap" }}>{l.reason}</div>}
              <div style={{ color: "var(--text-muted)", fontSize: "var(--dt-aux, 12px)" }}>{l.reason === 超时理由 ? "系统" : l.who} · {fmtDateTime(l.at)}</div>
            </div>
          ),
        }))}
      />
    </Card>
  );
  const 沟通卡 = (
    <Card
      // 客户页「跟进」菜单跳过来的落点（/projects/<id>#project-follow，P14 第 3 条）
      id="project-follow"
      title="沟通"
      extra={
        p.能记沟通 ? (
          // 企业版：「记一条沟通」「AI 录入」在页头（10-31 起卡上不再重复摆）
          p.企业版 ? null : <Button type="link" size="small" disabled={忙} onClick={() => set记一条开着("手填")}>记一条</Button>
        ) : p.customer && <Link href={`/customers/${p.customer.id}`}>去{b.customer}页{p.企业版 ? "看看" : "记一条"}</Link>
      }
    >
      {p.followUps.length === 0 && <div style={{ color: "var(--text-muted)" }}>{p.customer ? "还没有挂在这个项目上的沟通" : "领取后可见"}</div>}
      {p.followUps.map((f) => (
        <div key={f.id} style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <FollowTypeCell type={f.type} method={f.method} />
            <Tag>{f.node}</Tag>
            {f.提醒 && <Tag color={提醒色[f.提醒.级别]}>{f.提醒.文字}</Tag>}
            <span style={{ color: "var(--text-muted)", fontSize: "var(--dt-aux, 12px)" }}>{f.who} · {fmtDateTime(f.occurredAt)}</span>
            {(p.可改沟通 || 卡点?.能发) && (
              // 「…」放在这一行最右：发卡点、修改、删除（10-30 发卡点从行上收进来）；删除就地问一句（components/InlineConfirm.tsx），删了进回收站、提示条上还给一次撤销
              <span style={{ marginLeft: "auto" }}>
                <InlineConfirm 问="删了进回收站，30 天内可恢复" 开={删问于 === f.id} set开={(v) => set删问于(v ? f.id : null)} 做={() => 删沟通(f.id)}>
                  <Dropdown
                    trigger={["click"]}
                    placement="bottomRight"
                    disabled={忙}
                    menu={{
                      items: [
                        ...(卡点?.能发 ? [{ key: "blocker", label: "发卡点" }] : []),
                        ...(p.可改沟通 ? [{ key: "edit", label: "修改" }, { key: "delete", label: "删除", danger: true }] : []),
                      ],
                      onClick: ({ key }) => (key === "blocker" ? set发卡点于(f.id) : key === "edit" ? set改沟通于(f) : set删问于(f.id)),
                    }}
                  >
                    <Button type="text" size="small" icon={<MoreOutlined />} aria-label="这条沟通的更多操作" />
                  </Dropdown>
                </InlineConfirm>
              </span>
            )}
          </div>
          <div style={{ whiteSpace: "pre-wrap", marginTop: 4, overflowWrap: "anywhere" }}>{f.content}</div>
        </div>
      ))}
    </Card>
  );
  const 卡点区 = 卡点 && (
    <Card
      title={`卡点（${卡点.们.length}）`}
      // 发卡点挂在最近一条沟通上（沟通行的「…」里也能挑别的那条）
      extra={卡点.能发 && !p.企业版 && (
        <Space size={8}>
          {!p.followUps.length && <span style={{ color: "var(--text-muted)", fontSize: "var(--dt-aux, 12px)" }}>先记一条沟通</span>}
          <Button type="primary" size="small" disabled={!p.followUps.length} onClick={() => p.followUps[0] && set发卡点于(p.followUps[0].id)}>发卡点</Button>
        </Space>
      )}
    >
      <BlockerList 们={卡点.们} 人们={卡点.人们} 空="还没有卡点" />
    </Card>
  );

  const 画像卡 = p.画像 && <ProjectProfileCard projectId={p.id} 画像={p.画像} 能改={可改} />;
  const 关联卡 = p.关联 && <ProjectRelate projectId={p.id} 关联={p.关联} 能改={可改} />;
  // 合同附件、项目方案各单独一格（10-31）：节点必填「合同附件」「项目方案」各看自己那一格；没分格的老附件算在「附件」里
  const 附件卡 = p.项目附件 && (
    <>
      <ProjectAttachmentsCard key={`${p.id}-合同-${附件版}`} projectId={p.id} 分类="合同" 标题="合同附件" 起始个数={p.项目附件.合同} 只读={p.项目附件.只读} />
      <ProjectAttachmentsCard key={`${p.id}-方案-${附件版}`} projectId={p.id} 分类="方案" 标题="项目方案" 起始个数={p.项目附件.方案} 只读={p.项目附件.只读} />
      <ProjectAttachmentsCard key={`${p.id}-其它-${附件版}`} projectId={p.id} 分类="其它" 标题="附件" 起始个数={p.项目附件.其它} 只读={p.项目附件.只读} />
    </>
  );
  const 回款卡 = p.回款们 && <ProjectPaymentsCard key={p.id} projectId={p.id} 回款们={p.回款们} 能改={可改} 默认={p.成交钱?.contractCurrency ?? p.currency} />;

  const 领取钮 = (
    <>
      {p.能领取 && <Button type="primary" disabled={忙} onClick={() => void 跑(() => 领取项目(p.id), "已领取，你是这个项目的负责人了")}>领取</Button>}
      {/* 企业版原负责人：按钮摆着、灰着，悬停说为什么（接口也拦，lib/project/db.ts 领取公海项目） */}
      {!p.能领取 && p.领取不给 && <Tooltip title={p.领取不给}><Button type="primary" disabled>领取</Button></Tooltip>}
    </>
  );
  // 企业版换负责人单独一个按钮（10-30），弹窗说清转了会怎样，点了 6 秒内能撤销
  const 转给钮 = p.企业版 && 可改 && !独自一人(候选, p.ownerId) && (
    <Button disabled={忙 || !!待转给} onClick={() => { set转给谁(null); set转给框(true); }}>转让项目</Button>
  );
  const 放回问 = () => {
    // 企业版：放回前可选一个「回收原因」（字典，不选也行）；别的版本照旧一个确认
    if (p.企业版) { set回收原因(null); set放回框(true); return; }
    modal.confirm({ title: "放回项目公海？", content: "放回去以后谁都能领，你自己不能再领回来", okText: "放回公海", onOk: () => 跑(() => 放回项目公海(p.id), "已放回项目公海") });
  };
  const 删问 = () => modal.confirm({ title: "删除这个项目？", content: 删除说明(p.删前清点, b.customer, p.企业版), okText: "删除", okButtonProps: { danger: true }, onOk: 删 });
  const 开框 = (k: 头部框) => () => set头部框(k);
  const 能管沟通 = p.followUps.length > 0 && (p.可改沟通 || !!卡点?.能发);

  // 企业版页头（10-31 R6）：这一页能做的事摆成具名按钮，要填的进弹窗，同一个动作、同一套校验。
  // 卡上和这里同名的按钮（编辑、记一条沟通、AI 录入、下一步 / 更多、发卡点、关联 +、改分配）企业版不再摆，只留页头这一处（10-31）；
  // 推进进程、结束当前进程在节点卡的阶段页签那一行（ProjectStages 动作），页头不再重复摆。
  // 按钮按下面两栏分组、各自对齐那一栏的左边（10-31 用户定）：左组管左栏（节点、沟通、卡点、附件），右组管右栏（项目、画像、关联、项目组、提成）；
  // 整个项目的事（转让、放回公海、删除）跟在左组最后、靠右。
  // 「记一条沟通」是唯一的主按钮，⌘N 点的就是它（components/CommandBar.tsx 找 .page-head-a 里的主按钮）；公海里的项目主按钮是「领取」
  const 整项目钮 = (转给钮 || p.能放公海 || 能改) && (
    <span className="acts-whole">
      {转给钮}
      {p.能放公海 && (等复核
        ? <Tooltip title={`${等复核文字}，暂时不能放回`}><Button disabled>放回公海</Button></Tooltip>
        : <Button disabled={忙} onClick={放回问}>放回公海</Button>)}
      {能改 && <Button type="text" danger disabled={忙} onClick={删问}>删除项目</Button>}
    </span>
  );
  const 企业版动作 = (
    <div className="page-head-a proj-acts">
      <div className="acts-g">
        {领取钮}
        {p.能记沟通 && <Button type={p.能领取 ? "default" : "primary"} disabled={忙} onClick={() => set记一条开着("手填")}>记一条沟通</Button>}
        {p.能记沟通 && p.aiEnabled && p.customer && <Button icon={<ThunderboltOutlined />} disabled={忙} onClick={() => set记一条开着("AI")}>AI 录入</Button>}
        {p.线索验证?.我能 && <Button disabled={忙} onClick={开框("线索判定")}>线索判定</Button>}
        {卡点?.能发 && (p.followUps.length
          ? <Button disabled={忙} onClick={() => set发卡点于(p.followUps[0].id)}>发卡点</Button>
          : <Tooltip title="先记一条沟通"><Button disabled>发卡点</Button></Tooltip>)}
        {能管沟通 && <Button disabled={忙} onClick={开框("管理沟通")}>管理沟通</Button>}
        {/* 附件框里能传、能看、能删（看各格自己的权限），项目组框里能邀请、能改角色、能移出：一个框管到底 */}
        {p.项目附件 && <Button disabled={忙} onClick={开框("附件")}>{p.项目附件.只读 ? "附件" : "上传附件"}</Button>}
        {整项目钮}
      </div>
      <div className="acts-g">
        {可改 && <Button disabled={忙} onClick={() => set编辑开着(true)}>编辑项目</Button>}
        {p.画像 && 可改 && <Button disabled={忙} onClick={开框("画像")}>项目画像</Button>}
        {p.关联 && 可改 && (
          <>
            <Button disabled={忙} onClick={开框("关联客户")}>关联客户</Button>
            <Button disabled={忙} onClick={开框("关联联系人")}>关联联系人</Button>
            <Button disabled={忙} onClick={开框("管理关联")}>管理关联</Button>
          </>
        )}
        {可改 && <Button disabled={忙} onClick={开框("成员")}>邀请成员</Button>}
        {p.提成?.能改 && <Button disabled={忙} onClick={开框("改分配")}>改分配</Button>}
      </div>
    </div>
  );

  const 页头 = (
    <PageHead
      title={p.name}
      subtitle={`${p.pooled ? `在项目公海里 · 原负责人 ${p.ownerName}` : `负责人 ${p.ownerName}`} · ${p.creatorName} 建于 ${fmtDateTime(p.createdAt)}`}
      extra={p.企业版 ? undefined : (
        <Space wrap>
          {领取钮}
          {转给钮}
          {/* 放回公海、删除项目少用、后果重：收进「更多」（10-30） */}
          {(p.能放公海 || 能改) && (
            <Dropdown
              trigger={["click"]}
              placement="bottomRight"
              disabled={忙}
              menu={{
                items: [
                  ...(p.能放公海 ? [{ key: "pool", disabled: 等复核, label: 两行("放回公海", 等复核 ? `${等复核文字}，暂时不能放回` : undefined) }] : []),
                  ...(能改 ? [{ key: "delete", danger: true, label: "删除项目" }] : []),
                ],
                onClick: ({ key }) => (key === "pool" ? 放回问() : 删问()),
              }}
            >
              <Button icon={<MoreOutlined />} aria-label="项目的更多操作">更多</Button>
            </Dropdown>
          )}
        </Space>
      )}
    />
  );

  const 关头部框 = () => {
    if (头部框 === "附件") set附件版((v) => v + 1);
    set头部框(null);
  };
  /** 框里点了要换到别的框（推进 → 结局确认、管理沟通 → 修改）：先关这个，焦点回到页头 */
  const 换框 = (f: () => void) => () => { set头部框(null); f(); };
  const 头部框内容 = (() => {
    switch (头部框) {
      case "推进":
        return (
          <div className="proj-modal-sec">
            <div><span className="proj-where-label">现在在</span> {位.阶段} · {位.进程}{位.结局 ? ` · ${位.结局}` : ""}</div>
            <div>
              <Button type="primary" disabled={忙 || !!推不了} onClick={换框(() => 下 && 改到(下))}>{下一步字}</Button>
              {推不了 && <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: "var(--dt-aux, 12px)" }}>{推不了}</div>}
            </div>
            {更多去处项.length > 0 && (
              <div>
                <div className="proj-where-label">改到别的进程或结局</div>
                <Menu className="proj-modal-menu" selectable={false} items={更多去处项} onClick={({ key }) => { set头部框(null); 结束确认(JSON.parse(key) as 位置); }} />
              </div>
            )}
          </div>
        );
      case "完成": {
        // M-节点-05/09：先查这个节点的必填（占位值不算填了）；缺了列出来，齐了写能推到哪。老板、主管缺着也能「仍要推进」
        const 缺 = p.必填?.还差 ?? [];
        const 能推 = !!完成到 && !完成不了 && !(缺.length && p.必填?.只能靠填齐);
        return (
          <div className="proj-modal-sec">
            <div><span className="proj-where-label">现在在</span> {位.阶段} · {位.进程}</div>
            {缺.length ? (
              <Alert
                type="warning"
                showIcon
                message={p.必填?.只能靠填齐 ? "还差这些必填，补齐了才能完成这个节点" : "还差这些必填（你是老板 / 主管，可以先推）"}
                description={<ul className="proj-miss-list">{缺.map((k) => <li key={k}>{必填叫法(k)}</li>)}</ul>}
              />
            ) : (
              <Alert type="success" showIcon message={p.必填 ? "这个节点的必填都齐了，可以推进" : "这个节点没有配必填，可以推进"} />
            )}
            {完成不了 && <div style={{ color: "var(--text-muted)" }}>{完成不了}</div>}
            {完成到 && <div><span className="proj-where-label">完成后</span> {完成到字}</div>}
            <Space wrap>
              {能推 && <Button type="primary" disabled={忙} onClick={换框(完成)}>{缺.length ? "仍要推进" : "确认推进"}</Button>}
              <Button onClick={关头部框}>{缺.length && !能推 ? "去补齐" : "取消"}</Button>
            </Space>
          </div>
        );
      }
      case "线索判定":
        return p.线索验证 && <LeadVerifyPanel projectId={p.id} v={p.线索验证} 无效原因选项={p.原因选项.无效} 跑={跑} 忙={忙} 没有效沟通={没有效沟通} 不给推={p.不给推} />;
      case "画像":
        return <div className="proj-modal-cards">{画像卡}</div>;
      case "关联客户":
      case "关联联系人":
        return p.关联 && <div className="proj-modal-cards"><ProjectRelate projectId={p.id} 关联={p.关联} 能改={可改} 只={头部框 === "关联客户" ? "客户" : "联系人"} 起手 /></div>;
      case "管理关联":
        return <div className="proj-modal-cards">{关联卡}</div>;
      case "附件":
        return (
          <div className="proj-modal-cards">
            {附件卡}
            {p.contact && p.联系人附件 && (
              <div style={行样}><span style={键样}>联系人附件</span><span>{p.contact.name}：<ContactAttachmentsButton contactId={p.contact.id} 名字={p.contact.name} 起始个数={p.联系人附件.个数} 只读={p.联系人附件.只读} /></span></div>
            )}
          </div>
        );
      case "成员":
        return <div className="proj-modal-cards">{项目组卡}</div>;
      case "管理沟通":
        return (
          <div className="proj-modal-list">
            {p.followUps.map((f) => (
              <div key={f.id} className="proj-modal-row">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <FollowTypeCell type={f.type} method={f.method} />
                    <Tag>{f.node}</Tag>
                    <span style={{ color: "var(--text-muted)", fontSize: "var(--dt-aux, 12px)" }}>{f.who} · {fmtDateTime(f.occurredAt)}</span>
                  </div>
                  <div className="proj-modal-clip">{f.content}</div>
                </div>
                <Space size={4}>
                  {卡点?.能发 && <Button size="small" disabled={忙} onClick={换框(() => set发卡点于(f.id))}>发卡点</Button>}
                  {p.可改沟通 && <Button size="small" disabled={忙} onClick={换框(() => set改沟通于(f))}>修改</Button>}
                  {p.可改沟通 && (
                    <InlineConfirm 问="删了进回收站，30 天内可恢复" 做={() => 删沟通(f.id)}>
                      <Button size="small" type="text" danger disabled={忙}>删除</Button>
                    </InlineConfirm>
                  )}
                </Space>
              </div>
            ))}
          </div>
        );
      default:
        return null;
    }
  })();

  const 正文 = (
    <div className={p.企业版 ? "proj-wrap" : undefined} style={{ maxWidth: p.企业版 ? 1200 : 960 }}>
      {p.企业版 ? (
        /* 企业版（P11）：项目名单在中栏（@pane/projects/[id]，components/ProjectRoster.tsx）。
           它收起或收成抽屉时，标题最左边补一颗侧栏图标把它叫回来，和客户详情页同一颗（components/PaneToggle.tsx） */
        <div className="proj-head">
          <PaneToggle 栏="roster" 位置="主区" 名="项目列表" />
          {页头}
        </div>
      ) : (
        页头
      )}
      {/* 企业版的按钮不放标题右边，单独一行摆在标题下面、按下面两栏对齐（10-31） */}
      {p.企业版 && 企业版动作}

      {p.pooled && (
        <Alert type="info" showIcon style={{ marginBottom: 16 }} title="这个项目在项目公海里" description={p.能领取 ? "领取了你就是负责人，可以接着推进程" : p.领取不给 === 项目不能单独领提示 ? 项目不能单独领提示 : p.领取不给 ? `你是原负责人，${p.领取不给}，等同事领取` : "是你放回去的，等同事领取"} />
      )}

      {异常 && (
        <Alert
          type="error" showIcon style={{ marginBottom: 16 }}
          title={`这个项目在异常状态${p.exceptionCategory ? `：${p.exceptionCategory}` : ""}`}
          description={p.exceptionReason ? <span style={{ whiteSpace: "pre-wrap" }}>{p.exceptionReason}</span> : undefined}
        />
      )}

      {p.企业版 ? (
        <>
          {/* 企业版两栏（10-27 会后排版）：左边干活——节点、沟通、卡点；右边看资料——项目、交付、项目组、提成、节点变更。
              容器窄了（有 AI 侧栏、窗口小）退成一栏，干活的在上（globals.css .proj-2col） */}
          <div className="proj-2col">
            <div className="proj-main">
              {节点卡}
              {沟通卡}
              {卡点区}
              {回款卡}
              {附件卡}
            </div>
            <aside className="proj-side" aria-label="项目资料">
              {项目卡}
              {画像卡}
              {/* 卡上不摆「关联」，页头有；「管理关联」框里的照旧能加 */}
              {p.关联 && <ProjectRelate projectId={p.id} 关联={p.关联} 能改={可改} 不摆加 />}
              {交付卡}
              {项目组卡}
              {提成区}
              {变更卡}
            </aside>
          </div>
        </>
      ) : (
        <>
          {节点卡}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 16 }}>
            {项目卡}
            {交付卡}
          </div>

          <div style={{ marginBottom: 16 }}>{项目组卡}</div>

          {提成区 && <div style={{ marginBottom: 16 }}>{提成区}</div>}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
            {变更卡}
            {沟通卡}
            {卡点区}
          </div>
        </>
      )}

      {可改 && 编辑开着 && (
        <ProjectEditModal
          open
          onClose={() => set编辑开着(false)}
          跑={跑}
          p={{ id: p.id, name: p.name, ownerId: p.ownerId, amount: p.amount, currency: p.currency, remark: p.remark, contactId: p.contact?.id ?? null, ...(p.企业版 ? { expectedDealAt: p.expectedDealAt ?? null, channelId: p.channelId ?? null, level: p.level ?? null, 所在地: p.所在地 ?? null, ...(p.成交钱 ? { 成交钱: p.成交钱 } : {}), ...(p.项目新字段 ? { 项目新字段: p.项目新字段 } : {}) } : {}) }}
          候选={候选}
          联系人们={联系人们}
          渠道们={p.企业版 ? p.渠道们 : undefined}
          改负责人={!p.企业版}
        />
      )}

      {卡点?.能发 && 发卡点于 && <PublishBlockerModal followUpId={发卡点于} 默认={卡点.默认} 人们={卡点.人们} onClose={() => set发卡点于(null)} />}

      {p.可改沟通 && 改沟通于 && <EditFollowModal projectId={p.id} f={改沟通于} 外贸={外贸精简(b)} onClose={() => set改沟通于(null)} 跑={跑} />}

      {头部框 && 头部框 !== "改分配" && (
        <Modal open title={`${头部框叫法[头部框]} · ${p.name}`} footer={null} width={头部框 === "推进" || 头部框 === "完成" || 头部框 === "线索判定" ? 520 : 640} onCancel={关头部框}>
          {头部框内容}
        </Modal>
      )}
      {头部框 === "改分配" && p.提成 && <SplitModal projectId={p.id} t={p.提成} 跑={跑} onClose={关头部框} />}

      {p.能记沟通 && 记一条开着 && <RecordFollowModal p={p} 外贸={外贸精简(b)} AI先={记一条开着 === "AI"} onClose={() => set记一条开着(false)} 跑={跑} />}

      <Modal
        open={!!异常框}
        title={终止中 ? "终止进程：进异常状态" : "进异常状态"}
        okText="确定"
        okButtonProps={{ danger: true, disabled: !类别, loading: 忙 }}
        onCancel={() => set异常框(null)}
        onOk={async () => {
          if (!异常框 || !类别) return;
          const 附 = { categoryId: 类别, 备注: 原因 };
          const ok = await 跑(() => (终止中 ? 终止项目进程(p.id, 附) : 改项目节点(p.id, 异常框, 附)), 终止中 ? "已终止进程，标成异常状态" : "已标成异常状态");
          if (ok) set异常框(null);
        }}
      >
        <div style={{ marginBottom: 8, color: "var(--text-muted)" }}>选一个异常类别，看板上这张卡会标红；处理好了把进程改回去就算恢复，类别和备注留在进程变更里。</div>
        <Select
          style={{ width: "100%", marginBottom: 12 }}
          placeholder={类别们.length ? "选异常类别" : "没有在用的异常类别，请老板在设置里加"}
          value={类别}
          onChange={(v: string) => set类别(v)}
          options={类别们.map((c) => ({ value: c.id, label: c.name }))}
          aria-label="异常类别"
        />
        <Input.TextArea rows={4} maxLength={原因上限} showCount value={原因} onChange={(e) => set原因(e.target.value)} placeholder="备注（可不写）" />
      </Modal>

      <Modal
        open={!!没成框}
        title={没成框 ? `${终止中 ? "终止进程" : "定结果"}：${结局叫法(没成框.result ?? "", 字典)}` : ""}
        okText="确定"
        okButtonProps={{ danger: true, disabled: !没成备注 || !!其他没写好(无效原因), loading: 忙 }}
        onCancel={() => set没成框(null)}
        onOk={async () => {
          if (!没成框 || !没成备注 || 其他没写好(无效原因)) return;
          const ok = await 跑(
            () => (终止中 ? 终止项目进程(p.id, { 备注: 没成备注 }) : 改项目节点(p.id, 没成框, { 备注: 没成备注 })),
            终止中 ? `已终止进程：${结局叫法(没成框.result ?? "", 字典)}` : `已改到 ${位置文字(没成框, 字典)}`,
          );
          if (ok) set没成框(null);
        }}
      >
        <div style={{ marginBottom: 8, color: "var(--text-muted)" }}>{选无效原因 ? "选一个无效原因，或写一句为什么没成（至少一样），会记在进程变更里；以后捡回来把进程改回去就行。" : "写一句为什么没成，会记在进程变更里；以后捡回来把进程改回去就行。"}</div>
        {选无效原因 && (
          <DictSelect style={{ width: "100%", marginBottom: 8 }} placeholder="无效原因" aria-label="无效原因" value={无效原因} onChange={set无效原因} options={p.原因选项.无效} />
        )}
        <Input.TextArea rows={4} maxLength={原因上限 - (无效原因 ? 无效原因.length + 无效原因前缀.length + 1 : 0)} showCount value={原因} onChange={(e) => set原因(e.target.value)} placeholder={选无效原因 ? "补充说明" : "原因（必填）"} aria-label="原因" />
      </Modal>

      <Modal
        open={放回框}
        title="放回项目公海？"
        okText="放回公海"
        okButtonProps={{ loading: 忙, disabled: !!其他没写好(回收原因) }}
        onCancel={() => set放回框(false)}
        onOk={async () => {
          const ok = await 跑(() => 放回项目公海(p.id, 回收原因), "已放回项目公海");
          if (ok) set放回框(false);
        }}
      >
        <div style={{ marginBottom: 8, color: "var(--text-muted)" }}>放回去以后同事都能领，你作为原负责人不能再领回来；你会记成这个项目的历史负责人。</div>
        <DictSelect style={{ width: "100%" }} placeholder="回收原因（可不选）" aria-label="回收原因" value={回收原因} onChange={set回收原因} options={p.原因选项.回收} />
      </Modal>

      <Modal
        open={转给框}
        title="转让项目"
        okText="转让"
        okButtonProps={{ disabled: !转给谁 }}
        onCancel={() => set转给框(false)}
        onOk={() => 转给谁 && 开始转给(转给谁)}
      >
        <Select
          showSearch
          optionFilterProp="label"
          style={{ width: "100%", marginBottom: 8 }}
          placeholder="选接手的人"
          aria-label="转给谁"
          value={转给谁}
          onChange={(v: string) => set转给谁(v)}
          options={成员选项(候选).filter((o) => o.value !== p.ownerId)}
        />
        <div style={{ color: "var(--text-muted)" }}>
          {转给名 ? `转给 ${转给名} 以后，你看不到这个项目；6 秒内可撤销。原来填的下一步会清掉，由 ${转给名} 重新安排。` : "选好人以后，6 秒内可撤销。"}
        </div>
      </Modal>
    </div>
  );
  return 正文;
}

/**
 * 改项目上的一条沟通（「…」→ 修改，10-29）：沟通方式、时间、内容三格，别的（阶段、明确回复、下一步）不在这里改。
 * 打开时的 updatedAt 一起交回去，别人先改了就报版本冲突，不悄悄盖掉
 */
function EditFollowModal({ projectId, f, 外贸, onClose, 跑 }: {
  projectId: string;
  f: 项目详情["followUps"][number];
  外贸: boolean;
  onClose: () => void;
  跑: (f: () => Promise<{ ok: boolean; error?: string }>, 成了?: string) => Promise<boolean>;
}) {
  const 能选类型 = 跟进类型们(外贸).filter((t) => t.value !== "TASK" && t.value !== "REMIND");
  // 老数据可能是待办 / 提醒类型：下拉里补上它自己，不改类型就原样存回
  const 类型们 = 能选类型.some((t) => t.value === f.type) ? 能选类型 : [...能选类型, ...跟进类型们(外贸).filter((t) => t.value === f.type)];
  const [type, setType] = useState(f.type);
  const [method, setMethod] = useState<string | null>(f.method ?? null);
  const [occurredAt, setOccurredAt] = useState(() => dayjs(f.occurredAt).format(沟通时间格式));
  const [content, setContent] = useState(f.content);
  const [交中, set交中] = useState(false);
  const 差 = !content.trim() ? "请填写这次沟通的内容" : "";
  const 交 = async () => {
    set交中(true);
    const ok = await 跑(() => 改项目沟通(projectId, f.id, { type, method: 对得上的方式(type, method), content, occurredAt, 版本: f.版本 }), "已保存修改");
    set交中(false);
    if (ok) onClose();
  };
  return (
    <Modal open title="修改这条沟通" okText="保存" mask={{ closable: false }} okButtonProps={{ disabled: !!差, loading: 交中, title: 差 || undefined }} onCancel={onClose} onOk={() => void 交()}>
      <div style={{ display: "grid", gap: 12 }}>
        <FollowMethodSelect aria-label="沟通方式" type={type} method={method} 类型们={类型们} onChange={(v) => { setType(v.type); setMethod(v.method); }} />
        <DatePicker
          aria-label="沟通时间"
          showTime={{ format: "HH:mm" }}
          format={沟通时间格式}
          allowClear={false}
          style={{ width: "100%" }}
          value={dayjs(occurredAt, 沟通时间格式)}
          disabledDate={(x) => x.isAfter(dayjs(), "day")}
          onChange={(v) => v && setOccurredAt(v.format(沟通时间格式))}
        />
        <Input.TextArea aria-label="沟通内容" rows={4} value={content} onChange={(e) => setContent(e.target.value)} placeholder="这次聊了什么" />
        {差 && <div style={{ color: "var(--text-muted)" }}>{差}</div>}
      </div>
    </Modal>
  );
}

/**
 * 在项目上记一条沟通：方式、时间、内容，加下一步做什么（必填一句话，10-29）和下一步时间（开了超时回收、线索 / 商机阶段必填，别的时候可空）。
 * 记了会挂在客户上（客户页也看得到）和项目当时的节点上；填的下一步时间决定这个项目哪天没跟进会回公海
 */
function RecordFollowModal({ p, 外贸, AI先 = false, onClose, 跑 }: {
  p: 项目详情;
  外贸: boolean;
  /** 从「AI 录入」点进来的：AI 那一格先摆出来、光标先落在那 */
  AI先?: boolean;
  onClose: () => void;
  跑: (f: () => Promise<{ ok: boolean; error?: string }>, 成了?: string) => Promise<boolean>;
}) {
  const 能选类型 = 跟进类型们(外贸).filter((t) => t.value !== "TASK" && t.value !== "REMIND");
  const [type, setType] = useState<string>(能选类型[0]?.value ?? "PHONE");
  const [method, setMethod] = useState<string | null>(null);
  const [occurredAt, setOccurredAt] = useState(() => dayjs().format(沟通时间格式));
  const [content, setContent] = useState("");
  const [下一步文字, set下一步文字] = useState("");
  const [下一步时间, set下一步时间] = useState<string | null>(null);
  const [明确回复, set明确回复] = useState<boolean | null>(null);
  const [交中, set交中] = useState(false);
  // ---- AI 录入（10-29 P6）：粘原话 → 复用客户页「跟进速记」那条解析（parseFollowUpDraft，同一个模型、同一份额度）→ 只往格子里预填，
  // 人核对后点「记下」才写库；解析本身不写任何业务表。企业版、配了模型、看得到客户才给
  const 给AI = !!(p.企业版 && p.aiEnabled && p.customer);
  const [AI开, setAI开] = useState(AI先);
  const [原话, set原话] = useState("");
  const [解析, set解析] = useState<{ 起: number; 结果?: string; 出错?: string } | null>(null);
  const 解析中 = Boolean(解析 && !解析.结果 && !解析.出错);
  const AI已用完 = useAiOutOfCredits();
  const 任务键 = `project-followup-parse:${p.id}`;
  /** 解析途中弹窗关了 / 又点了一次：旧的那轮回来不许再往格子里填 */
  const 这一次 = useRef(0);
  const 关 = () => {
    这一次.current++;
    clearJob(任务键);
    onClose();
  };
  const AI解析 = async () => {
    if (!p.customer || AI已用完) return;
    if (原话.trim().length < 5) {
      set解析({ 起: Date.now(), 出错: "先把沟通过程随手写几句" });
      return;
    }
    const 轮 = ++这一次.current;
    const 起 = Date.now();
    set解析({ 起 });
    const 请求 = parseFollowUpDraft({ customerId: p.customer.id, text: 原话 });
    runJob<null>(任务键, () => 请求.then((r) => (r.ok ? { ok: true as const, value: null } : { ok: false as const, error: r.error })), undefined, { 名: "解析项目沟通", 去: `/projects/${p.id}` });
    let r: Awaited<typeof 请求>;
    try {
      r = await 请求;
    } catch (e) {
      r = { ok: false, error: e instanceof Error ? e.message : "解析失败，请重试" };
    }
    if (轮 !== 这一次.current) return;
    if (!r.ok) {
      set解析({ 起, 出错: r.error });
      return;
    }
    const 填 = 项目沟通预填(r.draft, 能选类型.map((t) => t.value));
    if (填.type) setType(填.type);
    if (填.content) setContent(填.content);
    if (填.occurredAt) setOccurredAt(填.occurredAt);
    if (填.下一步) set下一步文字(填.下一步);
    if (填.下一步时间) set下一步时间(填.下一步时间);
    const 摘要 = [填.type && "方式", 填.occurredAt && "时间", 填.content && "内容", 填.下一步 && "下一步", 填.下一步时间 && "下一步时间"].filter(Boolean);
    set解析({ 起, 结果: 摘要.length ? `已预填：${摘要.join(" · ")}，核对无误再记下` : "没认出能填的，手动填吧" });
  };
  const 差 = !content.trim() ? "请填写这次沟通的内容" : p.企业版 && 明确回复 === null ? "请选客户明确回复了吗"
    : !下一步文字.trim() ? "请写下一步做什么" : p.要下一步 && !下一步时间 ? "请填下一步时间" : "";
  // 选了下一步时间就预演回收日（10-30 P0-2）：和服务端同一个算法，算不准（没底子）就不写
  const 预演 = 预演回收日(p.回收预演, dayjs(occurredAt, 沟通时间格式).format("YYYY-MM-DD"), 下一步时间);

  const 交 = async () => {
    set交中(true);
    const ok = await 跑(() => 记项目沟通Action(p.id, { type, method: 对得上的方式(type, method), content, occurredAt, 下一步: 下一步文字, 下一步时间, ...(p.企业版 ? { 阶段: p.phase, 明确回复: 明确回复 === true } : {}) }), "已记下这条沟通");
    set交中(false);
    if (ok) 关();
  };

  return (
    <Modal
      open
      title="记一条沟通"
      okText="记下"
      okButtonProps={{ disabled: !!差, loading: 交中, title: 差 || undefined }}
      // 还差哪一格写在「记下」旁边，不用悬停
      footer={(按钮) => (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
          {差 && <span style={{ color: "var(--text-muted)", fontSize: "var(--dt-aux, 12px)" }}>{差}</span>}
          <span>{按钮}</span>
        </div>
      )}
      // 写了字就别让点到框外把草稿关掉（10-29 实点：点日历时手一偏，整段没了）
      mask={{ closable: !content.trim() && !下一步文字.trim() && !原话.trim() }}
      onCancel={关}
      onOk={() => void 交()}
    >
      <div style={{ display: "grid", gap: 12 }}>
        {给AI && !AI开 && (
          <Button size="small" icon={<ThunderboltOutlined />} style={{ justifySelf: "start" }} onClick={() => setAI开(true)}>用 AI 从原话预填</Button>
        )}
        {给AI && AI开 && (
          <div style={{ border: "1px solid var(--brand-line)", borderRadius: 8, padding: "10px 12px" }}>
            <Input.TextArea
              aria-label="沟通原话"
              autoFocus={AI先}
              value={原话}
              onChange={(e) => set原话(e.target.value)}
              autoSize={{ minRows: 2, maxRows: 6 }}
              maxLength={5000}
              placeholder="把这次沟通随手倒出来，或粘贴聊天记录、语音转的文字，AI 帮你填下面的格子"
            />
            <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {解析 ? <AiWait 在做="从这段话里认出沟通方式、内容和下一步时间" 起={解析.起} 结果={解析.结果} 出错={解析.出错} />
                  : <span style={{ color: "var(--text-muted)", fontSize: "var(--dt-aux, 12px)" }}>只是预填，核对无误再记下；「客户明确回复了吗」要你自己选</span>}
              </div>
              <Button size="small" type="primary" ghost icon={<ThunderboltOutlined />} disabled={解析中 || AI已用完} onClick={() => void AI解析()}>
                {解析?.结果 ? "重新解析" : "AI 解析填表"}
                <AiCost />
              </Button>
            </div>
            {AI已用完 && <AiRemaining />}
          </div>
        )}
        <FollowMethodSelect aria-label="沟通方式" type={type} method={method} 类型们={能选类型} onChange={(v) => { setType(v.type); setMethod(v.method); }} />
        <DatePicker
          aria-label="沟通时间"
          showTime={{ format: "HH:mm" }}
          format={沟通时间格式}
          allowClear={false}
          style={{ width: "100%" }}
          value={dayjs(occurredAt, 沟通时间格式)}
          disabledDate={(x) => x.isAfter(dayjs(), "day")}
          onChange={(v) => v && setOccurredAt(v.format(沟通时间格式))}
        />
        {p.企业版 && (
          <div>
            <div style={{ marginBottom: 4 }}>项目阶段<span style={{ color: "var(--text-muted)" }}>（记在项目现在的阶段上）</span></div>
            <Select aria-label="项目阶段" style={{ width: "100%" }} value={p.phase} disabled options={[{ value: p.phase, label: p.phase }]} />
          </div>
        )}
        {p.企业版 && (
          <div>
            <div style={{ marginBottom: 4 }}>客户明确回复了吗<span style={{ color: "var(--danger-text)" }}> *</span></div>
            <Radio.Group aria-label="客户明确回复了吗" value={明确回复} onChange={(e) => set明确回复(e.target.value as boolean)} options={[{ value: true, label: "客户明确回复了" }, { value: false, label: "没有明确回复" }]} />
          </div>
        )}
        <Input.TextArea aria-label="沟通内容" rows={4} value={content} onChange={(e) => setContent(e.target.value)} placeholder="这次聊了什么" />
        <div>
          <div style={{ marginBottom: 4 }}>下一步做什么<span style={{ color: "var(--danger-text)" }}> *</span></div>
          <Input
            aria-label="下一步做什么"
            value={下一步文字}
            onChange={(e) => set下一步文字(e.target.value)}
            maxLength={下一步文字上限}
            showCount
            placeholder="比如：周五前发报价单给对方采购"
          />
        </div>
        <div>
          <div style={{ marginBottom: 4 }}>
            下一步时间{p.要下一步 ? <span style={{ color: "var(--danger-text)" }}> *</span> : <span style={{ color: "var(--text-muted)" }}>（可不填）</span>}
          </div>
          <DatePicker
            aria-label="下一步时间"
            style={{ width: "100%" }}
            value={下一步时间 ? dayjs(下一步时间) : null}
            disabledDate={(x) => x.isBefore(dayjs(), "day")}
            onChange={(v) => set下一步时间(v ? v.format("YYYY-MM-DD") : null)}
          />
          <Space size={4} wrap style={{ marginTop: 6 }}>
            {([["明天", 1], ["3 天后", 3], ["1 周后", 7]] as const).map(([名, 天]) => {
              const 日 = dayjs().add(天, "day").format("YYYY-MM-DD");
              return <Button key={名} size="small" type={下一步时间 === 日 ? "primary" : "default"} ghost={下一步时间 === 日} onClick={() => set下一步时间(日)}>{名}</Button>;
            })}
          </Space>
          {预演 ? (
            <div style={{ marginTop: 4, fontSize: "var(--dt-aux, 12px)", color: 回公海颜色[回公海文案(预演).级别] ?? "var(--text-muted)" }}>选这天 → 回收日变为 {dayjs(预演).format("MM-DD")}</div>
          ) : p.要下一步 && <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: "var(--dt-aux, 12px)" }}>到那天还没人跟进，项目会自动回到项目公海</div>}
        </div>
      </div>
    </Modal>
  );
}
