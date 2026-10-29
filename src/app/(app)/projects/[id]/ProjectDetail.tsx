"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ThunderboltOutlined } from "@ant-design/icons";
import { App, Alert, Button, Card, Checkbox, Input, Modal, Popconfirm, Progress, Radio, Select, Space, Tag, Timeline, Tooltip } from "antd";
import DatePicker from "@/components/BusinessDatePicker";
import DictSelect from "@/components/DictSelect";
import { 其他没写好 } from "@/lib/enterprise/dict-kinds";
import { 必填叫法 } from "@/lib/project/required";
import { PageHead, CustomerLink, FollowTypeCell } from "@/components/ui";
import { useBusiness } from "@/lib/business-client";
import { dayjs, fmtDateTime } from "@/lib/utils";
import { 跟进类型们 } from "@/lib/constants";
import { 外贸精简 } from "@/lib/business-config";
import { 金额 } from "@/lib/currency";
import { 阶段们, 交付还差, 下一步, 节点序号, 节点总数of, 原因上限, 要写原因, 字典of, 结局叫法, 团队版字典, type 位置, type 阶段字典 } from "@/lib/project/nodes";
import { 超时理由 } from "@/lib/project/timeout";
import { 阶段与进程, type 出口叫法改动 } from "@/lib/project/stage-dict";
import { 有效线索节点, 缺有效沟通 } from "@/lib/project/stage-gates";
import type { 线索验证 } from "@/lib/project/lead-verify";
import LeadVerifyPanel from "./LeadVerifyPanel";
import AiWait from "@/components/AiWait";
import AiCost, { AiRemaining, useAiOutOfCredits } from "@/components/AiCost";
import { clearJob, runJob } from "@/lib/ai-jobs";
import type { 可选渠道 } from "@/components/ChannelPicker";
import { 拼地址, 企业级别, 企业级别说明, type 客户地址 } from "@/lib/enterprise/customer-v2";
import { 级别星 } from "@/lib/enterprise/level-stars";
import { 项目区域 } from "@/lib/project/profile-rules";
import { 项目沟通预填, 沟通时间格式 } from "@/lib/project/project-fields";
import { parseFollowUpDraft } from "../../customers/[id]/ai";
import { 改项目节点, 勾项目交付, 删除项目, 放回项目公海, 领取项目, 记项目沟通Action } from "../actions";
import type { 可选成员 } from "@/lib/utils";
import { ProjectEditModal, ProjectTeamCard, type 组员, type 角色, type 联系人 } from "./ProjectTeam";
import { BlockerList, PublishBlockerModal, type 卡点卡, type 可选人 } from "../BlockerPanel";
import type { 卡点默认 } from "@/lib/project/blocker-rules";
import { ProjectCommissionCard } from "./ProjectCommission";
import { ContactAttachmentsButton } from "../../customers/[id]/ContactAttachments";
import type { 提成卡 } from "@/lib/project/commission";
import PaneToggle from "@/components/PaneToggle";
import { ProjectAttachmentsCard, ProjectProfileCard, type 项目画像 } from "./ProjectExtras";

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
   */
  nextStepAt: string | null; 回收日: string | null;
  /** 企业版预计成交日期（10-27 从客户挪到项目，服务端排好的 YYYY-MM-DD）；不是企业版不传 */
  expectedDealAt?: string | null; 要下一步: boolean; 能记沟通: boolean;
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
  /** 企业版：code 是沟通编号（FUL…），提醒按下一步时间算（blocker-rules.ts 时限提醒of），没填下一步时间不给 */
  followUps: { id: string; type: string; content: string; occurredAt: string; who: string; node: string; code?: string | null; 提醒?: { 级别: "稳" | "拿捏" | "超时"; 文字: string } | null }[];
  members: 组员[];
  /** 企业版提成卡：不是企业版、我看不了（不是组长 / 组员 / 管理员 / 上级）= null，卡片不出 */
  提成: 提成卡 | null;
  /** 删项目时一起删掉的：节点留痕（含转让痕）、项目组、沟通和项目的关联 */
  删前清点: { 留痕: number; 组员: number; 沟通: number };
  /** 企业版项目画像（P11）：不是企业版、公海里没领的不给 */
  画像?: 项目画像;
  /** 企业版项目附件（P11）：看得到才有；只读 = 不能改这个项目（api/attachments/access.ts 项目附件入口） */
  项目附件?: { 个数: number; 只读: boolean };
};

