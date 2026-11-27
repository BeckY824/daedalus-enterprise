"use client";
/**
 * 设置 →「开关总览」（设置开关 N1，11-23 定稿；原型 原型-设置开关-20261123.html）：影响全公司的开关一处看、一处改。
 * **只给系统管理员**（P-全局-02）：目录里只有系统管理员有这一项，数据走 开关现状() / 读开关改动()，两个都在服务端判「能进设置」。
 *
 * - 顶上分组总览：每组一张小卡，一行一个开关 + 现值，点了跳到下面那张卡亮一下
 * - 搜索（别名，搜「卡点」「分配方式」给一条去项目模式）、筛选（全部 / 开着 / 关着 / 和默认不同）
 * - 下面按组排开关卡；**所有卡左边对齐**（用户 11-23），子开关在卡头写「属于：线索分配和配额」，不靠缩进
 * - 拨开关调原卡片用的同一个 action；后果框文案同 switch-table.ts；超时回收、持有上限打开前先数（use-count-confirm.tsx，和原卡共用）
 * - 父开关关着：子开关只拦「打开」，开着的照样能关
 * - 持有上限不放输入框：只读显示默认上限和单设人数 +「去项目模式改」（原卡点「保存」才存）
 * - 每卡「上次：谁 · 几点 · 打开 / 关掉」一行（读开关改动）；组织规则比不出的只写「操作日志里比不出」
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Input, Radio, Switch } from "antd";
import { useConsequence } from "@/components/ConsequenceDialog";
import { useSettingsNote } from "./InlineNote";
import { useCountConfirm } from "./use-count-confirm";
import { 开关现状, 读开关改动, type 开关现状 as 现状型, type 一次改动 } from "./switch-actions";
import { 设规则, 设通讯录同步 } from "./org-actions";
import { 设不设配额, 设扫库检测, 设重复咨询自动落定 } from "../leads/assign-actions";
import { 改组织规则 } from "@/app/(app)/projects/actions";
import { 设飞书推送 } from "../notice-actions";
import { 设录音点评开关 } from "./asr-actions";
import {
  开关表, 开关of, 开关组们, 指路们, 原页签名, 改的人, 影响话, 开关后果of, 改回全部项目后果, 父关着打不开,
  type 开关键, type 开关定义, type 原页签,
} from "@/lib/enterprise/switch-table";
import type { 规则名 } from "@/lib/enterprise/rules-table";
import type { 推进权限 } from "@/lib/project/org-rules";
import { 是不限 } from "@/lib/project/org-rules";
import { 滚法 } from "@/lib/reduced-motion";
import { 动作出错话 } from "@/lib/stale-deploy";

type 结果 = { ok: boolean; error?: string };
type 筛 = "all" | "on" | "off" | "chg";

/** 组织规则那 7 条：总览开关键 → 规则名（设规则 的第二个参数） */
const 规则名of: Partial<Record<开关键, 规则名>> = {
  org_scope: "按组织看客户", field_perm: "字段权限", lead_assign: "线索分配", market_review: "市场复核", reply_overdue: "超时自动转", lead_giveup: "主动放弃", block_meaningless: "无意义沟通拦",
};

/** 北京时间的「今天 09:30 / 昨天 / 11 月 3 日」 */
function 时间话(iso: string): string {
  const 北京 = (t: number) => new Date(t + 8 * 3600e3);
  const a = 北京(new Date(iso).getTime()), n = 北京(Date.now());
  const hm = `${String(a.getUTCHours()).padStart(2, "0")}:${String(a.getUTCMinutes()).padStart(2, "0")}`;
  const 天 = Math.round((Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()) - Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())) / 864e5);
  if (天 === 0) return `今天 ${hm}`;
  if (天 === 1) return `昨天 ${hm}`;
  if (a.getUTCFullYear() === n.getUTCFullYear()) return `${a.getUTCMonth() + 1} 月 ${a.getUTCDate()} 日 ${hm}`;
  return `${a.getUTCFullYear()} 年 ${a.getUTCMonth() + 1} 月 ${a.getUTCDate()} 日 ${hm}`;
}

/** 一条依赖（要先有的）：好了打勾，没好橙色 + 可点的去处 */
type 依赖 = { ok: boolean; 话: string; 去?: { tab: 原页签; 找: string; 钮: string }; 跳?: 开关键 };

