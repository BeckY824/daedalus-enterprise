"use client";

import DatePicker from "@/components/BusinessDatePicker";
import OptionInput from "@/components/OptionInput";
import Shortcut from "./Shortcut";

import { createContext, useContext, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { App, Select, Input, Checkbox } from "antd";
import { CheckOutlined, CloseOutlined, RightOutlined } from "@ant-design/icons";
import { motion } from "motion/react";
import { applyProposal, undoProposal, type 撤销凭据, type 附件去处 } from "@/app/(app)/dashboard/apply";
import { 取走名片原图, 记下刚建的, 忘掉刚建的 } from "@/lib/card-scan/originals";
import { 传附件 } from "@/lib/attachment-upload";
import { describeProposal, missingFields, 只留选中的改动, 可改字段表, 区域去处叫法, type Proposal, type 线索待确认格, type 区域去处 } from "@/lib/agent/proposals";
import { 三种业务线, 分配说明, 销售自动分确认, 建议业务线 } from "@/lib/enterprise/assign-line";
import { 认渠道 } from "@/lib/enterprise/channel-match";
import { useBusiness } from "@/lib/business-client";
import { 币种符号 } from "@/lib/currency";
import { 建议结果, 记下建议结果, 清掉建议结果, 记下回执, 读回执 } from "@/lib/ai-jobs";
import { statusLabel, 签约叫, 外贸精简, type BusinessConfig } from "@/lib/business-config";
import { 跟进类型们, FOLLOW_METHODS, FOLLOW_STATUSES, DECISION_STATUSES, LEAD_STATUSES } from "@/lib/constants";
import { dayjs } from "@/lib/utils";
import { isCalendarDate } from "@/lib/schedule-date";
import { useMotionTheme } from "@/components/MotionTheme";
import { 企业版字典 } from "@/lib/project/stage-dict";
import { 有效线索节点 } from "@/lib/project/stage-gates";
import { 是项目卡, 不可撤销, type 项目卡 } from "@/lib/agent/project-proposals";
import dynamic from "next/dynamic";
import RescueKey from "@/app/(app)/customers/RescueKey";

// 项目类卡的格子（11-01 速度闸门）：AI 面板每一页都在，这块只有项目卡用到，出卡时才去拿，不进每页首屏
const ProjectProposalFields = dynamic(() => import("@/components/ProjectProposalFields"), { ssr: false });

/**
 * AI 建议卡：唯一一条让模型的输出进到数据库的路。
 *
 * 六种形态（改状态 / 改档案 / 记跟进 / 排计划 / 新建线索 / 记一笔签约）加项目类几种；老存档里的商机卡只显示成不可用，
 * 共用一套骨架：
 *   抬头一句话说清要改什么 → 字段就地可改 → 确认 / 忽略
 *
 * 它同时是一张表单：模型不知道的字段就留空，人在卡片上补，而不是被要求
 * 回到对话里照格式打一遍字。缺必填项时「确认」是灰的，旁边写明还差什么。
 * 确认之前什么都没发生；确认之后卡片从铅笔（虚线）换成墨水（实线），落一个印，
 * 不再有确认按钮，避免重复点。刚确认的那一次还能撤销（只限记跟进、改状态，见 apply.ts 的 撤销凭据）。
 * 人改过的值不在这里判对错，服务端会用生成时同一套校验再收一遍。
 *
 * **改档案是逐项的**（批 2，照 Codex 在线程里审改动那一套）：一张卡里建议改三个字段，
 * 原来只能整张一起确认——只想要其中一项的人只好整张忽略，再自己去档案页改。
 * 现在每一项各有一个勾，各自写清「现在是什么 → 改成什么」，
 * 底下是「确认选中 N 项」。⌘↵ 等于点它。
 */
/**
 * 记号：「任务 key:卡片 id」。给了就把确认 / 忽略记进任务表（lib/ai-jobs 的 处理过的建议）——
 * 卡片重挂时照它恢复，侧栏也靠它知道还有没有要人确认的。不给就只在这张卡自己身上记。
 */
/**
 * 企业版只用项目的首页：新建线索卡上「来源」要选启用中的渠道（建成项目按渠道认，dashboard/apply.ts），
 * 不是业务配置里的来源。没给就照旧用来源
 */
export const 新线索来源 = createContext<readonly string[] | null>(null);
/** 同一处：开了超时回收，新线索卡的「下一步时间」也必填（和 dashboard/apply.ts 的拦截同一份 missingFields） */
export const 新线索要下一步 = createContext(false);
/**
 * 同一处（11-04）：新线索卡和「新建项目」向导走同一套分配 —— 分配方式（按业务角色能用的那几种）、
 * 指定分配时的负责人候选、业务线、当前进程（11-05 起只到线索验证，不再问客户明确回复）。服务端算好传进来（dashboard/page.tsx，同 wizard-data.ts）
 */
export type 新线索企业格 = { 成员: { value: string; label: string }[]; 分配方式们: { i: number; 名: string }[]; 默认分配方式: number | null; 是销售: boolean };
export const 新线索企业 = createContext<新线索企业格 | null>(null);
/** 新建只能落在线索验证及之前（11-05：过了线索验证要看它的必填项，新建时填不了；lib/project/wizard.ts 同口径） */
const 线索节点们 = 企业版字典.节点们.线索.slice(0, 企业版字典.节点们.线索.indexOf(有效线索节点) + 1 || undefined);

type 落印回执 = { at: string; 撤销?: 撤销凭据; 项目?: string };

/** 老商机卡上那句（和 dashboard/apply.ts 拦下时回的话同一个意思） */
const 商机卡停用话 = "这里商机已并入项目，这张老建议卡不能再确认：请到项目页把项目推到商机阶段";

export default function ProposalCard({ proposal, 记号 }: { proposal: Proposal; 记号?: string }) {
  const { 曲线, 时长 } = useMotionTheme();
  const b = useBusiness();
  const 渠道名们 = useContext(新线索来源);
  const 要下一步 = useContext(新线索要下一步);
  const 企 = useContext(新线索企业);
  /* 三个档案字段叫什么、「职位」那一格有哪些选项，跟着业务配置走（通用版 vs 教培预设） */
  const 字段表 = 可改字段表(b);
  const { message, modal } = App.useApp();
  const router = useRouter();
  // 企业版新线索卡：默认值和新建向导一致 —— 分配方式按角色默认（只有一种能用就直接选上）、进程默认线索第一步、业务线按国家 / 城市猜
  // 渠道：AI 常只写平台名（「TikTok」），按 apply.ts 落库同一个 认渠道 认出唯一一个就直接预选上；认不出（或对上多个）照原样留给人选
  const [draft, setDraft] = useState<Proposal>(() => {
    if (proposal.kind !== "add_lead" || !渠道名们) return proposal;
    const 认出 = 认渠道(proposal.source, 渠道名们.map((name) => ({ name }))).渠道;
    // 企业版来源只能从渠道里选（11-05 客户：「来源只能采用选项，不能采用填写」）：认不出就空着让人选，不留 AI 原文
    const 预选 = { ...proposal, source: 认出 ? 认出.name : "" };
    if (!企) return 预选;
    const 默认 = 企.默认分配方式;
    const 分 = 默认 !== null && 企.分配方式们.some((x) => x.i === 默认) ? 默认 : 企.分配方式们.length === 1 ? 企.分配方式们[0].i : undefined;
    return {
      ...预选,
      分配方式: proposal.分配方式 ?? 分,
      节点: proposal.节点 && 线索节点们.includes(proposal.节点) ? proposal.节点 : 线索节点们[0],
      业务线: proposal.业务线 ?? 建议业务线({ addrCountry: proposal.country, addrCity: proposal.city }) ?? undefined,
    };
  });
  const [state, set状态] = useState<"idle" | "saving" | "done" | "denied">(() => (记号 && 建议结果(记号)) || "idle");
  const setState = (s: "idle" | "saving" | "done" | "denied") => {
    set状态(s);
    if (记号 && (s === "done" || s === "denied")) 记下建议结果(记号, s);
  };
  const [err, setErr] = useState("");
  /** 只在回收站里撞上的号：错误旁边摆「从回收站捞回」（客户 11-05：只有查重触发时可以捞回） */
  const [回收站号, set回收站号] = useState<{ 类型: string; 值: string } | null>(null);
  /**
   * 确认之后的回执：几点写入、怎么撤、建成的项目（企业版新线索卡，「查看」直接打开它）。
   * 存在任务表里（lib/ai-jobs 的 落印回执），卡片重挂也还在，刷新页面才没
   */
  const [落印, set落印] = useState<落印回执 | null>(() => (记号 ? (读回执(记号) as 落印回执 | undefined) ?? null : null));
  /** 这一下刚发生：只有刚点的那次落印才「盖下去」、刚撤销的那次才「褪回去」；重挂时都是静止的结果 */
  const [刚, set刚] = useState<"落印" | "撤销" | null>(null);
  const [撤销中, set撤销中] = useState(false);
  const 根 = useRef<HTMLDivElement>(null);
  /** 这张卡建出来的联系人 / 线索：撤销时连「刚建的」一起忘掉 */
  const 建出的去处 = useRef<附件去处 | null>(null);
  /** 改档案时逐项勾选。默认全勾上——建议是它提的，人只需要否掉不想要的那几项 */
  const [勾了, set勾了] = useState<number[]>(() => (proposal.kind === "update_customer" ? proposal.changes.map((_, i) => i) : [0]));
  const 逐项 = draft.kind === "update_customer" && draft.changes.length > 1;

  /** 真正要提交的那张卡：逐项时只带勾上的那几项 */
  const 要提交的 = useMemo<Proposal>(() => 只留选中的改动(draft, 勾了), [draft, 勾了]);
  // 模型不知道的字段留空，人在卡片上补齐才能确认
  // 企业版卡上那一格叫「渠道」（术语表），提示里跟着叫；lib 里那句「来源（渠道）」AI 的提示词也在用，不动
  const missing = missingFields(要提交的, b, 渠道名们 ? { 只用项目: true, 要下一步, ...(企 ? { 企业: { 有分配方式: 企.分配方式们.length > 0, 节点们: 线索节点们 } } : {}) } : undefined)
    .map((m) => (渠道名们 && m === "来源（渠道）" ? "渠道" : m));
  const 停用卡 = draft.kind === "add_opportunity";
  const 能确认 = state !== "saving" && !停用卡 && missing.length === 0 && 勾了.length > 0;

  function confirm() {
    if (!能确认) return;
    // 销售选自动分配：分出去自己就看不到了，和新建向导同一句先问一下
    if (企?.是销售 && 要提交的.kind === "add_lead" && 要提交的.分配方式 === 1) {
      modal.confirm({ title: "按自动分配建", content: 销售自动分确认, okText: "确定，分出去", cancelText: "再想想", onOk: () => void 提交() });
      return;
    }
    void 提交();
  }

  async function 提交() {
    setState("saving");
    setErr("");
    set回收站号(null);
    // 确认完这张卡就没有输入框了：焦点原来在卡里的，送回对话框，让人接着说下一句
    const 焦点在卡里 = !!根.current?.contains(document.activeElement);
    const 对话框 = 找对话框(根.current);
    const r = await applyProposal(要提交的);
    if (r.ok) {
      const 回执: 落印回执 = { at: dayjs().format("HH:mm"), 撤销: r.撤销, ...(r.项目 ? { 项目: r.项目 } : {}) };
      set落印(回执);
      if (记号) 记下回执(记号, 回执);
      set刚("落印");
      setState("done");
      // 不再弹「已给某某记了一条…」：卡上落的那个印说的就是这件事，同一句话说两遍是噪音
      if (焦点在卡里) requestAnimationFrame(() => 对话框?.focus());
      // 名片建的线索：选的几张原图存成它（或建出来的主要联系人）的附件。存完再刷一次，附件数跟着出来
      if (r.附件去处) void 存名片原图(r.附件去处);
      // 记下刚建的那位：接着单发的客户照片问一句要不要存到他名下（lib/card-scan/originals.ts）
      if (r.附件去处 && 要提交的.kind === "add_lead") {
        建出的去处.current = r.附件去处;
        记下刚建的(r.附件去处, [要提交的.name, 要提交的.contact].filter(Boolean).join(" · "));
      }
      /*
        **落库之后要刷这一页。**
        0.38.0 之前这张卡只出现在首页，首页没有会过期的列表，所以不刷也看不出来。
        面板提到全局之后它跟着到了每一页：在客户列表上确认「改成已签约」，
        卡片塌成一行绿字说改好了，而背后那张表还显示着旧状态——
        人要么以为没生效再点一次，要么就信了那张旧表。
        refresh 只重取服务端数据，不动这一屏的对话（那是模块级的，见 lib/home-thread.ts）。
      */
      router.refresh();
    } else {
      setState("idle");
      setErr(r.error);
      set回收站号(r.回收站号 ?? null);
    }
  }

  /**
   * 逐张传，不并发：几张大图同时压、同时传，慢机器上会卡住界面。
   * 线索已经建好了，图没传上去不回滚，只说清几张没存、到哪补（企业版联系人附件，2026-10-28）
   */
  async function 存名片原图(去处: 附件去处) {
    const 图们 = 取走名片原图(proposal.id);
    if (!图们.length) return;
    const 挂在 = "contactId" in 去处 ? { contactId: 去处.contactId } : { leadId: 去处.leadId };
    const 错: string[] = [];
    for (const f of 图们) {
      const r = await 传附件(挂在, f);
      if (!r.ok) 错.push(r.error);
    }
    const 到哪补 = "contactId" in 去处 ? "到客户的联系人上点「附件」补传" : "到线索页编辑这条线索补传";
    if (错.length === 图们.length) message.warning(`名片照片没存上：${错[0]}。${到哪补}`);
    else if (错.length) message.warning(`${图们.length} 张名片照片存了 ${图们.length - 错.length} 张，${错.length} 张没存上（${错[0]}）。${到哪补}`);
    router.refresh();
  }

  async function undo() {
    if (!落印?.撤销) return;
    set撤销中(true);
    const r = await undoProposal(落印.撤销);
    set撤销中(false);
    if (!r.ok) {
      message.error(r.error);
      return;
    }
    if (建出的去处.current) 忘掉刚建的(建出的去处.current);
    建出的去处.current = null;
    // 回到「等你确认」：卡片还是那张，人可以改一改再确认，或者忽略。原地褪回铅笔，不重新浮现一遍
    set落印(null);
    set刚("撤销");
    set状态("idle");
    if (记号) 清掉建议结果(记号);
    message.success("已撤销，档案回到确认之前");
    router.refresh();
  }

  if (state === "denied") return null;

  if (state === "done") {
    return (
      /* 确认之后这张卡**收成一条**：从建议的高度落到一行墨水回执。
         用 height: auto 的形变而不是直接换内容——直接换的话，下面的对话会往上跳一大截，
         人会以为自己点掉了什么东西 */
      <motion.div
        key="done"
        className="prop prop-done"
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        transition={{ duration: 时长.morph, ease: 曲线.morph }}
        style={{ overflow: "hidden" }}
      >
        <span className={`prop-seal${刚 === "落印" ? " is-new" : ""}`}>
          <CheckOutlined /> 已写入{落印 ? ` ${落印.at}` : ""}
        </span>
        <span className="prop-done-t">{describeProposal(draft, b.customer, 字段表, b)}</span>
        <span className="prop-done-acts">
          {落印?.撤销 && (
            <button type="button" className="cli-link" onClick={undo} disabled={撤销中}>
              {撤销中 ? "撤销中…" : "撤销"}
            </button>
          )}
          <Link href={查看去处(draft, 落印)} className="cli-link">
            查看 <RightOutlined style={{ fontSize: 10 }} />
          </Link>
        </span>
      </motion.div>
    );
  }

  return (
    /* key 分开：撤销后从回执回到这张卡时要重新挂载——同一个节点复用的话，
       回执那段高度动画留下的固定高度还在，卡片内容会溢出去压住下面的东西 */
    <motion.div
      key="pending"
      ref={根}
      className={`prop${刚 === "撤销" ? " is-unsealed" : ""}`}
      initial={刚 === "撤销" ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      /* ⌘↵ = 点「确认」。光标在卡片里任何一个输入框时都管用——
         改完最后一个字段还要伸手去点按钮，是这张卡最烦的一下 */
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          confirm();
        }
      }}
    >
      <div className="prop-h">
        <span className="prop-tag">AI 草稿</span>
        <span className="prop-t">{describeProposal(draft, b.customer, 字段表, b)}</span>
      </div>
      <div className="prop-why">{draft.reason}</div>

      <div className="prop-body">
        {是项目卡(draft.kind) && <ProjectProposalFields draft={draft as 项目卡} setDraft={(p) => setDraft(p)} />}
        {draft.kind === "set_status" && (
          <Field label={draft.field === "followStatus" ? "跟进状态" : "决策状态"} 现值={现值文本(draft, draft.field, b)}>
            <Select
              size="small"
              style={{ width: 160 }}
              placeholder="选一个"
              value={draft.to || undefined}
              options={(draft.field === "followStatus" ? FOLLOW_STATUSES : DECISION_STATUSES).map((v) => ({ value: v, label: statusLabel(b, v) }))}
              onChange={(v) => setDraft({ ...draft, to: v })}
            />
          </Field>
        )}

        {/* 改档案：模型只写要改的那几项，每项按自己的类型渲染。
            负责人 / 渠道 / 推荐人是名字不是 id——落库时服务端解析，重名会拒绝 */}
        {draft.kind === "update_customer" &&
          draft.changes.map((chg, i) => {
            const spec = 字段表[chg.field];
            const 改这项 = (v: string) => setDraft({ ...draft, changes: draft.changes.map((c, j) => (j === i ? { ...c, value: v } : c)) });
            return (
              <Field
                key={chg.field}
                label={spec.label}
                现值={现值文本(draft, chg.field, b)}
                勾={逐项 ? { 上: 勾了.includes(i), 切: (v) => set勾了(v ? [...勾了, i] : 勾了.filter((x) => x !== i)) } : undefined}
                block={spec.kind === "text" && chg.field === "remark"}
              >
                {spec.kind === "enum" ? (
                  <Select
                    size="small"
                    style={{ width: 160 }}
                    placeholder="选一个"
                    value={chg.value || undefined}
                    options={(spec.values ?? []).map((v) => ({ value: v, label: chg.field === "grade" ? v : statusLabel(b, v) }))}
                    onChange={改这项}
                  />
                ) : spec.kind === "date" ? (
                  <DatePicker
                    size="small"
                    format="YYYY-MM-DD"
                    placeholder="选个日期"
                    value={chg.value ? dayjs(chg.value) : null}
                    onChange={(d) => 改这项(d ? d.toISOString() : "")}
                  />
                ) : chg.field === "remark" ? (
                  <Input.TextArea size="small" autoSize={{ minRows: 2, maxRows: 6 }} value={chg.value} onChange={(e) => 改这项(e.target.value)} />
                ) : (
                  <Input
                    size="small"
                    style={{ width: 220 }}
                    value={chg.value}
                    placeholder={spec.kind === "name" ? "写名字，不是编号" : ""}
                    onChange={(e) => 改这项(e.target.value)}
                  />
                )}
              </Field>
            );
          })}

        {/* 老对话存档里的商机卡（建议工具 2026-11-11 已删）：商机已并入项目，不给填也不给确认，dashboard/apply.ts 同样拦 */}
        {draft.kind === "add_opportunity" && <div className="prop-err">{商机卡停用话}</div>}

        {draft.kind === "add_contract" && (
          <>
            <Field label={签约叫(b) === "订单" ? "订单金额" : "签约金额"}>
              <Input size="small" style={{ width: 140 }} prefix={币种符号(draft.currency || b.currency)} value={draft.amount || ""} onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })} />
            </Field>
            <Field label={签约叫(b) === "订单" ? "订单确认时间" : "签约日期"}>
              <DatePicker size="small" format="YYYY-MM-DD" allowClear={false} value={draft.signedAt ? dayjs(draft.signedAt) : null} onChange={(d) => d && setDraft({ ...draft, signedAt: d.toISOString() })} />
            </Field>
            <Field label="备注" block>
              <Input.TextArea size="small" autoSize={{ minRows: 1, maxRows: 4 }} value={draft.remark} onChange={(e) => setDraft({ ...draft, remark: e.target.value })} />
            </Field>
          </>
        )}

        {/* 改渠道：渠道负责人只存在于渠道上，客户档案里没有这个字段 */}
        {draft.kind === "update_channel" && (
          <>
            <Field label="渠道">
              <Input size="small" style={{ width: 200 }} value={draft.channelName} onChange={(e) => setDraft({ ...draft, channelName: e.target.value })} />
            </Field>
            <Field label="渠道负责人">
              <Input size="small" style={{ width: 160 }} value={draft.ownerName} placeholder="写姓名，不填就不改" onChange={(e) => setDraft({ ...draft, ownerName: e.target.value })} />
            </Field>
            {/* 电话也摆出来：模型给了就看得见、改得了（原来这一格不画，确认时却照写进库） */}
            <Field label="电话" 现值={现值文本(draft, "phone", b)}>
              <Input size="small" style={{ width: 160 }} value={draft.phone} placeholder="不填就不改" onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
            </Field>
            <Field label="备注" block 现值={现值文本(draft, "remark", b)}>
              <Input.TextArea size="small" autoSize={{ minRows: 1, maxRows: 4 }} value={draft.remark} placeholder="不填就不改；填了会整段换掉原来的备注" onChange={(e) => setDraft({ ...draft, remark: e.target.value })} />
            </Field>
          </>
        )}

        {draft.kind === "add_followup" && (
          <>
            <Field label="类型">
              <Select
                size="small"
                style={{ width: 160 }}
                value={draft.type}
                options={跟进类型们(外贸精简(b)).map((t) => ({ value: t.value, label: t.label }))}
                onChange={(v) => setDraft({ ...draft, type: v })}
              />
            </Field>
            <Field label="时间">
              <DatePicker
                size="small"
                showTime={{ format: "HH:mm" }}
                format="MM-DD HH:mm"
                allowClear={false}
                value={dayjs(draft.occurredAt)}
                onChange={(d) => d && setDraft({ ...draft, occurredAt: d.toISOString() })}
              />
            </Field>
            <Field label="内容" block>
              <Input.TextArea
                size="small"
                autoSize={{ minRows: 2, maxRows: 8 }}
                value={draft.content}
                onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              />
            </Field>
          </>
        )}

        {draft.kind === "add_plan" && (
          <>
            <Field label="时间">
              <DatePicker
                size="small"
                showTime={!isCalendarDate(draft.plannedAt) && { format: "HH:mm" }}
                format={isCalendarDate(draft.plannedAt) ? "MM-DD" : "MM-DD HH:mm"}
                allowClear={false}
                placeholder="选个时间"
                value={draft.plannedAt ? dayjs(draft.plannedAt) : null}
                onChange={(d) => d && setDraft({ ...draft, plannedAt: isCalendarDate(draft.plannedAt) ? d.format("YYYY-MM-DD") : d.toISOString() })}
              />
              <Checkbox checked={!isCalendarDate(draft.plannedAt)} onChange={e => setDraft({ ...draft, plannedAt: e.target.checked ? dayjs(draft.plannedAt || undefined).toISOString() : dayjs(draft.plannedAt || undefined).format("YYYY-MM-DD") })}>指定钟点并到点提醒</Checkbox>
            </Field>
            <Field label="方式">
              <OptionInput size="small" style={{ width: 140 }} placeholder="选一种或直接填" allowClear={false} value={draft.method} options={FOLLOW_METHODS} onChange={(v) => setDraft({ ...draft, method: v })} />
            </Field>
            <Field label="谈什么" block>
              <Input size="small" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
            </Field>
          </>
        )}

        {draft.kind === "add_lead" && (() => {
          // 认图认出来的卡（2026-11-01）：改了哪格或点掉黄标，那格就不用再确认
          const 待 = new Set(draft.待确认 ?? []);
          const 点掉 = (k: 线索待确认格) => () => {
            const 剩 = (draft.待确认 ?? []).filter((x) => x !== k);
            setDraft({ ...draft, 待确认: 剩.length ? 剩 : undefined });
          };
          const 改 = (k: 线索待确认格, v: string) => {
            const 剩 = (draft.待确认 ?? []).filter((x) => x !== k);
            setDraft({ ...draft, [k]: v, 待确认: 剩.length ? 剩 : undefined });
          };
          const 认图卡 = draft.id.startsWith("card-");
          // 企业版卡上国家、城市总摆着（和新建向导一样能填），别的版本照旧有值才出
          const 企卡 = !!(企 && 渠道名们);
          const 多格 = ([["country", "国家", 110], ["city", "城市", 110], ["wechat", "微信", 160], ["email", "邮箱", 200], ["whatsapp", "WhatsApp", 150]] as const)
            .filter(([k]) => 认图卡 || draft[k] || 待.has(k) || (企卡 && (k === "country" || k === "city")));
          const 有区域 = !!(draft.country?.trim() || draft.city?.trim());
          const 负责人选项 = 企?.成员 ?? [];
          return (
          <>
            <Field label={企卡 ? "客户名称（组织 / 公司）" : "名称"} 待={待.has("name") ? 点掉("name") : undefined}>
              <Input size="small" style={{ width: 企卡 ? 200 : 160 }} placeholder={企卡 ? "组织或公司名" : "姓名或公司名"} value={draft.name} onChange={(e) => 改("name", e.target.value)} />
            </Field>
            <Field label={企卡 ? "联系人姓名" : "联系人"} 待={待.has("contact") ? 点掉("contact") : undefined}>
              <Input size="small" style={{ width: 140 }} placeholder={企卡 ? undefined : "可留空"} value={draft.contact} onChange={(e) => 改("contact", e.target.value)} />
            </Field>
            <Field label="电话" 待={待.has("phone") ? 点掉("phone") : undefined}>
              <Input size="small" style={{ width: 150 }} placeholder="可留空" value={draft.phone} onChange={(e) => 改("phone", e.target.value)} />
            </Field>
            {多格.map(([k, 叫, 宽]) => (
              <Field key={k} label={叫} 待={待.has(k) ? 点掉(k) : undefined}>
                <Input size="small" style={{ width: 宽 }} placeholder="可留空" value={draft[k] ?? ""} onChange={(e) => 改(k, e.target.value)} />
              </Field>
            ))}
            {/* 国家 / 城市写进哪一格由人定（11-04：「摩洛哥客户」分不清是客户、联系人还是项目所在地），不进备注 */}
            {企卡 && 有区域 && (
              <Field label="国家 / 城市填到" block>
                <Checkbox.Group
                  value={draft.区域去处 ?? []}
                  options={(Object.keys(区域去处叫法) as 区域去处[]).map((k) => ({ value: k, label: 区域去处叫法[k] }))}
                  onChange={(v) => setDraft({ ...draft, 区域去处: (v as 区域去处[]).length ? (v as 区域去处[]) : undefined })}
                />
              </Field>
            )}
            <Field label={渠道名们 ? "渠道" : "来源"}>
              {/* 企业版：只能从启用中的渠道里选，不能自己填（11-05 客户：「来源只能采用选项，不能采用填写（无相关选项需和上级沟通）」）。
                  渠道名常很长：下拉不跟输入框同宽，按内容撑开（11-04） */}
              {渠道名们 ? (
                <Select
                  size="small"
                  style={{ width: 200 }}
                  showSearch
                  placeholder="选渠道"
                  value={draft.source || undefined}
                  options={渠道名们.map((n) => ({ value: n, label: n }))}
                  popupMatchSelectWidth={false}
                  classNames={{ popup: { root: "opt-popup-full" } }}
                  notFoundContent="没有这个渠道，请找上级添加"
                  onChange={(v: string) => setDraft({ ...draft, source: v })}
                />
              ) : (
                <OptionInput size="small" style={{ width: 130 }} allowClear={false} value={draft.source} options={b.sources} onChange={(v) => setDraft({ ...draft, source: v })} />
              )}
            </Field>
            {/* 企业版建成项目：首条沟通的下一步计划 + 时间（开了超时回收都必填，11-05）；别的版本不显示 */}
            {渠道名们 && (企卡 || 要下一步) && (
              <Field label="下一步计划">
                <Input size="small" style={{ width: 200 }} placeholder={要下一步 ? "必填，一句话" : "可留空"} maxLength={100} value={draft.下一步 ?? ""} onChange={(e) => setDraft({ ...draft, 下一步: e.target.value || undefined })} />
              </Field>
            )}
            {渠道名们 && (
              <Field label={企卡 || 要下一步 ? "下一步时间" : "下一步"}>
                <DatePicker
                  size="small"
                  style={{ width: 130 }}
                  format="YYYY-MM-DD"
                  disabledDate={(d) => d.isBefore(dayjs(), "day")}
                  value={draft.nextAt ? dayjs(draft.nextAt) : null}
                  onChange={(d) => setDraft({ ...draft, nextAt: d ? d.format("YYYY-MM-DD") : "" })}
                />
              </Field>
            )}
            {/* 企业版建成项目时不读「状态」（dashboard/apply.ts 的 建成项目），选了也没用：不摆下拉，直接写明会建成什么（10-30 交互审核 P0-4） */}
            {企卡 && 企 ? (
              <>
                {企.分配方式们.length > 0 && (
                  <Field label="分配方式" block>
                    <Select
                      size="small"
                      style={{ width: 160 }}
                      placeholder="选一种"
                      value={draft.分配方式}
                      options={企.分配方式们.map((x) => ({ value: x.i, label: x.名 }))}
                      onChange={(v) => setDraft({ ...draft, 分配方式: v })}
                    />
                    {typeof draft.分配方式 === "number" && 分配说明[draft.分配方式] && <span className="muted" style={{ fontSize: 12 }}>{分配说明[draft.分配方式]}</span>}
                  </Field>
                )}
                {(企.分配方式们.length === 0 || draft.分配方式 === 0) && (
                  <Field label="项目负责人">
                    <Select size="small" style={{ width: 160 }} showSearch optionFilterProp="label" placeholder="选一位" value={draft.ownerId || undefined} options={负责人选项} onChange={(v) => setDraft({ ...draft, ownerId: v })} />
                  </Field>
                )}
                <Field label="业务线">
                  <Select size="small" style={{ width: 110 }} placeholder="选一条" value={draft.业务线} options={三种业务线.map((v) => ({ value: v, label: v }))} onChange={(v) => setDraft({ ...draft, 业务线: v })} />
                </Field>
                <Field label="当前进程">
                  <Select size="small" style={{ width: 150 }} value={draft.节点} options={线索节点们.map((v) => ({ value: v, label: v }))} onChange={(v) => setDraft({ ...draft, 节点: v })} />
                </Field>
              </>
            ) : 渠道名们 ? (
              <Field label="建成" block>
                <span className="muted">负责人：我 · 阶段：线索 · {企业版字典.节点们.线索[0]} · 金额 0</span>
              </Field>
            ) : (
              <Field label="状态">
                <Select
                  size="small"
                  style={{ width: 120 }}
                  value={draft.status}
                  options={LEAD_STATUSES.map((v) => ({ value: v, label: v }))}
                  onChange={(v) => setDraft({ ...draft, status: v })}
                />
              </Field>
            )}
            <Field label="备注" block>
              <Input.TextArea size="small" autoSize={{ minRows: 1, maxRows: 5 }} placeholder="可留空" value={draft.remark} onChange={(e) => setDraft({ ...draft, remark: e.target.value })} />
            </Field>
          </>
          );
        })()}
      </div>

      {err && (
        <div className="prop-err">
          {err}
          {回收站号 && (
            <div style={{ marginTop: 6 }}>
              <RescueKey
                类型={回收站号.类型}
                值={回收站号.值}
                捞回了={(查) => {
                  // 捞回来以后这个号就有主了：按服务端重查的结论说一句，卡片不再重复建档
                  set回收站号(null);
                  setErr(查.ok && 查.状态 !== "首次录入" ? 查.提示 : "");
                  router.refresh();
                }}
              />
            </div>
          )}
        </div>
      )}

      <div className="prop-foot">
        <button type="button" className="prop-ok" onClick={confirm} disabled={!能确认}>
          <CheckOutlined /> {state === "saving" ? "写入中…" : 逐项 ? `确认选中 ${勾了.length} 项` : "确认"}
        </button>
        {逐项 && (
          <button
            type="button"
            className="prop-no"
            onClick={() => set勾了(勾了.length ? [] : (draft as Extract<Proposal, { kind: "update_customer" }>).changes.map((_, i) => i))}
            disabled={state === "saving"}
          >
            {勾了.length ? "全部取消" : "全部选上"}
          </button>
        )}
        <button type="button" className="prop-no" onClick={() => setState("denied")} disabled={state === "saving"}>
          <CloseOutlined /> 忽略
        </button>
        {是项目卡(draft.kind) && 不可撤销(draft.kind) && (
          <span className="prop-err" style={{ margin: 0 }}>
            此操作不可撤销{draft.kind === "customer_delete" ? "（删后进回收站，30 天内可恢复）" : ""}
          </span>
        )}
        <span className="prop-note">
          {停用卡 ? "这张卡不能确认" : 勾了.length === 0 ? "一项都没选" : missing.length ? `还差${missing.join("、")}` : <Shortcut>确认前不会写入任何数据 · ⌘↵</Shortcut>}
        </span>
      </div>
    </motion.div>
  );
}

