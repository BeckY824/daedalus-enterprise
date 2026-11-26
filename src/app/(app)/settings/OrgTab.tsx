"use client";

import { useSettingsNote } from "./InlineNote";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Checkbox, Input, Select, Space, Switch, Tag } from "antd";
import { useConsequence } from "@/components/ConsequenceDialog";
import InlineConfirm from "@/components/InlineConfirm";
import SaveButton from "@/components/SaveButton";
import { 角色名, 业务角色, 部门最多层数, 角色组合问题 } from "@/lib/sync/dept-policy";
import BizRoleSelect, { 总管级 } from "./BizRoleSelect";
import { 部门树, type 组织部门 } from "@/lib/enterprise/org-tree";
import { 拆角色, 合角色 } from "@/lib/enterprise/org-core";
import { 规则, 规则名们, 默认开的规则, 关掉后果, type 规则名 } from "@/lib/enterprise/rules-table";
import { 父关着打不开 } from "@/lib/enterprise/switch-table";
import { 字段, 字段名们, 字段级别of, 推荐字段配置, 教练字段级别, type 字段配置, type 字段名 } from "@/lib/enterprise/field-perm-table";
import { 设置项, 设置项们, 谁能改, type 改权限配置, type 能改的人, type 设置项名 } from "@/lib/enterprise/edit-perm-table";
import { 市场部门们 } from "@/lib/enterprise/market";
import { 建部门, 改部门, 删部门, 设成员, 设规则, 设字段权限, 设改权限, 设市场部门, 设只看某人, 设回收站副手, 设可标已开票, 设无主线索复核人, type 成员改动 } from "./org-actions";
import { 设不设配额, type 分配情况 } from "../leads/assign-actions";
import LeadAssignCard from "./LeadAssignCard";
import LineDeptCard from "./LineDeptCard";
import OrgSyncCard from "./OrgSyncCard";
import { 动作出错话 } from "@/lib/stale-deploy";

export type 组织架构 = {
  部门: 组织部门[];
  /** 在职的人；managerId = 手填的直属上级（停用了的当没填） */
  成员: { id: string; name: string; deptId: string | null; bizRole: string; line: string | null; managerId: string | null; dottedManagerId: string | null }[];
  能改: boolean;
  /** 账号管理员：总管理、管理员两个角色只有老板能给、能动 */
  是老板: boolean;
  /** 本人是总管理但被勾了「不管设置」：只看，提示换一句 */
  不管设置?: boolean;
  /** 每条组织规则的开关：除了 默认开的规则（市场复核、超时自动转）默认开，别的默认都关 */
  规则开着: Record<规则名, boolean>;
  /** 「角色 × 字段」表，只有和默认（能改）不一样的格 */
  字段权限: 字段配置;
  /** 字段权限表这个人能不能改：null = 能改，否则是「只有……能改」那句（按「后台设置谁能改」） */
  字段权限挡: string | null;
  /** 「后台设置谁能改」表，只有存过的项；没存的项 = 默认建议 */
  改权限: 改权限配置;
  /** 「线索分配」那一屏：规则关着、或者这个人什么都看不到 = null */
  线索分配: 分配情况 | null;
  /** 规则「线索分配和配额」里的「不设配额（人人参与、不限额）」开着没（10-30）；规则关着 = null */
  线索不设配额?: boolean | null;
  /** 组织规则「市场部门」（10-31）：设了的部门编号；null = 没设，按名字带「市场」的部门和下级 */
  市场部门?: string[] | null;
  /** 逐人设的市场成员（11-01）：用户编号；部门不在市场部门也算 */
  市场单设?: string[];
  /** 只看某人（V3.5.1）：{本人: 那个人}，本人只看那个人建的、负责的 */
  只看某人?: Record<string, string>;
  /** 回收站副手（V3.5.1）：系统管理员之外能看、能恢复回收站的人 */
  回收站副手?: string[];
  /** 无主线索复核人（11-18）：市场复核找不到建的人、客户创建人那两条链时由他复核；null = 没设，交系统管理员 */
  无主线索复核人?: string | null;
  /** 可标已开票（12-15 第三批）：系统管理员之外能勾项目「已开票」的人；取消仍只有系统管理员（30 天内） */
  可标已开票?: string[];
  /** 能进「可标已开票」名单的人（E-373 ②：系统管理员和财务（职位或部门，E-375），服务端 permissions.ts 能进开票名单 算好）；不在里面的不出现在下拉，已在名单里的标「不能标，请去掉」 */
  可标已开票候选?: string[];
};
type 结果 = Promise<{ ok: boolean; error?: string; 提示?: string; 要确认?: string }>;

