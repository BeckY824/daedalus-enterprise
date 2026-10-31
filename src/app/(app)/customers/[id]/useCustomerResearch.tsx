"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Modal, Tag, Tooltip } from "antd";
import { GlobalOutlined } from "@ant-design/icons";
import { useBusiness } from "@/lib/business-client";
import { useJob, clearJob } from "@/lib/ai-jobs";
import ResearchRun from "@/components/research/ResearchRun";
import ResearchPerson from "@/components/research/ResearchPerson";
import { useResearchEntry } from "@/components/research/ResearchEntry";
import type { Turn } from "@/lib/home-thread";
import { dayjs } from "@/lib/utils";
import { 最近背调, 背调价目 } from "@/lib/research/actions";
import { 客户背调对象, 对象说明, type 客户档案 } from "@/lib/research/subject";

/**
 * 客户背调（lib/research）：按钮、跑起来那一块、上一次背调的摘要。
 * 原来整段写在 AiPanel 里；企业版客户页要把它单拎成一张卡（2026-10-29 P14 第 5 条），抽成一个钩子两处共用：
 * AiPanel 照旧把按钮摆在头上、跑的那块摆在下面；企业版的「客户背调」卡（CustomerResearchCard）摆成一张蓝框卡。
 *
 * 点了才出确认卡，确认了才跑、才扣。任务挂在 ai-jobs 上（research:<客户>），切走再回来卡还在。
 * 上一次背调存成了时间线上一条「背调｜」开头的记录，这里摆一行能展开的摘要。
 * 开 = false：整段不摆、也不去查价和上一次（AiPanel 在企业版客户页交给背调卡了）
 */
export function useCustomerResearch({
  customerId,
  customerName,
  档案,
  on记跟进,
  能发起 = true,
  开 = true,
}: {
  customerId: string;
  customerName: string;
  档案?: Omit<客户档案, "name">;
  on记跟进?: () => void;
  /** false = 不摆背调按钮（以前存下的背调摘要照样能看） */
  能发起?: boolean;
  开?: boolean;
}): { 按钮: ReactNode; 区: ReactNode; 能发起: boolean; 有上次: boolean; 状态: 背调状态 } {
  const b = useBusiness();
  const researchKey = `research:${customerId}`;
  const researchJob = useJob(researchKey);
  const personKey = `${researchKey}:person`;
  const personJob = useJob(personKey);
  const [背调开, set背调开] = useState(false);
  /* 背调谁（10-21 客户反馈：以前拿客户名当公司查）。没公司的先找公司，点选了候选就接着背调那家（同一个 runId，不另扣） */
  const 对象 = useMemo(() => 客户背调对象({ name: customerName, ...档案 }, b.fields.school), [customerName, 档案, b.fields.school]);
  const [接着, set接着] = useState<Turn["接着"]>();
  const [上次背调, set上次背调] = useState<Awaited<ReturnType<typeof 最近背调>>>(null);
  const [看上次, set看上次] = useState(false);
  /* 按钮上写「背调 · 剩 N 次」：点按钮本身就是确认（10-16 用户），所以扣费得写在按钮上，不够就点不了 */
  const [背调价, set背调价] = useState<Awaited<ReturnType<typeof 背调价目>> | null>(null);
  /** 自部署 / 企业版网页背调走不通：按钮不摆、价也不问（lib/research/channel.ts 背调有入口）。以前存下的背调照样能看 */
  const 背调入口 = useResearchEntry() && 能发起 && 开;
  useEffect(() => {
    if (!背调入口) return;
    let 活 = true;
    背调价目().then((r) => 活 && set背调价(r)).catch(() => {});
    return () => {
      活 = false;
    };
  }, [researchJob?.status, 背调入口]);
  // 查不了（没公司没官网没国际号码）也让点：点了就地说清补哪样——按钮灰着、提示又出不来，人不知道为什么
  const 背调能点 = Boolean(背调价?.可用 && (背调价.还剩 == null || 背调价.还剩 >= 背调价.扣次));
  /* 点按钮就开跑，所以查谁、扣几次都得先写在提示里 */
  const 扣法 = 对象.种类 === "找人" ? "开始搜索后扣 1 次背调，没认出公司、只出简版的不扣" : "扣 1 次背调";
  const 背调说明 =
    对象.种类 === "不够"
      ? 对象.原因
      : `${对象说明(对象)}。` +
        (!背调价
          ? "上网查基本面、相关性、信号、风险、切入建议"
          : !背调价.可用
            ? `背调用不了：${背调价.原因}`
            : 背调价.模拟
              ? "开发环境用模拟数据，不扣次数"
              : 背调价.还剩 == null
                ? "不限次数"
                : 背调能点
                  ? `${扣法}（还剩 ${背调价.还剩} 次）`
                  : "背调次数用完了，需要加次数请联系我们");
  useEffect(() => {
    if (!开) return;
    let 活 = true;
    最近背调(customerId).then((r) => 活 && set上次背调(r)).catch(() => {});
    return () => {
      活 = false;
    };
  }, [customerId, researchJob?.status, 开]);

  if (!开) return { 按钮: null, 区: null, 能发起: false, 有上次: false, 状态: "无" };

  const 按钮 = 背调入口 ? (
    <Tooltip title={背调说明}>
      <Button size="small" type="text" icon={<GlobalOutlined />} onClick={() => set背调开(true)} disabled={背调开 || Boolean(researchJob) || Boolean(personJob) || !背调能点} aria-label="背调">
        背调{背调价?.可用 && !背调价.模拟 && 背调价.还剩 != null ? ` · 剩 ${背调价.还剩} 次` : ""}
      </Button>
    </Tooltip>
  ) : null;

  const 区 = (
    <>
      {(背调开 || researchJob || personJob) && (
        <div className="rec-ai-research">
          {researchJob || 接着 || 对象.种类 === "公司" ? (
            <ResearchRun
              jobKey={researchKey}
              company={接着?.候选.公司 ?? (对象.种类 === "公司" ? 对象.公司 : customerName)}
              对象={接着 ? `背调 ${接着.候选.公司} · 联系人 ${customerName}` : 对象.种类 === "公司" ? 对象说明(对象) : undefined}
              接着={接着}
              customer={{ id: customerId, name: customerName }}
              on记跟进={on记跟进}
              直接开跑
              onCancel={() => set背调开(false)}
              任务去={`/customers/${customerId}`}
            />
          ) : 对象.种类 === "找人" ? (
            <ResearchPerson
              jobKey={personKey}
              名={对象.名}
              电话={对象.电话}
              直接开跑
              onPick={(c, runId, 证据, 出现) => set接着({ runId, 人: { 名: 对象.名, 电话: 对象.电话 }, 候选: c, 出现, 证据 })}
              onCancel={() => set背调开(false)}
              任务去={`/customers/${customerId}`}
            />
          ) : (
            <div className="rs-confirm" role="group" aria-label="背调查不了">
              <span className="rs-confirm-t">{对象.原因}</span>
              <button type="button" className="rs-btn" onClick={() => set背调开(false)}>知道了</button>
            </div>
          )}
          {((researchJob && researchJob.status !== "loading") || (!researchJob && personJob && personJob.status !== "loading")) && (
            <a className="rec-ai-research-x" onClick={() => { clearJob(researchKey); clearJob(personKey); set接着(undefined); set背调开(false); }}>
              收起背调
            </a>
          )}
        </div>
      )}
      {!背调开 && !researchJob && 上次背调 && (
        <div className="rec-ai-last">
          <a onClick={() => set看上次((v) => !v)}>
            上次背调 {dayjs(上次背调.at).format("MM-DD")}：{上次背调.title.replace(/^背调｜/, "")}
          </a>
          {看上次 && <pre className="rec-ai-last-body">{上次背调.content}</pre>}
        </div>
      )}
    </>
  );

  return { 按钮, 区, 能发起: 背调入口, 有上次: !!上次背调 || Boolean(researchJob) || Boolean(personJob) || 背调开, 状态: 背调状态of({ 上次: !!上次背调, 任务们: [researchJob?.status, personJob?.status] }) };
}