/**
 * 卡片上的一项。
 *
 * 有「现在是什么」就写成「现在 → 改成」——不写的话，卡片上一行「跟进状态：已签约」
 * 人无从判断这是在改还是本来就是。逐项勾选时前面还有一个勾。
 */
function Field({
  label, children, block, 现值, 勾, 待,
}: {
  label: string;
  children: React.ReactNode;
  block?: boolean;
  现值?: string;
  勾?: { 上: boolean; 切: (v: boolean) => void };
  /** 认图认得没把握的格（2026-11-01）：摆一个黄的「待确认」，点一下 = 核对过了 */
  待?: () => void;
}) {
  return (
    <div className={`prop-f${block ? " prop-f-block" : ""}${勾 ? " prop-f-pick" : ""}${勾 && !勾.上 ? " prop-f-off" : ""}`}>
      {勾 && <Checkbox checked={勾.上} onChange={(e) => 勾.切(e.target.checked)} aria-label={`要不要改${label}`} />}
      <span className="prop-f-l">{label}</span>
      {待 && <button type="button" className="prop-f-wait" onClick={待} title="核对过就点一下；改这一格也算">待确认</button>}
      {现值 !== undefined && (
        <span className="prop-f-was">
          {现值 || "空"} <span className="prop-f-arrow">→</span>
        </span>
      )}
      {children}
    </div>
  );
}