/** 开关的 data-testid：第一条沿用老名字，E2E 在用 */
const 规则testid: Record<规则名, string> = { 按组织看客户: "org-rule-scope", 线索分配: "org-rule-lead-assign", 字段权限: "org-rule-field-perm", 市场复核: "org-rule-market-review", 超时自动转: "org-rule-reply-overdue", 主动放弃: "org-rule-lead-giveup", 无意义沟通拦: "org-rule-block-meaningless" };
const 级别名 = { 改: "能改", 看: "只能看", 藏: "看不到" } as const;
/** 「后台设置谁能改」表的列 */
const 人列: readonly 能改的人[] = ["总管理员", "销售管理", "市场管理", "直属上级", "虚线上级"];
/** 表头显示的叫法：存的值还是「总管理员」（老配置都按这个存），界面统一叫总管理（D2-2） */
const 人列名 = (p: 能改的人) => (p === "总管理员" ? "总管理" : p);

/**
 * 设置 → 组织架构（企业版，2026-10-24）：部门树、每个人的部门 / 角色 / 业务线 / 直属上级 / 虚线上级。
 * 直属上级只认手填的，不填 = 没有上级（11-03 C10-1）；虚线上级只能看他的客户，不能改、不能转。
 * 只有总管理（director）能改（11-01），管理员和其他人只看。
 */