/** 客户背调的状态标签（U-客户-03，10-31 会议）：在跑 → 进行中；有存下的或刚跑完 → 已有；都没有 → 无 */
export type 背调状态 = "已有" | "无" | "进行中";
export function 背调状态of({ 上次, 任务们 }: { 上次: boolean; 任务们: (string | undefined)[] }): 背调状态 {
  if (任务们.some((s) => s === "loading")) return "进行中";
  if (上次 || 任务们.some((s) => s === "done")) return "已有";
  return "无";
}

const 背调状态色: Record<背调状态, string | undefined> = { 已有: "green", 进行中: "processing", 无: undefined };

/**
 * 企业版客户页左栏的「客户背调」块（U-客户-03）：只摆一个状态标签（已有 / 无 / 进行中），点标签弹框看详情、发起背调。
 * 钩子挂在这个组件上，框关了任务和状态都还在
 */
export function CustomerResearchTag(props: { customerId: string; customerName: string; 档案?: Omit<客户档案, "name">; on记跟进?: () => void }) {
  const { 按钮, 区, 能发起, 有上次, 状态 } = useCustomerResearch(props);
  const [开着, set开着] = useState(false);
  return (
    <div className="rec-sec rec-research-sec" aria-label="客户背调">
      <div className="rec-sec-t">
        <span>客户背调</span>
        <Tag
          className="rec-research-tag"
          color={背调状态色[状态]}
          role="button"
          tabIndex={0}
          title="点开看背调详情"
          onClick={() => set开着(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              set开着(true);
            }
          }}
        >
          {状态}
        </Tag>
      </div>
      <Modal open={开着} title="客户背调" footer={null} width={640} onCancel={() => set开着(false)}>
        {按钮 && <div style={{ marginBottom: 8 }}>{按钮}</div>}
        {区}
        {!能发起 && !有上次 && <div className="muted" style={{ fontSize: 13 }}>还没有背调记录</div>}
      </Modal>
    </div>
  );
}

/**
 * 企业版客户页的「客户背调」卡（P14 第 5 条）：和右栏其他卡一个样子（rec-card rec-side-card），
 * 不再挂在 AI 面板或「跟进」菜单里。企业版网页上背调通道走不通时按钮不摆，只看以前存下的背调；都没有就说一句
 */
export function CustomerResearchCard(props: { customerId: string; customerName: string; 档案?: Omit<客户档案, "name">; on记跟进?: () => void }) {
  const { 按钮, 区, 能发起, 有上次 } = useCustomerResearch(props);
  return (
    <div className="rec-card rec-side-card" aria-label="客户背调">
      <div className="rec-side-t">
        <span>客户背调</span>
        {按钮}
      </div>
      {区}
      {!能发起 && !有上次 && <div className="muted" style={{ fontSize: 13 }}>还没有背调记录</div>}
    </div>
  );
}
