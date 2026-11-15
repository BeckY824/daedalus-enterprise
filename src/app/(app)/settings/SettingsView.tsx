"use client";

import { useBusinessTimeZone } from "@/lib/business-client";
import { 同名带邮箱 } from "@/lib/utils";

import { useState } from "react";
import { ConfigProvider } from "antd";
import { useSearchParams, usePathname } from "next/navigation";
import { PageHead } from "@/components/ui";
import "./settings.css";
import type { SessionUser } from "@/lib/auth";
import type { 机器 } from "./actions";
import MembersTab, { type Row } from "./MembersTab";
import PasswordTab from "./PasswordTab";
import AuditTab, { type AuditRow } from "./AuditTab";
import AiSettingsTab, { type LlmView } from "./AiSettingsTab";
import BusinessSettingsTab from "./BusinessSettingsTab";
import ImportsTab from "./ImportsTab";
import EnterpriseImportTab from "./EnterpriseImportTab";
import TrashTab from "./TrashTab";
import ProfileTab from "./ProfileTab";
import KeymapTab from "./KeymapTab";
import AppearanceTab from "./AppearanceTab";
import ProjectSettingsTab, { type 项目设置 } from "./ProjectSettingsTab";
import OrgTab, { type 组织架构 } from "./OrgTab";
import RecycleTab, { type 客户回收设置 } from "./RecycleTab";
import LeadAssignCard from "./LeadAssignCard";
import type { 分配情况 } from "../leads/assign-actions";
import { 我能做什么, type 设置身份 } from "@/lib/enterprise/settings-scope";
import { PermTab, RulesTab } from "./IdentityTabs";
import { 角色名, type 业务角色 } from "@/lib/sync/dept-policy";
import type { BusinessConfig } from "@/lib/business-config";
import type { AiUsage } from "@/lib/ai-usage";

/** 左目录里每一项底下那句话。放在组件外面，免得每次渲染重建 */
const 说明表: Record<string, string> = {
  profile: "你的名字、职位",
  keymap: "键盘上那几个键",
  appearance: "底色和主题",
  members: "谁能进、谁是管理员",
  password: "改密码、看哪几台机器登录着",
  ai: "走哪把 Key、还剩几次",
  business: "客户 / 学员 这些叫法",
  imports: "导进来的那几批，可撤销",
  exports: "谁导出了哪张表、多少行",
  enterprise: "飞书 / 钉钉 / Excel 导进来、同步、切换",
  audit: "每一次改动的记录",
  trash: "删了的 30 天内能恢复",
  project: "项目组员角色、成员的上级",
  org: "部门、角色、直属和虚线上级",
  recycle: "沉睡待定、即将回收、自动进公海的天数和占位词",
  quota: "给下属设每月分几条线索",
  perm: "按你的身份，能做和不能做的",
  rules: "影响全公司的规则，只能看",
};

/**
 * 搜设置（原型 st.find）：除了页签名和那一句说明，也搜每一栏里具体的那几项。搜「分配」能搜到线索配额，搜「公海」能搜到客户回收和持有上限。
 * 结果写明在哪个页签、命中哪一项；回车直达第一个，正文亮一下
 */
const 搜词表: Record<string, string[]> = {
  profile: ["名字", "职位"],
  password: ["密码", "退出", "机器"],
  keymap: ["快捷键", "键位"],
  appearance: ["主题", "深色", "底色"],
  members: ["系统管理员", "停用", "离职", "飞书", "解绑", "成员"],
  org: ["部门", "直属上级", "虚线上级", "字段权限", "线索分配", "配额", "市场部门", "只看某人", "业务角色", "后台设置谁能改"],
  business: ["叫法", "客户", "学员"],
  project: ["持有上限", "公海", "超时回收", "进程时限", "必填", "字典", "分配方式", "回收原因", "卡点", "阻碍原因", "提成"],
  recycle: ["公海", "沉睡", "即将回收", "天数", "占位词"],
  ai: ["Key", "模型", "MCP", "令牌"],
  imports: ["导入", "撤销"],
  exports: ["导出"],
  enterprise: ["飞书", "钉钉", "Excel", "同步"],
  audit: ["日志", "谁改了"],
  trash: ["恢复", "删除"],
  quota: ["配额", "分配", "参与"],
  perm: ["权限", "能做什么"],
  rules: ["公海", "回收天数", "持有上限", "进程时限", "字段权限", "市场部门", "组织架构", "开通"],
};