export default function SwitchesTab({ 去卡 }: { 去卡: (tab: 原页签, 找: string) => void }) {
  const router = useRouter();
  const [就地, 提示条] = useSettingsNote();
  const [问后果, 后果框] = useConsequence();
  const [先数, 数框] = useCountConfirm();
  const [现状, set现状] = useState<现状型 | null>(null);
  const [错, set错] = useState<string | null>(null);
  const [上次, set上次] = useState<Partial<Record<开关键, 一次改动>>>({});
  const [忙, set忙] = useState<开关键 | null>(null);
  const [搜, set搜] = useState("");
  const [筛, set筛] = useState<筛>("all");
  const 根 = useRef<HTMLDivElement>(null);

  const 用上 = useCallback((a: Awaited<ReturnType<typeof 开关现状>>, b: Awaited<ReturnType<typeof 读开关改动>>) => {
    if (!a || !a.ok) return void set错((a && "error" in a && a.error) || "读不到开关，请刷新再试");
    set现状(a);
    set错(null);
    if (b && b.ok) set上次(b.上次);
  }, []);
  const 取 = () => Promise.all([开关现状(), 读开关改动()]);
  /** 拨完重读：总览、上次那行跟着变 */
  const 读 = async () => {
    try {
      const [a, b] = await 取();
      用上(a, b);
    } catch (e) {
      set错(动作出错话(e, "读不到开关，请刷新再试"));
    }
  };
  useEffect(() => {
    let 还在 = true;
    取().then(([a, b]) => 还在 && 用上(a, b)).catch((e) => 还在 && set错(动作出错话(e, "读不到开关，请刷新再试")));
    return () => { 还在 = false; };
  }, [用上]);

  const 值 = 现状?.值;
  const 开着 = (k: 开关键) => 值?.[k] === true;
  const 改过 = (s: 开关定义) => 值 !== undefined && 值[s.k] !== s.默认;
  /** 父开关关着、自己也关着：打不开 */
  const 打不开 = (s: 开关定义) => !!s.parent && !开着(s.parent) && !开着(s.k);
  /** 父开关关着、自己开着：不起作用，能关 */
  const 不起作用 = (s: 开关定义) => !!s.parent && !开着(s.parent) && 开着(s.k);

  function 值话(s: 开关定义): string {
    if (!现状 || !值) return "";
    if (s.opts) return String(值[s.k]);
    if (!开着(s.k)) return "关";
    if (s.k === "hold_cap") {
      const { 默认上限: c, 单设人数: n } = 现状.持有上限;
      if (是不限(c) && !n) return "开 · 不限";
      return `开 · 默认${是不限(c) ? "不限" : ` ${c} 个`}${n ? `，${n} 人单设` : ""}`;
    }
    if (s.k === "node_advance") return 现状.节点推进.范围 === "新建" ? "开 · 新建的" : "开 · 全部项目";
    if (s.k === "field_perm" && !现状.字段权限表改过) return "开 · 表没改过";
    if (不起作用(s)) return "开 · 不起作用";
    return "开";
  }

  function 依赖们(s: 开关定义): 依赖[] {
    if (!现状) return [];
    switch (s.k) {
      case "field_perm":
        return [现状.字段权限表改过 ? { ok: true, 话: "字段权限表改过" } : { ok: false, 话: "表还没改过，格子都是「能改」，开着也等于不限", 去: { tab: "org", 找: "字段权限", 钮: "去填表" } }];
      case "node_advance":
        return [现状.节点推进.必填进程数 ? { ok: true, 话: `${现状.节点推进.必填进程数} 个进程配了必填` } : { ok: false, 话: "还没给进程配必填，开着也不拦人", 去: { tab: "project", 找: "节点推进", 钮: "去配必填" } }];
      case "push_perm":
        return [开着("org_scope")
          ? { ok: true, 话: "跟着「按组织架构看客户」走（现在开着）；只对有直属上级的负责人生效；总管理照旧能推" }
          : { ok: false, 话: "「按组织架构看客户」关着：选了「仅上级推」也不起作用，谁的项目谁推", 跳: "org_scope" }];
      case "node_timeout": {
        const { 内贸进程数: a, 外贸进程数: b } = 现状.超时回收;
        return [{ ok: true, 话: `内贸 ${a} 个、外贸 ${b} 个进程单独填了天数${现状.超时回收.起算日 ? `；从 ${现状.超时回收.起算日} 起算` : ""}` }];
      }
      case "feishu_push":
        return [现状.飞书.推送凭据齐了 ? { ok: true, 话: "App ID / Secret 已填" } : { ok: false, 话: "还没填飞书 App ID / Secret，打不开", 去: { tab: "org", 找: "通讯录同步", 钮: "去填" } }];
      case "sync_feishu":
        return [现状.飞书.通讯录凭据齐了
          ? { ok: true, 话: `连接凭据已填；${现状.飞书.通讯录间隔分钟 === 30 ? "每半小时" : "每小时"}拉一次` }
          : { ok: false, 话: "还没填飞书连接凭据，打不开", 去: { tab: "org", 找: "通讯录同步", 钮: "去填" } }];
      case "coach_rec":
        return [
          现状.录音.能打开 ? { ok: true, 话: "腾讯云密钥、ffmpeg 都好了" } : { ok: false, 话: `腾讯云密钥${现状.录音.密钥 === "已配置" ? "已配" : "没配好"}或 ffmpeg 没装好，打不开`, 去: { tab: "ai", 找: "录音点评", 钮: "去看" } },
          ...(现状.录音.测过 ? [] : [{ ok: false, 话: "还没测过连接", 去: { tab: "ai" as const, 找: "录音点评", 钮: "去测" } }]),
        ];
      default:
        return [];
    }
  }

  /** 缺凭据时打不开（开着的照样能关），同原卡 */
  const 缺东西 = (s: 开关定义) => !!现状 && !开着(s.k) && (
    (s.k === "feishu_push" && !现状.飞书.推送凭据齐了) || (s.k === "sync_feishu" && !现状.飞书.通讯录凭据齐了) || (s.k === "coach_rec" && !现状.录音.能打开));

  /** 跑一个 action：成了就地一句、重读总览、刷新页面（原卡跟着变）；没成就地写原因。回给后果框 */
  const 跑 = async (k: 开关键, f: () => Promise<unknown>, 成了: string): Promise<结果> => {
    set忙(k);
    try {
      const r = (await f()) as 结果 & { 收回?: number };
      if (!r?.ok) return { ok: false, error: r?.error || "没改成，请稍后再试" };
      就地.success(r.收回 ? `${成了}，${r.收回} 个项目回到了线索公海` : 成了);
      await 读();
      router.refresh();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: 动作出错话(e, "没改成，请稍后再试") };
    } finally {
      set忙(null);
    }
  };
  /** 不经后果框直接跑的：没成写在就地小条里 */
  const 直接跑 = async (k: 开关键, f: () => Promise<unknown>, 成了: string) => {
    const r = await 跑(k, f, 成了);
    if (!r.ok) 就地.error(r.error);
  };

  const 动作of = (k: 开关键, v: boolean | string): (() => Promise<unknown>) => {
    const 名 = 规则名of[k];
    if (名) return () => 设规则(v === true, 名);
    switch (k) {
      case "no_quota": return () => 设不设配额(v === true);
      case "scan_detect": return () => 设扫库检测(v === true);
      case "verify_autosettle": return () => 设重复咨询自动落定(v === true);
      case "node_advance": return () => 改组织规则({ 节点推进: { 开: v === true } });
      case "first_two": return () => 改组织规则({ 阶段: { 前两节点要沟通: v === true } });
      case "fill_period": return () => 改组织规则({ 阶段: { 需求补全期: v === true } });
      case "record_only": return () => 改组织规则({ 阶段: { 仅记录用: v === true } });
      case "push_perm": return () => 改组织规则({ 阶段: { 推进权限: v as 推进权限 } });
      case "hold_cap": return () => 改组织规则({ 公海: { 持有上限开: v === true } });
      case "node_timeout": return () => 改组织规则({ 超时回收: { 开: v === true } });
      case "record_only_recall": return () => 改组织规则({ 超时回收: { 仅记录用也回收: v === true } });
      case "tri_state": return () => 改组织规则({ 三态: { 开: v === true } });
      case "feishu_push": return () => 设飞书推送(v === true);
      case "sync_feishu": return () => 设通讯录同步("feishu", v === true);
      case "coach_rec": return () => 设录音点评开关(v === true);
      default: return async () => ({ ok: false, error: "没有这个开关" });
    }
  };

  const 拨 = async (s: 开关定义, v: boolean | string) => {
    if (!现状 || 忙) return;
    const 动词 = s.opts ? `已改成「${v}」` : v ? `已打开「${s.名}」` : `已关掉「${s.名}」`;
    const f = 动作of(s.k, v);
    // 只多一个入口的、持有上限关掉：一步完成
    if (s.小 || (v === false && s.关不问)) return void 直接跑(s.k, f, 动词);
    // 会当场动数据的：先数再问（和原卡同一个钩子）
    // 「仅记录用也回收」（X-147）打开也可能当场多收一批：同样先数
    if ((s.k === "node_timeout" || s.k === "record_only_recall") && v === true) {
      const r = await 先数.超时回收(s.k === "node_timeout" ? { 超时回收: { 开: true } } : { 超时回收: { 仅记录用也回收: true } }, () => 跑(s.k, f, 动词));
      if (r && !r.ok) 就地.error(r.error);
      return;
    }
    if (s.k === "hold_cap" && v === true) return void 先数.持有上限(现状.组织规则.公海, 现状.持有上限.到上限, () => 跑(s.k, f, 动词));
    const 注意 = 依赖们(s).filter((d) => !d.ok).map((d) => d.话);
    void 问后果({
      ...开关后果of(s.k, v, {
        全员: 现状.全员, 按组织看客户: 开着("org_scope"), 注意,
        开着的子开关: 开关表.filter((x) => x.parent === s.k && 开着(x.k)).map((x) => x.k),
        节点推进范围: 现状.节点推进.范围,
      }),
      做: () => 跑(s.k, f, 动词),
    });
  };

  const 改范围 = (范围: "全部" | "新建") => {
    if (!现状 || 范围 === 现状.节点推进.范围) return;
    const f = () => 改组织规则({ 节点推进: { 范围 } });
    if (范围 === "新建") return void 直接跑("node_advance", f, "已改成只管开启之后新建的");
    void 问后果({ ...改回全部项目后果(现状.全员), 做: () => 跑("node_advance", f, "已改成管全部项目") });
  };

  /** 跳到下面那张卡、亮一下；搜着、筛着看不到那张时先清掉 */
  const 跳 = (k: 开关键) => {
    const 找 = () => 根.current?.querySelector<HTMLElement>(`#sw-${k}`) ?? null;
    const 去 = (el: HTMLElement) => {
      el.scrollIntoView({ block: "start", behavior: 滚法() });
      el.classList.remove("set-hit");
      void el.offsetWidth;
      el.classList.add("set-hit");
      window.setTimeout(() => el.classList.remove("set-hit"), 1500);
      el.querySelector<HTMLElement>("[role=switch]:not([disabled]), input[type=radio]")?.focus({ preventScroll: true });
    };
    const el = 找();
    if (el) return 去(el);
    set搜("");
    set筛("all");
    window.requestAnimationFrame(() => { const x = 找(); if (x) 去(x); });
  };

  const 词 = 搜.trim().toLowerCase();
  const 命中 = useCallback((s: 开关定义) => !词 || [s.名, s.alias, s.what, s.位 ?? "", 开关组们.find((g) => g.id === s.g)!.名].join(" ").toLowerCase().includes(词), [词]);
  const 过筛 = (s: 开关定义) =>
    筛 === "on" ? !s.opts && 开着(s.k) : 筛 === "off" ? !s.opts && !开着(s.k) : 筛 === "chg" ? 改过(s) : true;
  const 看 = 开关表.filter((s) => 命中(s) && 过筛(s));
  const 路 = useMemo(() => (词 ? 指路们.filter((p) => p.词.some((w) => 词.includes(w.toLowerCase())) || p.名.toLowerCase().includes(词)) : []), [词]);

  if (错) return <div className="sw-empty" role="alert">{错}</div>;
  if (!现状) return <div className="sw-empty" aria-busy="true">正在读开关…</div>;

  const 二值 = 开关表.filter((s) => !s.opts);
  const 开数 = 二值.filter((s) => 开着(s.k)).length;
  const 组块 = 开关组们.map((g) => ({ g, 项: 看.filter((s) => s.g === g.id) })).filter((x) => x.项.length);
  const chips: [筛, string, number][] = [["all", "全部", 开关表.length], ["on", "开着", 开数], ["off", "关着", 二值.length - 开数], ["chg", "和默认不同", 开关表.filter(改过).length]];

  const 卡 = (s: 开关定义) => {
    const 锁 = 打不开(s), 空着 = 不起作用(s), 缺 = 缺东西(s), 最近 = 上次[s.k];
    const 默认话 = typeof s.默认 === "string" ? s.默认 : s.默认 ? "开" : "关";
    const 依 = 依赖们(s);
    return (
      <article key={s.k} id={`sw-${s.k}`} className="sw-card" data-testid={`sw-card-${s.k}`} aria-labelledby={`sw-name-${s.k}`}>
        <div className="sw-top">
          <div className="sw-titles">
            {s.parent && <span className="sw-tag" data-testid={`sw-parent-${s.k}`}>属于：{开关of[s.parent].名}</span>}
            <h4 className="sw-name" id={`sw-name-${s.k}`}>
              <span>{s.名}</span>
              {改过(s) && <span className="sw-tag sw-tag-blue" title={`没拨过时是「${默认话}」`}>和默认不同</span>}
            </h4>
            <p className="sw-what">{s.what}</p>
          </div>
          {!s.opts && (
            <Switch
              checked={开着(s.k)}
              loading={忙 === s.k}
              disabled={!!忙 || 锁 || 缺}
              aria-label={s.名}
              title={锁 ? 父关着打不开(开关of[s.parent!].名) : undefined}
              onChange={(v) => void 拨(s, v)}
            />
          )}
        </div>
        {s.opts && (
          <div className="sw-sub">
            <Radio.Group
              optionType="button" size="small" aria-label={s.名} disabled={!!忙}
              value={值![s.k]}
              onChange={(e) => void 拨(s, e.target.value as string)}
              options={s.opts.map(([v]) => ({ value: v, label: v }))}
            />
            <span className="sw-muted">{s.opts.find(([v]) => v === 值![s.k])?.[1]}</span>
          </div>
        )}
        {s.k === "node_advance" && 开着(s.k) && (
          <div className="sw-sub">
            <span>管哪些项目</span>
            <Radio.Group
              optionType="button" size="small" aria-label="节点推进管哪些项目" disabled={!!忙}
              value={现状.节点推进.范围}
              onChange={(e) => 改范围(e.target.value as "全部" | "新建")}
              options={[{ value: "全部", label: "全部项目" }, { value: "新建", label: "开启之后新建的" }]}
            />
            <span className="sw-muted">{现状.节点推进.范围 === "全部" ? "存量项目下次保存或点「完成节点」时按必填走" : "开启之前建的照手动推"}</span>
          </div>
        )}
        {s.k === "hold_cap" && 开着(s.k) && (
          <div className="sw-sub" data-testid="sw-hold-cap-sub">
            <span>每人上限</span>
            <b>{是不限(现状.持有上限.默认上限) ? "默认 999 = 不限" : `默认 ${现状.持有上限.默认上限} 个`}</b>
            <span className="sw-muted">单独设了 {现状.持有上限.单设人数} 人</span>
            <button type="button" className="sw-link sw-push" onClick={() => 去卡("project", "项目持有上限")}>去项目模式改</button>
            {是不限(现状.持有上限.默认上限) && !现状.持有上限.单设人数 && (
              <span className="sw-dep sw-no sw-full"><i aria-hidden>!</i>默认填的 999 = 不限，也没人单设，开着也不拦人</span>
            )}
          </div>
        )}
        {s.危 && <div className="sw-risk" role="note"><i aria-hidden>!</i><span>{s.危}</span></div>}
        {s.提醒 && <div className="sw-info" role="note"><i aria-hidden>i</i><span>{s.提醒}</span></div>}
        <dl className="sw-meta">
          <div><dt>影响谁</dt><dd>{影响话(s, 现状.全员)}</dd></div>
          <div><dt>谁能改</dt><dd>{改的人}{s.k === "lead_assign" ? "（每人配额：直属 / 虚线上级）" : ""}</dd></div>
          <div><dt>什么时候生效</dt><dd>{s.when}</dd></div>
        </dl>
        {依.length > 0 && (
          <div className="sw-deps" aria-label="要先有的">
            {依.map((d) => (
              <span key={d.话} className={`sw-dep ${d.ok ? "sw-ok" : "sw-no"}`}>
                <i aria-hidden>{d.ok ? "✓" : "!"}</i>{d.话}
                {!d.ok && d.去 && <button type="button" className="sw-link" onClick={() => 去卡(d.去!.tab, d.去!.找)}>{d.去.钮}</button>}
                {!d.ok && d.跳 && <button type="button" className="sw-link" onClick={() => 跳(d.跳!)}>去看</button>}
              </span>
            ))}
          </div>
        )}
        {(锁 || 空着) && (
          <div className="sw-lock" role="note" data-testid={`sw-lock-${s.k}`}>
            <i aria-hidden>!</i>
            <span>
              {父关着打不开(开关of[s.parent!].名)}{锁 ? "，现在打不开" : "；现在开着不起作用，可以关掉"}
              <button type="button" className="sw-link" onClick={() => 跳(s.parent!)}>去看</button>
            </span>
          </div>
        )}
        <div className="sw-foot">
          {最近 && "比不出" in 最近
            ? <span>操作日志里比不出</span>
            : 最近
            ? <span title={`${new Date(最近.at).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })}（北京时间）`}>上次：{最近.谁} · {时间话(最近.at)} · {最近.动作}</span>
            : <span>操作日志里没有改动（一直是默认）</span>}
          {s.tab && s.找 && <button type="button" className="sw-link sw-push" onClick={() => 去卡(s.tab!, s.找!)}>在「{原页签名[s.tab]}」里看</button>}
        </div>
      </article>
    );
  };

  return (
    <div className="sw" ref={根} data-testid="switches-tab">
      {后果框}
      {数框}
      <div className="sw-head">
        <h2>开关总览</h2>
        <div className="sw-sum"><b>{开数}</b> 个开着 · <b>{二值.length - 开数}</b> 个关着 · 推进权限：{String(值!.push_perm)}</div>
      </div>
      <div className="sw-tools">
        <Input
          className="sw-search" type="search" allowClear value={搜} aria-label="搜开关" placeholder="搜开关，比如：节点推进、公海、录音"
          onChange={(e) => set搜(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            if (看[0]) return 跳(看[0].k);
            if (路[0]) 去卡(路[0].tab, 路[0].找);
          }}
        />
        <div className="sw-chips" role="group" aria-label="筛选">
          {chips.map(([k, t, n]) => (
            <button key={k} type="button" className="sw-chip" aria-pressed={筛 === k} onClick={() => set筛(k)}>{t}<span className="sw-n">{n}</span></button>
          ))}
        </div>
      </div>
      {路.length > 0 && (
        <div className="sw-ptr" role="note">
          {路.map((p) => (
            <div key={p.id} className="sw-ptr-i">
              <span className="sw-ptr-t"><b>{p.名}</b><span className="sw-muted"> · {p.话}</span></span>
              <button type="button" className="sw-link" onClick={() => 去卡(p.tab, p.找)}>去「{原页签名[p.tab]}」</button>
            </div>
          ))}
        </div>
      )}
      {看.length > 0 ? (
        <div className="sw-grid">
          {组块.map(({ g, 项 }) => (
            <div key={g.id} className="sw-ov">
              <div className="sw-ov-h">
                <b>{g.名}</b>
                <span className="sw-n">{项.filter((s) => !s.opts && 开着(s.k)).length}/{项.filter((s) => !s.opts).length} 开</span>
              </div>
              {项.map((s) => (
                <button key={s.k} type="button" className="sw-row" onClick={() => 跳(s.k)}>
                  <span className="sw-row-n" title={s.名}>{s.名}</span>
                  {改过(s) && <span className="sw-chg" title="和默认不同" aria-label="和默认不同" />}
                  <span className={`sw-val${开着(s.k) || s.opts ? " sw-on" : ""}`}>{值话(s)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : 路.length ? null : (
        <div className="sw-empty">{词 ? `没有对得上「${搜.trim()}」的开关` : "这一类现在没有开关"}</div>
      )}
      {组块.map(({ g, 项 }) => (
        <section key={g.id} className="sw-grp" aria-label={g.名}>
          <div className="sw-grp-h"><h3>{g.名}</h3><span className="sw-n">{项.length} 个</span></div>
          <div className="sw-cards">{项.map(卡)}</div>
        </section>
      ))}
      {提示条}
    </div>
  );
}