/** 这个字段现在显示成什么。状态类的要走业务配置里的叫法，不能直接摆库里存的值 */
function 现值文本(p: Proposal, field: string, b: BusinessConfig): string | undefined {
  const v = p.现值?.[field];
  if (v === undefined) return undefined;
  if (field === "followStatus" || field === "decisionStatus") return v ? statusLabel(b, v) : "";
  return v;
}

/** 确认之后「查看」去哪：新线索去建成的项目，项目类卡去那个项目，删客户回客户列表 */
function 查看去处(p: Proposal, 落印: 落印回执 | null): string {
  if (p.kind === "add_lead") return 落印?.项目 ? `/projects/${落印.项目}` : "/leads";
  if (p.kind === "update_channel") return "/channels";
  if (p.kind === "customer_delete") return "/customers";
  if (p.kind === "contact_update") return p.customerId ? `/customers/${p.customerId}` : "/customers";
  if (是项目卡(p.kind)) {
    const q = p as 项目卡;
    const id = 落印?.项目 || q.projectId || (q.kind === "project_node" || q.kind === "project_followup" || q.kind === "lead_verify" || q.kind === "payment_add" ? q.targetId : "");
    return id ? `/projects/${id}` : "/projects";
  }
  return `/customers/${p.customerId}`;
}

/** 这张卡所在那一屏的对话框（首页或右侧面板）。往上找，找到第一个装着它的 */
function 找对话框(el: HTMLElement | null): HTMLTextAreaElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const t = p.querySelector<HTMLTextAreaElement>(".cli-input textarea");
    if (t) return t;
  }
  return null;
}