const 行样: React.CSSProperties = { display: "flex", gap: 12, alignItems: "center", marginBottom: 8, minWidth: 0 };
// 四个字的键（来源线索 / 预计成交）在 14px 下要 ~56px，48px 会折成两行（10-27）
const 键样: React.CSSProperties = { color: "var(--text-muted)", flex: "0 0 60px", whiteSpace: "nowrap" };

/** 删项目的确认框：列出一起删掉的几样，说清沟通记录本身不删 */
function 删除说明(n: 项目详情["删前清点"], 客户叫法: string) {
  const 删 = [`${n.留痕} 条进程留痕`, n.组员 ? `项目组 ${n.组员} 人` : "", n.沟通 ? `${n.沟通} 条沟通和这个项目的关联` : ""].filter(Boolean);
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
/** 项目级别格（企业版 P11）：星 + 档名（「★★★☆ A 重点」）；没分级写「没分级」，认不出的原样给 */
function 级别格(v: string | null) {
  if (!v) return <span style={{ color: "var(--text-muted)" }}>没分级</span>;
  const 档 = 企业级别(v);
  if (!档) return <span>{v}</span>;
  return (
    <span title={企业级别说明[档]}>
      <span aria-hidden style={{ color: "var(--warning-text)", letterSpacing: 1 }}>{级别星(档)}</span>
      <span style={{ marginLeft: 6, color: "var(--text-muted)" }}>{企业级别说明[档]}</span>
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

const 提醒色 = { 稳: "green", 拿捏: "gold", 超时: "red" } as const;

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
  const { message } = App.useApp();
  const b = useBusiness();
  const [忙, set忙] = useState(false);
  const [异常框, set异常框] = useState<位置 | null>(null);
  const [没成框, set没成框] = useState<位置 | null>(null);
  const [无效原因, set无效原因] = useState<string | null>(null);
  const [放回框, set放回框] = useState(false);
  const [回收原因, set回收原因] = useState<string | null>(null);
  const [原因, set原因] = useState("");
  const [类别, set类别] = useState<string | null>(null);
  const [编辑开着, set编辑开着] = useState(false);
  const [记一条开着, set记一条开着] = useState<false | "手填" | "AI">(false);
  const [发卡点于, set发卡点于] = useState<string | null>(null);
  const 当前: 位置 = { phase: p.phase, node: p.node, result: p.result };
  const 字典 = 字典of(p.企业版, p.出口叫法);
  const 节点总数 = 节点总数of(字典);
  const 下 = 下一步(当前, 字典);
  const 差 = 交付还差(p);
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

  const 改到 = (到: 位置) => {
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
    if (到.result === "成功交付" && 差.length) {
      message.warning(`还差${差.join("、")}，勾上才能点成功交付`);
      return;
    }
    void 跑(() => 改项目节点(p.id, 到), `已改到 ${位置文字(到, 字典)}`);
  };

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
  const 位 = 阶段与进程(p, 字典);
  const 节点卡 = (
    <Card style={p.企业版 ? undefined : { marginBottom: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between" }}>
        {/* P11：阶段（线索/商机/订单）和进程（节点）分两格摆，不拼成一串；成功交付、异常状态的阶段算订单 */}
        <div className="proj-where">
          <div>
            <div className="proj-where-label">阶段</div>
            <div className="proj-where-value">{位.阶段}</div>
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="proj-where-label">进程</div>
            <div className="proj-where-value">
              <span className="proj-where-node" title={位.进程}>{位.进程}</span>
              {位.结局 && <Tag style={{ marginLeft: 8 }} color={异常 ? "error" : p.result === "成功交付" ? "success" : "default"}>{位.结局}</Tag>}
            </div>
          </div>
        </div>
        <Space wrap>
          <Select
            style={{ width: 200 }}
            placeholder={异常 ? "改到某个进程就算恢复" : "改到…"}
            value={null}
            disabled={!节点可改 || 忙}
            title={节点不能改}
            options={去处们(当前, !!p.必填?.只能靠填齐 || !!p.不给推 || 卡有效沟通, 字典)}
            onChange={(v: string | null) => {
              if (!v) return;
              const { phase, node, result } = JSON.parse(v) as 位置;
              改到({ phase, node, ...(result ? { result } : {}) });
            }}
          />
          {/* 灰掉的按钮收不到鼠标事件，外面包一层 span 才能悬停出原因 */}
          <Tooltip title={节点不能改 ?? p.不给推 ?? (卡有效沟通 ? 缺有效沟通 : undefined) ?? (p.必填?.只能靠填齐 ? "这个进程填齐必填后自动往前推；要先推请找老板或主管" : 下 ? undefined : p.result ? "先改回某个进程再往前推" : "这是最后一个进程了，接下来点结局")}>
            <span>
              <Button type="primary" disabled={!节点可改 || 忙 || !下 || !!p.必填?.只能靠填齐 || !!p.不给推 || 卡有效沟通} onClick={() => 下 && 改到(下)}>
                {下 ? `下一步：${下.phase === p.phase ? 下.node : `${下.phase}·${下.node}`}` : "下一步"}
              </Button>
            </span>
          </Tooltip>
        </Space>
      </div>
      <Progress
        style={{ marginTop: 12, marginBottom: 0 }}
        percent={Math.round(((p.result === "成功交付" ? 节点总数 : 节点序号(当前, 字典)) / 节点总数) * 100)}
        showInfo={false}
        status={异常 ? "exception" : p.result === "成功交付" ? "success" : "active"}
        aria-label={`第 ${节点序号(当前, 字典) + 1} 个进程，共 ${节点总数} 个`}
      />
      {p.线索验证 && <LeadVerifyPanel projectId={p.id} v={p.线索验证} 无效原因选项={p.原因选项.无效} 跑={跑} 忙={忙} 没有效沟通={没有效沟通} 不给推={p.不给推} />}
      {没有效沟通 && !p.线索验证?.我能 && (
        <div style={{ marginTop: 12, color: "var(--text-muted)" }}>还没有客户明确回复的沟通：记一条、选「客户明确回复了」，才能推过线索验证</div>
      )}
      {p.必填 && (
        <div style={{ marginTop: 12, color: p.必填.还差.length ? "var(--text-muted)" : "var(--success-text)", overflowWrap: "anywhere" }}>
          {p.必填.还差.length
            ? `这个进程填齐必填后自动往前推，还差：${p.必填.还差.map(必填叫法).join("、")}`
            : "这个进程的必填都齐了"}
        </div>
      )}
    </Card>
  );
  const 项目卡 = (
    <Card title="项目" extra={可改 && <Button type="link" size="small" disabled={忙} onClick={() => set编辑开着(true)}>编辑</Button>}>
      <div style={行样}><span style={键样}>{b.customer}</span>{p.customer ? <CustomerLink id={p.customer.id} name={p.customer.name} company={p.customer.school} /> : <span style={{ color: "var(--text-muted)" }}>领取后显示</span>}</div>
      {p.来源线索 && (
        <div style={行样}><span style={键样}>来源线索</span><span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{p.来源线索.name ?? <span style={{ color: "var(--text-muted)" }}>已删除的线索</span>}{p.来源线索.convertedAt && <span style={{ color: "var(--text-muted)" }}>（{p.来源线索.convertedAt} 转入）</span>}</span></div>
      )}
      {/* 联系人名字、职位可能很长：在 1024 宽的项目卡里折行，不顶出卡片 */}
      {p.contact && <div style={行样}><span style={键样}>联系人</span><span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{p.contact.name}{p.contact.position ? ` · ${p.contact.position}` : ""}</span></div>}
      {p.contact && p.联系人附件 && <div style={行样}><span style={键样}>附件</span><ContactAttachmentsButton contactId={p.contact.id} 名字={p.contact.name} 起始个数={p.联系人附件.个数} 只读={p.联系人附件.只读} /></div>}
      {p.企业版 && p.level !== undefined && (
        <div style={行样}><span style={键样}>级别</span>{级别格(p.level)}</div>
      )}
      <div style={行样}><span style={键样}>金额</span>{金额(p.amount, p.currency)}</div>
      {p.企业版 && <div style={行样}><span style={键样}>预计成交</span>{p.expectedDealAt ?? <span style={{ color: "var(--text-muted)" }}>没填</span>}</div>}
      {p.企业版 && p.已立项天数 !== undefined && <div style={行样}><span style={键样}>已立项</span>{p.已立项天数 === 0 ? "今天立项" : `${p.已立项天数} 天`}</div>}
      {p.企业版 && p.项目来源 !== undefined && (
        <div style={行样}><span style={键样}>项目来源</span><span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{p.项目来源 ? <>{p.项目来源.name}{p.项目来源.跟客户 && <span style={{ color: "var(--text-muted)" }}>（同{b.customer}来源）</span>}</> : <span style={{ color: "var(--text-muted)" }}>没填</span>}</span></div>
      )}
      {p.企业版 && p.所在地 && (
        <>
          <div style={行样}><span style={键样}>区域</span>{项目区域(p.所在地) || <span style={{ color: "var(--text-muted)" }}>没填</span>}</div>
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
      {p.nextStepAt && !p.pooled && <div style={行样}><span style={键样}>下一步</span>{p.nextStepAt}</div>}
      {p.回收日 && <div style={{ ...行样, color: 回收临近(p.回收日) ? "var(--warning-text)" : "var(--text-muted)" }}>{p.回收日} 前没人跟进，会自动回到项目公海</div>}
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
              disabled={!可改 || 忙 || (勾了 && p.result === "成功交付")}
              title={不能改 ?? (勾了 && p.result === "成功交付" ? "已经成功交付了；要取消先把进程改回去" : undefined)}
              onChange={(e) => void 跑(() => 勾项目交付(p.id, k, e.target.checked))}
            >
              {k === "balanceSettled" ? "尾款结清" : "验收通过"}
            </Checkbox>
            {勾了 && 谁 && <span style={{ color: "var(--text-muted)", marginLeft: 4 }}>{谁} · {fmtDateTime(何时)}</span>}
          </div>
        );
      })}
      <div style={{ color: "var(--text-muted)", marginTop: 4 }}>
        {p.result === "成功交付" ? "已经成功交付" : 差.length ? `两项都勾上才能点成功交付（还差${差.join("、")}）` : "两项都勾上了，可以点成功交付"}
      </div>
      {p.result !== "成功交付" && (
        <Button
          style={{ marginTop: 8 }}
          disabled={!可改 || 忙 || 差.length > 0}
          title={不能改 ?? (差.length ? `还差${差.join("、")}` : undefined)}
          onClick={() => 改到({ phase: "订单", node: p.phase === "订单" ? p.node : 字典.节点们.订单[字典.节点们.订单.length - 1], result: "成功交付" })}
        >
          成功交付
        </Button>
      )}
    </Card>
  );
  const 项目组卡 = <ProjectTeamCard projectId={p.id} 组员们={p.members} 角色们={角色们} 在职={在职} 能改={可改} 忙={忙} 跑={跑} 企业版={p.企业版} 组长={p.ownerName} />;
  const 提成区 = p.提成 && <ProjectCommissionCard key={`${p.提成.项目底价}-${p.提成.实际?.固定于 ?? ""}`} projectId={p.id} t={p.提成} 忙={忙} 跑={跑} />;
  const 变更卡 = (
    <Card title="进程变更">
      <Timeline
        items={p.logs.map((l) => ({
          color: l.kind !== "node" ? "gray" : l.to.result === "异常状态" ? "red" : l.to.result === "成功交付" ? "green" : "blue",
          content: (
            <div>
              <div>{l.kind !== "node" ? 换人文字(l) : l.from ? `${位置文字(l.from, 字典)} → ${位置文字(l.to, 字典)}` : `建档，落在 ${位置文字(l.to, 字典)}`}</div>
              {l.category && <div style={{ color: "var(--danger-text)" }}>异常类别：{l.category}</div>}
              {l.kind === "node" && l.reason && l.reason !== 超时理由 && <div style={{ color: "var(--danger-text)", whiteSpace: "pre-wrap" }}>{l.category ? "备注" : "原因"}：{l.reason}</div>}
              {/* 换人那几行：企业版记的回收原因 / 分配方式（10-27）原样淡色显示；超时、停用上一行已经说了 */}
              {l.kind !== "node" && l.reason && l.reason !== 超时理由 && (l.放回方式 ?? "手动") === "手动" && <div style={{ color: "var(--text-muted)", whiteSpace: "pre-wrap" }}>{l.reason}</div>}
              <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{l.reason === 超时理由 ? "系统" : l.who} · {fmtDateTime(l.at)}</div>
            </div>
          ),
        }))}
      />
    </Card>
  );
  const 沟通卡 = (
    <Card
      title="沟通"
      extra={
        p.能记沟通 ? (
          // 企业版：沟通是这一页最常做的事，主按钮（10-27 会后排版）
          p.企业版 ? (
            <Space size={4}>
              {/* AI 录入（10-29 P6）：同一个弹窗，打开就是「粘原话 → AI 预填」那一格；没配模型不摆 */}
              {p.aiEnabled && p.customer && <Button size="small" icon={<ThunderboltOutlined />} disabled={忙} onClick={() => set记一条开着("AI")}>AI 录入</Button>}
              <Button type="primary" size="small" disabled={忙} onClick={() => set记一条开着("手填")}>记一条沟通</Button>
            </Space>
          ) : <Button type="link" size="small" disabled={忙} onClick={() => set记一条开着("手填")}>记一条</Button>
        ) : p.customer && <Link href={`/customers/${p.customer.id}`}>去{b.customer}页{p.企业版 ? "看看" : "记一条"}</Link>
      }
    >
      {p.followUps.length === 0 && <div style={{ color: "var(--text-muted)" }}>{p.customer ? "还没有挂在这个项目上的沟通" : "领取后显示"}</div>}
      {p.followUps.map((f) => (
        <div key={f.id} style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <FollowTypeCell type={f.type} />
            <Tag>{f.node}</Tag>
            {f.code && <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>{f.code}</span>}
            {f.提醒 && <Tag color={提醒色[f.提醒.级别]}>{f.提醒.文字}</Tag>}
            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{f.who} · {fmtDateTime(f.occurredAt)}</span>
            {卡点?.能发 && <Button type="link" size="small" style={{ padding: 0 }} onClick={() => set发卡点于(f.id)}>发卡点</Button>}
          </div>
          <div style={{ whiteSpace: "pre-wrap", marginTop: 4, overflowWrap: "anywhere" }}>{f.content}</div>
        </div>
      ))}
    </Card>
  );
  const 卡点区 = 卡点 && (
    <Card title={`卡点（${卡点.们.length}）`} extra={卡点.能发 && <span style={{ color: "var(--text-muted)", fontSize: 12 }}>在沟通记录上点「发卡点」</span>}>
      <BlockerList 们={卡点.们} 人们={卡点.人们} 空="还没有卡点" />
    </Card>
  );

  const 画像卡 = p.画像 && <ProjectProfileCard projectId={p.id} 画像={p.画像} 能改={可改} />;
  const 附件卡 = p.项目附件 && <ProjectAttachmentsCard key={p.id} projectId={p.id} 起始个数={p.项目附件.个数} 只读={p.项目附件.只读} />;

  const 页头 = (
    <PageHead
      title={p.name}
      subtitle={`${p.pooled ? `在项目公海里 · 原负责人 ${p.ownerName}` : `负责人 ${p.ownerName}`} · ${p.creatorName} 建于 ${fmtDateTime(p.createdAt)}`}
      extra={
        <Space wrap>
          {/* 企业版：放回前可选一个「回收原因」（字典，不选也行）；别的版本照旧一个确认 */}
          {p.能放公海 && p.企业版 && <Button disabled={忙} onClick={() => { set回收原因(null); set放回框(true); }}>放回公海</Button>}
          {p.能放公海 && !p.企业版 && (
            <Popconfirm title="放回项目公海？" description={p.企业版 ? "放回去以后同事都能领，你作为原负责人不能再领回来；你会记成这个项目的历史负责人" : "放回去以后谁都能领，你自己不能再领回来"} okText="放回公海" onConfirm={() => void 跑(() => 放回项目公海(p.id), "已放回项目公海")}>
              <Button disabled={忙}>放回公海</Button>
            </Popconfirm>
          )}
          {p.能领取 && <Button type="primary" disabled={忙} onClick={() => void 跑(() => 领取项目(p.id), "已领取，你是这个项目的负责人了")}>领取</Button>}
          {/* 企业版原负责人：按钮摆着、灰着，悬停说为什么（接口也拦，lib/project/db.ts 领取公海项目） */}
          {!p.能领取 && p.领取不给 && <Tooltip title={p.领取不给}><Button type="primary" disabled>领取</Button></Tooltip>}
          {能改 && (
            <Popconfirm title="删除这个项目？" description={删除说明(p.删前清点, b.customer)} okText="删除" okButtonProps={{ danger: true }} onConfirm={() => void 删()}>
              <Button danger disabled={忙}>删除项目</Button>
            </Popconfirm>
          )}
        </Space>
      }
    />
  );

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

      {p.pooled && (
        <Alert type="info" showIcon style={{ marginBottom: 16 }} title="这个项目在项目公海里" description={p.能领取 ? "领取了你就是负责人，可以接着推进程" : p.领取不给 ? `你是原负责人，${p.领取不给}，等同事领取` : "是你放回去的，等同事领取"} />
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
              {附件卡}
            </div>
            <aside className="proj-side" aria-label="项目资料">
              {项目卡}
              {画像卡}
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
          p={{ id: p.id, name: p.name, ownerId: p.ownerId, amount: p.amount, currency: p.currency, remark: p.remark, contactId: p.contact?.id ?? null, ...(p.企业版 ? { expectedDealAt: p.expectedDealAt ?? null, channelId: p.channelId ?? null, level: p.level ?? null, 所在地: p.所在地 ?? null } : {}) }}
          候选={候选}
          联系人们={联系人们}
          渠道们={p.企业版 ? p.渠道们 : undefined}
        />
      )}

      {卡点?.能发 && 发卡点于 && <PublishBlockerModal followUpId={发卡点于} 默认={卡点.默认} 人们={卡点.人们} onClose={() => set发卡点于(null)} />}

      {p.能记沟通 && 记一条开着 && <RecordFollowModal p={p} 外贸={外贸精简(b)} AI先={记一条开着 === "AI"} onClose={() => set记一条开着(false)} 跑={跑} />}

      <Modal
        open={!!异常框}
        title="进异常状态"
        okText="确定"
        okButtonProps={{ danger: true, disabled: !类别, loading: 忙 }}
        onCancel={() => set异常框(null)}
        onOk={async () => {
          if (!异常框 || !类别) return;
          const ok = await 跑(() => 改项目节点(p.id, 异常框, { categoryId: 类别, 备注: 原因 }), "已标成异常状态");
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
        title={没成框 ? `定结果：${结局叫法(没成框.result ?? "", 字典)}` : ""}
        okText="确定"
        okButtonProps={{ danger: true, disabled: !没成备注 || !!其他没写好(无效原因), loading: 忙 }}
        onCancel={() => set没成框(null)}
        onOk={async () => {
          if (!没成框 || !没成备注 || 其他没写好(无效原因)) return;
          const ok = await 跑(() => 改项目节点(p.id, 没成框, { 备注: 没成备注 }), `已改到 ${位置文字(没成框, 字典)}`);
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
    </div>
  );
  return 正文;
}

/** 回收日在两天内（含已到）：提示变成警示色 */
function 回收临近(回收日: string): boolean {
  return dayjs(回收日).diff(dayjs().startOf("day"), "day") <= 2;
}

/**
 * 在项目上记一条沟通：方式、时间、内容，加下一步时间（开了超时回收、线索 / 商机阶段必填）。
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
  const [occurredAt, setOccurredAt] = useState(() => dayjs().format(沟通时间格式));
  const [content, setContent] = useState("");
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
    if (填.下一步时间) set下一步时间(填.下一步时间);
    const 摘要 = [填.type && "方式", 填.occurredAt && "时间", 填.content && "内容", 填.下一步时间 && "下一步时间"].filter(Boolean);
    set解析({ 起, 结果: 摘要.length ? `已预填：${摘要.join(" · ")}，核对无误再记下` : "没认出能填的，手动填吧" });
  };
  const 差 = !content.trim() ? "请填写这次沟通的内容" : p.企业版 && 明确回复 === null ? "请选客户这次有没有明确回复" : p.要下一步 && !下一步时间 ? "请填下一步时间：到那天还没跟进，项目会自动回到项目公海" : "";

  const 交 = async () => {
    set交中(true);
    const ok = await 跑(() => 记项目沟通Action(p.id, { type, content, occurredAt, 下一步时间, ...(p.企业版 ? { 阶段: p.phase, 明确回复: 明确回复 === true } : {}) }), "已记下这条沟通");
    set交中(false);
    if (ok) 关();
  };

  return (
    <Modal
      open
      title="记一条沟通"
      okText="记下"
      okButtonProps={{ disabled: !!差, loading: 交中, title: 差 || undefined }}
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
                  : <span style={{ color: "var(--text-muted)", fontSize: 12 }}>只是预填，核对无误再记下；「客户是否明确回复」要你自己选</span>}
              </div>
              <Button size="small" type="primary" ghost icon={<ThunderboltOutlined />} disabled={解析中 || AI已用完} onClick={() => void AI解析()}>
                {解析?.结果 ? "重新解析" : "AI 解析填表"}
                <AiCost />
              </Button>
            </div>
            {AI已用完 && <AiRemaining />}
          </div>
        )}
        <Select aria-label="沟通方式" value={type} options={能选类型.map((t) => ({ value: t.value, label: t.label }))} onChange={(v: string) => setType(v)} />
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
            <div style={{ marginBottom: 4 }}>客户是否明确回复<span style={{ color: "var(--danger-text)" }}> *</span></div>
            <Radio.Group aria-label="客户是否明确回复" value={明确回复} onChange={(e) => set明确回复(e.target.value as boolean)} options={[{ value: true, label: "明确回复了" }, { value: false, label: "没有明确回复" }]} />
          </div>
        )}
        <Input.TextArea aria-label="沟通内容" rows={4} value={content} onChange={(e) => setContent(e.target.value)} placeholder="这次聊了什么" />
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
          {p.要下一步 && <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 12 }}>到那天还没人跟进，项目会自动回到项目公海</div>}
        </div>
        {差 && <div style={{ color: "var(--text-muted)" }}>{差}</div>}
      </div>
    </Modal>
  );
}