export default function OrgTab({ value }: { value: 组织架构 }) {
  const router = useRouter();
  // 就地提示（PR9：不弹顶部 message）
  const [就地, 提示条] = useSettingsNote();
  const [新名, set新名] = useState("");
  /*
    忙按项分（原型 st.switch / st.dict「不锁整页」）：一项在存、在等新数据，只灰这一项，别的照常能点。
    键：规则-名、不设配额、字段权限、改权限、部门、市场、副手、无主、成员-id。
    改完到新数据回来之前这一项还算忙：router.refresh 不等它回来就放手，连着拨同一个开关时界面还是旧数据，
    第二下按旧值算、显示和库里对不上（10-25 质量：连关开关要刷新才对）
  */
  const [忙们, set忙们] = useState<ReadonlySet<string>>(() => new Set());
  const [刷新中, 开始刷新_] = useTransition();
  const [等刷新, set等刷新] = useState<ReadonlySet<string>>(() => new Set());
  const 忙 = (键: string) => 忙们.has(键) || (刷新中 && 等刷新.has(键));
  const 刷新 = (键: string) => {
    // 上一次刷新已经回来了：之前等的那些不再算忙，从这一项重新记
    set等刷新((m) => new Set([...(刷新中 ? m : []), 键]));
    开始刷新_(() => router.refresh());
  };
  const 占 = (键: string, 开: boolean) => set忙们((m) => { const n = new Set(m); if (开) n.add(键); else n.delete(键); return n; });
  // 刚拨的开关先按拨的显示；「基于」是拨时页面上的值，页面数据一变（新数据回来、别人也改了）就听页面的
  const [拨了, set拨了] = useState<Partial<Record<规则名, { 基于: boolean; 开: boolean }>>>({});
  const 开着 = (名: 规则名) => {
    const x = 拨了[名];
    return x && x.基于 === value.规则开着[名] ? x.开 : value.规则开着[名];
  };
  // 字段权限的草稿同理：记下起草时页面上的表，页面上的表变了（保存成功、别人改了）草稿作废，显示新的
  const 页面表 = JSON.stringify(value.字段权限);
  const [草稿, set草稿] = useState<{ 基于: string; 表: 字段配置 } | null>(null);
  const 表 = 草稿 && 草稿.基于 === 页面表 ? 草稿.表 : value.字段权限;
  const 表改了 = JSON.stringify(表) !== 页面表;
  // 「后台设置谁能改」的草稿：同上，页面上的表变了就作废
  const 页面改权限 = JSON.stringify(value.改权限);
  const [权限草稿, set权限草稿] = useState<{ 基于: string; 表: 改权限配置 } | null>(null);
  const 改权限 = 权限草稿 && 权限草稿.基于 === 页面改权限 ? 权限草稿.表 : value.改权限;
  const 改权限改了 = JSON.stringify(改权限) !== 页面改权限;
  const { 能改, 是老板, 字段权限挡 } = value;
  const [问后果, 后果框] = useConsequence();
  const 树 = 部门树(value.部门);
  const 名 = new Map(value.部门.map((d) => [d.id, d.name]));
  const 部门选项 = 树.map(({ d, 层 }) => ({ value: d.id, label: `${"　".repeat(层 - 1)}${d.name}` }));

  /** 确认后：服务端回 要确认（改自己会不再是系统管理员，P-判定-06）时先弹二次确认，确认了跑这个 */
  const 跑 = async (键: string, f: () => 结果, 成了?: string, 确认后?: () => 结果): Promise<boolean> => {
    if (忙(键)) return false;
    占(键, true);
    try {
      const r = await f();
      if (!r.ok && r.要确认 && 确认后) {
        // PR9：设管理员类 = 后果框（P-界面-40）
        void 问后果({
          题: "你将不再是系统管理员",
          后果: [{ 标: "收回", 级: "危", 话: r.要确认 }],
          是: "确定改",
          做: async () => {
            const again = await 确认后();
            if (again.ok) 刷新(键);
            return again;
          },
        });
        return false;
      }
      if (!r.ok) 就地.error(r.error ?? "没改成，请稍后再试");
      else {
        if (r.提示) 就地.warning(r.提示);
        else if (成了) 就地.success(成了);
        刷新(键);
      }
      return r.ok;
    } catch (出错) {
      就地.error(动作出错话(出错, "没改成，请稍后再试"));
      return false;
    } finally {
      占(键, false);
    }
  };

  /**
   * 保存键（原型 g.save）：成没成显示在 SaveButton 按钮里（✓ 已保存 / 没保存上 + 原因浮在键上），不写就地小条；
   * 服务端顺带说的提醒（提示）不是成没成，照旧写就地小条
   */
  const 存 = async (键: string, f: () => 结果): Promise<{ ok: boolean; error?: string }> => {
    if (忙(键)) return { ok: false, error: "上一下还在存" };
    占(键, true);
    try {
      const r = await f();
      if (r.ok) {
        if (r.提示) 就地.warning(r.提示);
        刷新(键);
      }
      return r;
    } catch (出错) {
      return { ok: false, error: 动作出错话(出错, "没改成，请稍后再试") };
    } finally {
      占(键, false);
    }
  };

  /*
    部门建 / 改 / 删（PR9，P-界面-40）：原来三个 modal.confirm。建、改能一次做完，改成行下原地编辑（回车或「保存」就存，不再多问）；
    删一行后果说得完（有子部门或人时删不了，服务端挡），用原地确认
  */
  const [编, set编] = useState<{ 建在?: string; 改?: string; 名: string; 上级: string | null } | null>(null);
  const 存编 = async () => {
    if (!编 || !编.名.trim()) return;
    const ok = 编.改
      ? await 跑("部门", () => 改部门(编.改!, { name: 编.名, parentId: 编.上级 }), `已改部门「${编.名.trim()}」`)
      : await 跑("部门", () => 建部门(编.名, 编.建在 ?? null), `已建部门「${编.名.trim()}」`);
    if (ok) set编(null);
  };
  const 可挪到 = (d: 组织部门) => 树.filter((x) => x.d.id !== d.id && x.层 < 部门最多层数).map(({ d: x, 层 }) => ({ value: x.id, label: `${"　".repeat(层 - 1)}${x.name}` }));

  // 上级下拉的空值传 null 不传 undefined：undefined 会让 antd 当不受控，保存失败时框里还留着刚选的人
  const 设 = (id: string, 改: 成员改动) => void 跑(`成员-${id}`, () => 设成员(id, 改), undefined, () => 设成员(id, 改, true));
  const 设格 = (f: 字段名, r: 业务角色, v: keyof typeof 级别名) => {
    const 行 = { ...表[f] };
    if (v === "改") delete 行[r];
    else 行[r] = v;
    const { [f]: _旧, ...别的 } = 表;
    set草稿({ 基于: 页面表, 表: Object.keys(行).length ? { ...别的, [f]: 行 } : 别的 });
  };
  // 「不设配额」选项：同 拨了，先按拨的显示，页面数据变了听页面的
  const [拨了不设, set拨了不设] = useState<{ 基于: boolean | null | undefined; 开: boolean } | null>(null);
  const 不设配额 = 拨了不设 && 拨了不设.基于 === value.线索不设配额 ? 拨了不设.开 : value.线索不设配额 === true;
  const 拨不设 = async (v: boolean) => {
    if (忙("不设配额")) return;
    set拨了不设({ 基于: value.线索不设配额, 开: v });
    const ok = await 跑("不设配额", () => 设不设配额(v), v ? "已改成不设配额：人人参与自动分配、不限额" : "已改回按配额分配");
    if (!ok) set拨了不设(null);
  };
  /**
   * 组织规则开关（原型 st.switch，P-界面-40「组织规则开关」= 后果框）：影响全员，先说清后果再生效，不确认不动；
   * 只这一个开关在等，不锁整页：忙只算这一个开关（规则-名）
   */
  const 拨 = async (名: 规则名, v: boolean) => {
    const 键 = `规则-${名}`;
    if (忙(键)) return;
    占(键, true);
    const 成了 = await 问后果({
      题: `${v ? "打开" : "关掉"}「${规则[名].名}」？`,
      后果: [
        { 标: "全员", 级: "警", 话: v ? 规则[名].说明 : 关掉后果[名] ?? `关掉以后不再按「${规则[名].名}」管，所有人回到没开时的样子` },
        { 标: "能改回", 话: "随时可以再拨回来，已有的客户、项目、记录不会删" },
      ],
      是: v ? "确认打开" : "确认关掉",
      危: !v,
      做: async () => {
        const r = await 设规则(v, 名);
        if (r.ok) set拨了((x) => ({ ...x, [名]: { 基于: value.规则开着[名], 开: v } }));
        return r;
      },
    });
    占(键, false);
    if (成了) 刷新(键);
  };
  const 勾 = (项: 设置项名, 人: 能改的人, v: boolean) => {
    const 现在 = 谁能改(改权限, 项);
    const 可选: readonly 能改的人[] = 设置项[项].可选;
    const 新 = 可选.filter((p) => (p === 人 ? v : 现在.includes(p)));
    set权限草稿({ 基于: 页面改权限, 表: { ...改权限, [项]: 新 } });
  };
  // 市场部门的草稿（10-31）：同上，页面上的值变了就作废
  // 部门和逐人设的（11-01）一起存
  const 单设 = value.市场单设 ?? [];
  const 页面市场 = JSON.stringify([value.市场部门 ?? null, 单设]);
  const [市场草稿, set市场草稿] = useState<{ 基于: string; 选: string[]; 人: string[] } | null>(null);
  const 草稿有效 = 市场草稿 != null && 市场草稿.基于 === 页面市场;
  const 市场选 = 草稿有效 ? 市场草稿.选 : (value.市场部门 ?? []);
  const 市场人 = 草稿有效 ? 市场草稿.人 : 单设;
  const 市场改了 = 草稿有效 && (JSON.stringify(市场选) !== JSON.stringify(value.市场部门 ?? []) || JSON.stringify(市场人) !== JSON.stringify(单设));
  // 按页面上存着的算（不按草稿）：保存后才算数
  const 市场部门现在 = 市场部门们(new Map(value.部门.map((d) => [d.id, d])), value.市场部门 ?? null);
  const 市场成员 = value.成员.filter((m) => (m.deptId && 市场部门现在.has(m.deptId)) || 单设.includes(m.id)).map((m) => m.name);
  const 人选项 = value.成员.map((m) => ({ value: m.id, label: m.name }));
  const 只看表 = value.只看某人 ?? {};
  const 页面副手 = JSON.stringify(value.回收站副手 ?? []);
  const [副手草稿, set副手草稿] = useState<{ 基于: string; 人: string[] } | null>(null);
  const 副手 = 副手草稿 && 副手草稿.基于 === 页面副手 ? 副手草稿.人 : (value.回收站副手 ?? []);
  const 副手改了 = JSON.stringify(副手) !== 页面副手;
  const 页面开票 = JSON.stringify(value.可标已开票 ?? []);
  const [开票草稿, set开票草稿] = useState<{ 基于: string; 人: string[] } | null>(null);
  const 开票人 = 开票草稿 && 开票草稿.基于 === 页面开票 ? 开票草稿.人 : (value.可标已开票 ?? []);
  const 开票改了 = JSON.stringify(开票人) !== 页面开票;
  // 可标已开票的候选（E-373 ②）：只列系统管理员和财务（职位或部门）的人（服务端算好的 可标已开票候选，设可标已开票 照拦）。
  // 已经在名单里、后来不再符合的（调出了财务、改了角色、设了只看某人）照留一项、标明，好让人去掉，不显示成一串编号
  const 开票候选 = new Set(value.可标已开票候选 ?? []);
  const 开票选项 = value.成员.filter((m) => 开票候选.has(m.id) || 开票人.includes(m.id)).map((m) => ({ value: m.id, name: m.name, label: 开票候选.has(m.id) ? m.name : <span title="已不符合条件（调出了财务、改了角色或设了只看某人），勾不进去">{`${m.name}（不能标，请去掉）`}</span> }));
  const 页面无主 = value.无主线索复核人 ?? null;
  const [无主草稿, set无主草稿] = useState<{ 基于: string | null; 人: string | null } | null>(null);
  const 无主 = 无主草稿 && 无主草稿.基于 === 页面无主 ? 无主草稿.人 : 页面无主;
  const 无主改了 = 无主 !== 页面无主;
  const 只看 = !能改 && <span style={{ color: "var(--text-muted)" }}>{value.不管设置 ? "你被设为「不管设置」，这里只能看" : "只有总管理能改"}</span>;

  return (
    // minmax(0, 1fr)：不让 nowrap 的表格把整页撑宽，表格在各自卡片里横向滚动
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)" }}>
      {/* 组织规则单独一块放这一屏最上面（11-01 会议 §5「组织规则放设置首屏」）；通讯录同步挪到它下面、说明收起来（OrgSyncCard）。
          10-27 把通讯录同步提到最上面是因为它夹在权限表下面找不到，现在仍在权限表之前 */}
      {后果框}
      {提示条}
      <Card title="组织规则" extra={只看} data-testid="org-rules">
        <p className="muted">每条规则单独开关，除了{默认开的规则.map((n) => `「${规则[n].名}」`).join("")}都默认关着：关着时按原来的方式看客户。先把下面的部门和上级填好再打开。</p>
        {/* 每条：开关 + 名字一行，说明在下面（globals.css .org-rule：电脑上说明缩进对齐名字，手机 390 宽下说明占满整行、不挤成一窄列） */}
        <div className="org-rules">
          {规则名们.map((名) => {
            // 「主动放弃」跟着「线索分配和配额」（设置开关 11-23）：父开关关着只拦「打开」，开着的照样能关
            const 打不开 = 名 === "主动放弃" && !开着("线索分配") && !开着(名);
            const 不起作用 = 名 === "主动放弃" && !开着("线索分配") && 开着(名);
            return (
            <div className="org-rule" key={名}>
              <Switch checked={开着(名)} disabled={!能改 || 忙(`规则-${名}`) || 打不开} aria-label={规则[名].名} data-testid={规则testid[名]}
                title={打不开 ? 父关着打不开(规则.线索分配.名) : undefined}
                onChange={(v) => void 拨(名, v)} />
              <b className="org-rule-name">{规则[名].名}</b>
              <p className="muted org-rule-say">{规则[名].说明}</p>
              {(打不开 || 不起作用) && (
                <p className="org-rule-say org-rule-lock" role="note">
                  {父关着打不开(规则.线索分配.名)}{不起作用 ? "；现在开着不起作用，可以关掉" : "，现在打不开"}
                </p>
              )}
              {/* 规则开着才有这个选项（10-30）：开了以后配额不起作用，下面「线索分配」里配额框灰掉 */}
              {名 === "线索分配" && 开着(名) && value.线索不设配额 != null && (
                <div className="org-rule org-rule-sub">
                  <Switch size="small" checked={不设配额} disabled={!能改 || 忙("不设配额")} aria-label="不设配额（人人参与、不限额）"
                    data-testid="org-rule-lead-no-quota" onChange={(v) => void 拨不设(v)} />
                  <span className="org-rule-name">不设配额（人人参与、不限额）</span>
                  <p className="muted org-rule-say">
                    开了以后：自动分配在参与的销售里挑本月已分最少的，一样多先给最早进分配池的；手动分也不查满额。设过的配额留着，关掉就照旧按配额分。
                  </p>
                </div>
              )}
            </div>
            );
          })}
        </div>
      </Card>

      {value.线索分配 && <LeadAssignCard rows={value.线索分配} 不限额={不设配额} />}
      {value.线索分配 && <LineDeptCard 部门={value.部门} 部门选项={部门选项} 成员={value.成员} />}

      {能改 && <OrgSyncCard />}

      <Card title="字段权限" extra={字段权限挡 && <span style={{ color: "var(--text-muted)" }}>{字段权限挡}</span>}>
        <p className="muted">
          打开上面的「{规则.字段权限.名}」才生效。每格是这个角色对这个字段能做什么：能改、只能看；电话还能选看不到（页面、导出、AI 助手里都打码）。
          没动过的格都是能改。总管理不受限。「用推荐表」填的是我们建议的默认（成交段渠道、市场只能看，项目组员只改备注），保存后再打开规则。
        </p>
        <div style={{ overflowX: "auto" }}>
          <table className="org-field-perm" data-testid="org-field-perm">
            <thead>
              <tr>
                <th>字段</th>
                {业务角色.map((r) => <th key={r}>{角色名[r]}</th>)}
              </tr>
            </thead>
            <tbody>
              {字段名们.map((f) => (
                <tr key={f}>
                  <th scope="row">{字段[f].名}<div className="muted">{字段[f].用在}</div></th>
                  {业务角色.map((r) => r === "coach" ? (
                    // 销售教练的字段级别固定（Q9，field-perm-table.ts 教练字段级别）：不进配置表
                    <td key={r} className="muted" data-testid={`org-field-perm-coach-${f}`}>{级别名[教练字段级别(f)]}</td>
                  ) : (
                    <td key={r}>
                      <Select size="small" style={{ minWidth: 76 }} aria-label={`${角色名[r]} 对「${字段[f].名}」`} disabled={!!字段权限挡 || 忙("字段权限")}
                        value={字段级别of(表, f, r)} onChange={(v) => 设格(f, r, v)}
                        options={(字段[f].能藏 ? (["改", "看", "藏"] as const) : (["改", "看"] as const)).map((x) => ({ value: x, label: 级别名[x] }))} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!字段权限挡 && (
          <Space wrap style={{ marginTop: 12 }}>
            <SaveButton disabled={!表改了 || 忙("字段权限")} data-testid="org-field-perm-save" 做={() => 存("字段权限", () => 设字段权限(表))}>保存字段权限</SaveButton>
            <Button disabled={!表改了 || 忙("字段权限")} onClick={() => set草稿(null)}>放弃修改</Button>
            <Button disabled={忙("字段权限")} data-testid="org-field-perm-suggest" onClick={() => set草稿({ 基于: 页面表, 表: 推荐字段配置 })}>用推荐表</Button>
          </Space>
        )}
      </Card>

      <Card title="后台设置谁能改" extra={只看}>
        <p className="muted">
          勾上的人能改，没勾的只能看。系统管理员都能改，不在表里；项目模式的其它设置只有系统管理员能改。
          「直属上级」「虚线上级」只能给自己的下属设。
        </p>
        <div style={{ overflowX: "auto" }}>
          <table className="org-field-perm" data-testid="org-edit-perm">
            <thead>
              <tr>
                <th>设置</th>
                {人列.map((p) => <th key={p}>{人列名(p)}</th>)}
              </tr>
            </thead>
            <tbody>
              {设置项们.filter((项) => 设置项[项].可选.length > 0).map((项) => {
                const 谁 = 谁能改(改权限, 项);
                const 可选: readonly 能改的人[] = 设置项[项].可选;
                return (
                  <tr key={项} data-testid={`org-edit-perm-${项}`}>
                    <th scope="row">{设置项[项].名}</th>
                    {人列.map((p) => (
                      <td key={p}>
                        {可选.includes(p) ? (
                          <Checkbox checked={谁.includes(p)} disabled={!能改 || 忙("改权限")} aria-label={`${人列名(p)} 能改「${设置项[项].名}」`}
                            onChange={(e) => 勾(项, p, e.target.checked)} />
                        ) : <span className="muted">—</span>}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {能改 && (
          <Space wrap style={{ marginTop: 12 }}>
            <SaveButton disabled={!改权限改了 || 忙("改权限")} data-testid="org-edit-perm-save" 做={() => 存("改权限", () => 设改权限(改权限))}>保存</SaveButton>
            <Button disabled={!改权限改了 || 忙("改权限")} onClick={() => set权限草稿(null)}>放弃修改</Button>
          </Space>
        )}
      </Card>


      <Card title="部门" extra={只看}>
        <p className="muted">部门最多 {部门最多层数} 层。上级只认每个人手填的「直属上级」，没填就是没有上级，不按部门推。</p>
        <div className="team-dept-tree" data-testid="org-depts">
          {树.length === 0 && <p className="muted">还没有部门。</p>}
          {树.map(({ d, 层: n, 断 }) => (
            /* 名字占一格定宽、缩进只在格子里：子部门前面画一道折线，按钮列上下对齐（10-28 用户：内贸一组看着没对齐）；
               名字太长一行显示，放不下「…」，悬停看全文（11-04 用户：待定第 4 点「其他的都按照优化来进行」） */
            <div key={d.id} className="team-dept-row">
              <span className="team-dept-name" style={{ paddingLeft: (n - 1) * 20 }}>
                {n > 1 && <span className="team-dept-branch" aria-hidden>└</span>}
                <span className="team-dept-text">{d.name}</span>
              </span>
              {断 && <Tag color="warning">上级断了</Tag>}
              {能改 && (
                <span className="team-dept-acts">
                  {n < 部门最多层数 && !断 && <Button size="small" type="link" onClick={() => set编({ 建在: d.id, 名: "", 上级: d.id })}>加子部门</Button>}
                  <Button size="small" type="link" onClick={() => set编({ 改: d.id, 名: d.name, 上级: d.parentId })}>改</Button>
                  <InlineConfirm 问="有子部门或人时删不了" 是="删" 做={() => 跑("部门", () => 删部门(d.id), `删了部门「${d.name}」`).then((ok) => ({ ok }))}>
                    <Button size="small" type="link" danger>删</Button>
                  </InlineConfirm>
                </span>
              )}
              {编 && (编.改 === d.id || 编.建在 === d.id) && (
                <div className="team-dept-edit" role="group" aria-label={编.改 ? `改部门「${d.name}」` : `在「${d.name}」下面建子部门`}>
                  <Input autoFocus size="small" maxLength={40} aria-label="部门名字" placeholder="部门名字，如：内贸一组" value={编.名}
                    onChange={(e) => set编({ ...编, 名: e.target.value })} onPressEnter={() => void 存编()}
                    onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); set编(null); } }} />
                  {编.改 && (
                    <Select size="small" className="team-dept-parent" aria-label="上级部门" value={编.上级 ?? "__顶"}
                      options={[{ value: "__顶", label: "（一级部门，没有上级）" }, ...可挪到(d)]} onChange={(v: string) => set编({ ...编, 上级: v === "__顶" ? null : v })} />
                  )}
                  <Button size="small" type="primary" disabled={!编.名.trim() || 忙("部门")} loading={忙("部门")} onClick={() => void 存编()}>{编.改 ? "保存" : "建"}</Button>
                  <Button size="small" onClick={() => set编(null)}>取消</Button>
                </div>
              )}
            </div>
          ))}
          {能改 && (
            <Space.Compact style={{ width: "100%", maxWidth: 360, marginTop: 8 }}>
              <Input value={新名} onChange={(e) => set新名(e.target.value)} placeholder="新的一级部门，如：外贸部" maxLength={40} aria-label="新的一级部门"
                onPressEnter={() => 新名.trim() && void 跑("部门", () => 建部门(新名, null)).then((ok) => ok && set新名(""))} />
              <Button disabled={!新名.trim() || 忙("部门")} onClick={() => void 跑("部门", () => 建部门(新名, null)).then((ok) => ok && set新名(""))}>建部门</Button>
            </Space.Compact>
          )}
        </div>
      </Card>

      <Card title="市场部门和市场成员" extra={只看} data-testid="org-market-depts">
        <p className="muted">
          打开「{规则.按组织看客户.名}」才生效。这几个部门（连下级部门）的人算市场成员：自己建的、建过项目的、负责过的客户，转给销售以后还看得到这位客户和市场成员自己建的项目，只能看，不能改、不能记沟通、不能转。
          市场管理看得到所有市场成员看得到的。没设 = 名字带「市场」的部门和下级。市场成员建的项目，线索验证判无效照旧交市场复核。
        </p>
        <Select mode="multiple" allowClear style={{ width: "100%", maxWidth: 480 }} aria-label="市场部门" disabled={!能改 || 忙("市场")}
          placeholder="没设：名字带「市场」的部门和下级" optionFilterProp="label"
          value={市场选} onChange={(v: string[]) => set市场草稿({ 基于: 页面市场, 选: v, 人: 市场人 })}
          options={部门选项} />
        <p className="muted" style={{ margin: "12px 0 4px" }}>另外单独算市场成员的人（部门不用动，比如岗位调整试行期的人）：</p>
        <Select mode="multiple" allowClear style={{ width: "100%", maxWidth: 480 }} aria-label="单独设的市场成员" disabled={!能改 || 忙("市场")}
          placeholder="没有" optionFilterProp="label" data-testid="org-market-users"
          value={市场人} onChange={(v: string[]) => set市场草稿({ 基于: 页面市场, 选: 市场选, 人: v })}
          options={人选项} />
        <p className="muted" style={{ margin: "8px 0 0" }} data-testid="org-market-members">
          现在算市场成员的：{市场成员.length ? 市场成员.join("、") : "没有"}
        </p>
        {能改 && (
          <Space wrap style={{ marginTop: 12 }}>
            <SaveButton disabled={!市场改了 || 忙("市场")} data-testid="org-market-depts-save" 做={() => 存("市场", () => 设市场部门(市场选, 市场人))}>保存</SaveButton>
            <Button disabled={!市场改了 || 忙("市场")} onClick={() => set市场草稿(null)}>放弃修改</Button>
            <Button disabled={value.市场部门 == null || 忙("市场")} onClick={() => void 跑("市场", () => 设市场部门([]), "已恢复默认：名字带「市场」的部门")}>恢复默认</Button>
          </Space>
        )}
      </Card>

      <Card title="回收站副手" extra={只看} data-testid="org-trash-helpers">
        <p className="muted">系统管理员之外，这些人也能看回收站、恢复删掉的数据（只看得到平时看得到的）；彻底删除仍只有系统管理员。</p>
        <Select mode="multiple" allowClear style={{ width: "100%", maxWidth: 480 }} aria-label="回收站副手" disabled={!能改 || 忙("副手")}
          placeholder="没有" optionFilterProp="label"
          value={副手} onChange={(v: string[]) => set副手草稿({ 基于: 页面副手, 人: v })}
          options={人选项} />
        {能改 && (
          <Space wrap style={{ marginTop: 12 }}>
            <SaveButton disabled={!副手改了 || 忙("副手")} data-testid="org-trash-helpers-save" 做={() => 存("副手", () => 设回收站副手(副手))}>保存</SaveButton>
            <Button disabled={!副手改了 || 忙("副手")} onClick={() => set副手草稿(null)}>放弃修改</Button>
          </Space>
        )}
      </Card>

      <Card title="可标已开票" extra={只看} data-testid="org-invoice-markers" data-set-find="已开票 开票">
        <p className="muted">系统管理员之外，这些人也能在项目上勾「已开票」，看得到的项目都能勾（勾了的项目不能合并）；撤回仍只有系统管理员，限勾上后 30 天内，过了 30 天谁都不能改。只能选系统管理员和财务（职位是财务，或在财务部门）的人。点名字上的 × 再保存就收回，他之前勾的照旧留在项目和历史变更里。</p>
        <Select mode="multiple" allowClear className="org-pick" aria-label="可标已开票" disabled={!能改 || 忙("开票")}
          placeholder="没有（只有系统管理员能勾）" optionFilterProp="name"
          value={开票人} onChange={(v: string[]) => set开票草稿({ 基于: 页面开票, 人: v })}
          options={开票选项} />
        {能改 && (
          <Space wrap className="org-save-row">
            <SaveButton disabled={!开票改了 || 忙("开票")} data-testid="org-invoice-markers-save" 做={() => 存("开票", () => 设可标已开票(开票人))}>保存</SaveButton>
            <Button disabled={!开票改了 || 忙("开票")} onClick={() => set开票草稿(null)}>放弃修改</Button>
          </Space>
        )}
      </Card>

      <Card title="无主线索复核人" extra={只看} data-testid="org-orphan-reviewer">
        <p className="muted">线索判无效、交市场复核时，先找建这条线索的市场成员和他的直属市场管理，再找客户创建人和他的直属市场管理；都找不到（系统补建的、建的人离职了又没有直属市场管理）就交给这位复核、发通知给他。没设交系统管理员。</p>
        <Select allowClear showSearch className="org-pick" aria-label="无主线索复核人" disabled={!能改 || 忙("无主")}
          placeholder="没设（交系统管理员）" optionFilterProp="label"
          value={无主 ?? undefined} onChange={(v?: string) => set无主草稿({ 基于: 页面无主, 人: v ?? null })}
          options={人选项} />
        {能改 && (
          <Space wrap className="org-save-row">
            <SaveButton disabled={!无主改了 || 忙("无主")} data-testid="org-orphan-reviewer-save" 做={() => 存("无主", () => 设无主线索复核人(无主))}>保存</SaveButton>
            <Button disabled={!无主改了 || 忙("无主")} onClick={() => set无主草稿(null)}>放弃修改</Button>
          </Space>
        )}
      </Card>

      <Card title="每个人的部门、角色和上级" extra={只看} data-set-find="直属上级 虚线上级 业务角色 只看某人">
        <p className="muted">业务线用来分线索：内贸线索只分给内贸的人，外贸同理，「两边都做」两种都能分到。虚线上级只能看他的客户，不能改、不能转。
          「只看某人」：这个人只看选中的人建的、负责的数据（公海照常），不当负责人、不能改；设了的人不能当别人的直属上级。</p>
        <ul className="team-dept-members" data-testid="org-members">
          {value.成员.map((m) => {
            const 他的角色 = 拆角色(m.bizRole);
            const 改他 = 能改 && (是老板 || !他的角色.some(总管级));
            const 别人 = value.成员.filter((x) => x.id !== m.id).map((x) => ({ value: x.id, label: x.name }));
            return (
              <li key={m.id} data-testid={`org-member-${m.id}`}>
                <b>{m.name}</b>
                <Select size="small" style={{ minWidth: 120 }} aria-label={`${m.name} 的部门`} disabled={!改他 || 忙(`成员-${m.id}`)}
                  value={m.deptId ?? "__无"} onChange={(v) => 设(m.id, { deptId: v === "__无" ? null : v })}
                  labelRender={({ value: v }) => 名.get(String(v)) ?? "未分部门"}
                  options={[{ value: "__无", label: "未分部门" }, ...部门选项]} />
                {/* 业务角色可多选（10-27）：一个人兼销售管理和市场管理之类；至少留一个，清空不交 */}
                <BizRoleSelect size="small" style={{ minWidth: 150, maxWidth: 320 }} aria-label={`${m.name} 的角色`} disabled={!改他 || 忙(`成员-${m.id}`)}
                  // Q10：销售教练不兼销售类角色，撞了的那几项灰掉（BizRoleSelect 按 角色组合问题；服务端 设成员 同样挡）
                  value={他的角色} onChange={(v) => { if (v.length && !角色组合问题(v)) 设(m.id, { bizRole: 合角色(v) }); }}
                  能给总管级={是老板} />
                <Select size="small" style={{ minWidth: 110 }} aria-label={`${m.name} 的业务线`} disabled={!改他 || 忙(`成员-${m.id}`)}
                  value={m.line ?? "__都"} onChange={(v) => 设(m.id, { line: v === "__都" ? null : v })}
                  options={[{ value: "__都", label: "两边都做" }, { value: "内贸", label: "内贸" }, { value: "外贸", label: "外贸" }]} />
                <Select size="small" style={{ minWidth: 140 }} allowClear showSearch optionFilterProp="label" aria-label={`${m.name} 的直属上级`} disabled={!改他 || 忙(`成员-${m.id}`)}
                  placeholder="直属：没有"
                  value={m.managerId ?? null} onChange={(v) => 设(m.id, { managerId: v ?? null })}
                  options={别人.map((x) => ({ ...x, label: `直属：${x.label}` }))} />
                <Select size="small" style={{ minWidth: 140 }} allowClear showSearch optionFilterProp="label" aria-label={`${m.name} 的虚线上级`} disabled={!改他 || 忙(`成员-${m.id}`)}
                  placeholder="虚线上级（只能看）"
                  value={m.dottedManagerId ?? null} onChange={(v) => 设(m.id, { dottedManagerId: v ?? null })}
                  options={别人.map((x) => ({ ...x, label: `虚线：${x.label}` }))} />
                <Select size="small" style={{ minWidth: 140 }} allowClear showSearch optionFilterProp="label" aria-label={`${m.name} 只看某人`} disabled={!改他 || 忙(`成员-${m.id}`)}
                  placeholder="只看某人：没设"
                  value={只看表[m.id] ?? null} onChange={(v) => void 跑(`成员-${m.id}`, () => 设只看某人(m.id, v ?? null), v ? "已设「只看某人」" : "已取消「只看某人」")}
                  options={别人.map((x) => ({ ...x, label: `只看：${x.label}` }))} />
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