export default function SettingsView({
  users,
  me,
  isAdmin,
  只读 = false,
  logs,
  llm,
  business,
  aiUsage,
  机器,
  用邮箱登录 = false,
  项目设置 = null,
  企业版 = false,
  组织架构 = null,
  企业版导入 = false,
  导入记录 = true,
  回收站 = false,
  导出记录 = null,
  只个人 = false,
  客户回收 = null,
  线索配额 = null,
  身份 = "系统管理员",
  我的角色 = [],
  条线 = false,
}: {
  users: Row[];
  me: SessionUser;
  isAdmin: boolean;
  /** 企业版管理员（admin）：设置页能看、不能改（11-01）。AI 接入 / 业务配置控件全灰，团队成员不给编辑 */
  只读?: boolean;
  logs: AuditRow[];
  llm: LlmView;
  business: BusinessConfig;
  aiUsage: AiUsage;
  /**
   * 用这个云端账号登录着的桌面端机器。**null 表示这一栏不适用**（自部署版、共享工作区），
   * 空数组表示一台都没有。见 actions.ts 的 我的控制面账号。
   */
  机器: 机器[] | null;
  /** 托管版：成员的登录标识是邮箱，不是用户名。见 MembersTab 表单里那段注释 */
  用邮箱登录?: boolean;
  /** 项目模式开着时多一栏「项目模式」；null = 开关关着，这一栏不出现 */
  项目设置?: 项目设置 | null;
  /**
   * 企业版（私有部署的网页版）：快捷键、AI 接入两栏里不提桌面端、我们的云端和隐私政策；
   * 停用成员多了离职交接（放进公海、先清点）
   */
  企业版?: boolean;
  /** 企业版多一栏「组织架构」；null = 不是企业版，这一栏不出现 */
  组织架构?: 组织架构 | null;
  /** 企业版（CRM_ENTERPRISE=1）的管理员：多一栏「企业版导入」（飞书 / 钉钉 / Excel 首次导入、同步、切换） */
  企业版导入?: boolean;
  /** 「导入记录」那一栏：企业版只给能导入的人（老板、总管理员），其余照旧都有 */
  导入记录?: boolean;
  /** 企业版：系统管理员、回收站副手多一栏「回收站」（删了的客户 / 项目 / 联系人 / 沟通记录，30 天内能恢复） */
  回收站?: boolean;
  /** 「导出记录」那一栏（11-03）：最近 200 次导出，只给系统管理员；null = 不摆 */
  导出记录?: AuditRow[] | null;
  /** 企业版不是系统管理员（11-03 D3-1）：只摆个人资料、登录与密码、快捷键、外观（回收站副手另有回收站），成员管理、后台设置都不出 */
  只个人?: boolean;
  /** 企业版项目模式多一栏「客户回收」（客户三态的开关、天数、占位词，C16）；null = 不摆 */
  客户回收?: 客户回收设置 | null;
  /** 登录身份（P-界面-46）：系统管理员 / 只读管理员 / 成员 */
  身份?: 设置身份;
  /** 不是系统管理员、手下有能设配额的人（PR10b ③）：单给一栏「线索配额」；null = 不摆（系统管理员在组织架构里设） */
  线索配额?: { 行: 分配情况; 不限额: boolean } | null;
  /** 我的业务角色（「我能做什么」按它列） */
  我的角色?: string[];
  /** 是条线总管理（总管理设了业务线） */
  条线?: boolean;
}) {
  const 身份名 = 身份 === "系统管理员" ? "总管理（系统管理员）" : 身份 === "只读管理员" ? "管理员（只读）"
    : 我的角色.map((r) => (r === "director" && 条线 ? "条线总管理" : 角色名[r as 业务角色] ?? r)).join("、") || "还没设业务角色";
  const [搜, set搜] = useState("");
  // 回车直达后正文亮一下（原型 st.find）：换个 key 让动画重放
  const [亮, set亮] = useState(0);
  // 当前页签由地址栏 ?tab= 决定：中栏那列设置项就是一组带 tab 的链接，刷新、回退都对得上
  const timeZone = useBusinessTimeZone();
  const pathname = usePathname();
  const tab = useSearchParams().get("tab") ?? "members";

  /** 设置的几项。说明一句话写清这一项管什么——只有名字的话，「业务配置」是个谜 */
  // 持有上限名单每人一行：同名的带邮箱才分得清是谁（10-27）
  const 在职 = users.filter((u) => u.active);
  const 叫 = 同名带邮箱(在职);
  const 持有成员 = 在职.map((u) => ({ id: u.id, name: 叫.get(u.id)! }));
  const 目录: { key: string; label: string; 说明: string; children: React.ReactNode }[] = [
    /**
     * 个人资料排第一：这一页最常被打开的原因是「改我自己的什么」，
     * 而不是「管别人」。改名以前只在「团队成员」那个只有管理员打得开的弹窗里，
     * 于是销售想改自己的名字得去求管理员。
     */
    { key: "profile", label: "个人资料", children: <ProfileTab me={{ name: me.name, title: me.title, email: me.email }} /> },
    { key: "members", label: "团队成员", children: <MembersTab users={users} me={me} isAdmin={isAdmin && !只读} 用邮箱登录={用邮箱登录} 企业版={企业版} /> },
    { key: "keymap", label: "快捷键", children: <KeymapTab /> },
    { key: "appearance", label: "外观", children: <AppearanceTab /> },
    { key: "password", label: "登录与密码", children: <PasswordTab 机器={机器} /> },
    // AI 接入、业务配置全团队一份，只有老板（企业版：总管理）改；企业版管理员只读看，控件整栏灰掉（服务端 requireAdmin 另外拦）
    ...(isAdmin ? [{ key: "ai", label: "AI 接入", children: <ConfigProvider componentDisabled={只读}><AiSettingsTab llm={llm} usage={aiUsage} 企业版={企业版} /></ConfigProvider> }] : []),
    ...(isAdmin ? [{ key: "business", label: "业务配置", children: <ConfigProvider componentDisabled={只读}><BusinessSettingsTab value={business} 多人={users.filter((u) => u.active).length > 1} 企业版={企业版} /></ConfigProvider> }] : []),
    ...(组织架构 ? [{ key: "org", label: "组织架构", children: <OrgTab value={组织架构} /> }] : []),
    ...(项目设置 ? [{ key: "project", label: "项目模式", children: <ProjectSettingsTab value={项目设置} 成员={持有成员} /> }] : []),
    ...(企业版 ? [{ key: "perm", label: "我能做什么", children: <PermTab 身份名={身份名} 项们={我能做什么(我的角色, 身份, 条线)} /> }] : []),
    ...(企业版 && 只个人 ? [{ key: "rules", label: "全公司规则", children: <RulesTab /> }] : []),
    ...(线索配额 ? [{ key: "quota", label: "线索配额", children: <LeadAssignCard rows={线索配额.行} 不限额={线索配额.不限额} /> }] : []),
    ...(客户回收 ? [{ key: "recycle", label: "客户回收", children: <RecycleTab value={客户回收} /> }] : []),
    ...(导入记录 ? [{ key: "imports", label: "导入记录", children: <ImportsTab /> }] : []),
    ...(企业版导入 ? [{ key: "enterprise", label: "企业版导入", children: <EnterpriseImportTab /> }] : []),
    ...(回收站 ? [{ key: "trash", label: "回收站", children: <TrashTab /> }] : []),
    ...(导出记录 ? [{ key: "exports", label: "导出记录", children: <AuditTab logs={导出记录} 导出 /> }] : []),
    { key: "audit", label: "操作日志", children: <AuditTab logs={logs} /> },
  ]
    .filter((x) => !只个人 || ["profile", "password", "keymap", "appearance", "perm", "quota", "rules", "trash"].includes(x.key))
    // 不是托管版没有「已登录的机器」这一块（机器 = null），说明别提它（D1-2）
    .map((x) => ({ ...x, 说明: x.key === "password" && !机器 ? "改自己的登录密码" : 说明表[x.key] ?? "" })) as { key: string; label: string; 说明: string; children: React.ReactNode }[];

  /**
   * 分组：**「我自己的」和「整个团队的」分开**——这两件事的心理位置不一样。
   * 顺序就是这里的顺序，不跟着上面那个数组走（那个数组是按谁先写的排的）。
   * 没列进来的 key 会落到最后一组，加了新栏忘了分组也不会凭空消失。
   */
  /* 按「我要做什么」分组（原型 st.role，P-界面-46）：按登录身份给，不给切换 */
  const 分组表: [string, string[]][] = 只个人
    ? [
        ["我自己", ["profile", "password", "keymap", "appearance", "perm"]],
        ["带团队", ["quota"]],
        ["数据", ["trash"]],
        ["全公司规则", ["rules"]],
      ]
    : [
        ["我自己", ["profile", "password", "keymap", "appearance", "perm"]],
        ["团队与权限", ["members", "org"]],
        ["线索和公海", ["recycle", "project"]],
        ["业务与 AI", ["business", "ai"]],
        ["数据", ["imports", "enterprise", "exports", "trash", "audit"]],
      ];

  /**
   * **真正摆出来的是哪一栏**。地址栏没带 ?tab= 时默认是 members，
   * 但网页版的普通成员看不到它——这时正文落到第一栏（个人资料），
   * 而左边目录还在找 members，于是**哪一项都不亮**，看上去像选中了鼠标停着的那项
   * （2026-09-28 用户截图：「桌面端」发灰、正文是个人资料）。
   * 左边亮哪项、正文画哪栏、读屏的 aria 指向，三处都只认这一个值。
   */
  const 当前 = 目录.some((x) => x.key === tab) ? tab : 目录[0].key;

  const 词 = 搜.trim().toLowerCase();
  /** 命中的是哪一项（页签名、说明没中、具体那一项中了时写出来） */
  const 命中of = (x: (typeof 目录)[number]) =>
    `${x.label}${x.说明}${x.key}`.toLowerCase().includes(词) ? "" : (搜词表[x.key] ?? []).find((w) => w.toLowerCase().includes(词)) ?? null;
  const 搜到的 = 词 ? 目录.filter((x) => 命中of(x) !== null) : 目录;
  const 去 = (key: string) => window.history.replaceState(null, "", `${pathname}?tab=${key}`);
  const 分好组: [string, typeof 目录][] = 词
    ? [["", 搜到的]]
    : 分组表
        .map(([名, keys]) => [名, keys.map((k) => 搜到的.find((x) => x.key === k)).filter(Boolean)] as [string, typeof 目录])
        .concat([["其它", 搜到的.filter((x) => !分组表.some(([, ks]) => ks.includes(x.key)))]])
        .filter(([, 项]) => 项.length > 0);

  return (
    <>
      <PageHead title="设置" subtitle={`${企业版 ? `${身份名} · ${只个人 || 只读 ? "灰掉的只能看" : "按「我要做什么」分组"}` : "成员、AI 与业务配置"} · ${timeZone ? "业务日期按北京时间（UTC+8）" : "业务日期按本机时区"}`} />

      {/*
        左目录，不是顶上一排页签。有两项只有管理员看得到，页签横着排时
        管理员和普通成员看到的宽度都不一样；竖着排还能给每项留一句说明。
        角色仍然是 tablist / tab / tabpanel——读屏按这个认，e2e 也按这个找。
        窄屏下目录仍然是单列，只是压到正文上面（见 globals.css 的 .set）。

        **分组和搜索是 2026-09-17 加的**（对着 Claude / Codex 桌面端那两个设置窗口）：
        项数到了八个，一列平铺就开始要一项项扫。分组把「我自己的」和「整个团队的」分开——
        这两件事的心理位置完全不同。搜索框在项数少时是多余的，但它救的是
        「我知道那个开关叫什么、但不知道它在哪一栏」，而那正是设置页最常见的一次来访。
      */}
      {/* set-box 只为让下面按「正文实际多宽」排（settings.css）：1024 宽 + AI 栏常驻时正文只剩约 420px，按窗口宽度判断还是两栏，设置内容被挤成 150px 一条（10-19 排版闸门） */}
      <div className="set-box">
      <div className="set">
        <div className="set-nav" role="tablist" aria-orientation="vertical" aria-label="设置分类">
          <input
            className="set-search"
            type="search"
            value={搜}
            onChange={(e) => set搜(e.target.value)}
            onKeyDown={(e) => {
              // 回车直达第一个结果，正文亮一下
              if (e.key === "Enter" && 词 && 搜到的[0]) {
                去(搜到的[0].key);
                set亮((n) => n + 1);
              }
            }}
            placeholder="搜一项设置，比如「公海」「分配」"
            aria-label="搜索设置"
          />
          {搜到的.length === 0 && <div className="set-nav-empty">没有匹配的设置项</div>}
          {分好组.map(([组名, 项]) => (
            <div key={组名} className="set-nav-g">
              {/* 搜索时不摆组标题：那时人要的是一份短名单，不是结构 */}
              {!搜.trim() && <div className="set-nav-h">{组名}</div>}
              {项.map((x) => (
            <button
              key={x.key}
              type="button"
              role="tab"
              id={`set-tab-${x.key}`}
              aria-selected={当前 === x.key}
              aria-controls={`set-panel-${x.key}`}
              className={`set-nav-i${当前 === x.key ? " on" : ""}`}
              /*
                用原生 history 而不是 router.replace：这一页是 force-dynamic 的服务端组件，
                router.replace 改个 ?tab= 会让 Next 把整页重新向服务端要一遍——200 条操作日志、
                成员、AI 配置，桌面端还要去云端问一次余额。切个页签卡半秒，就是这么来的
                （2026-09-17 用户在真机上感觉到「偶尔卡卡的」）。Next 会把原生 pushState/replaceState
                同步进 useSearchParams，所以下面读 tab 的那行照旧生效，刷新、回退也照旧对得上。
              */
              onClick={() => 去(x.key)}
            >
              <b>{x.label}</b>
              <span>{词 && 命中of(x) ? `${x.label} › ${命中of(x)}` : x.说明}</span>
            </button>
              ))}
            </div>
          ))}
        </div>
        <div key={亮} className={`set-body${亮 ? " set-flash" : ""}`} role="tabpanel" id={`set-panel-${当前}`} aria-labelledby={`set-tab-${当前}`}>
          {只读 && (
            <div className="set-ro" role="note">你是只读管理员：后台设置都能看，不能改；要改请找系统管理员。</div>
          )}
          {目录.find((x) => x.key === 当前)?.children}
        </div>
      </div>
      </div>
    </>
  );
}
