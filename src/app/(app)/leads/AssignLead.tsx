"use client";
/**
 * 企业版「线索分配和配额」的两块界面（F2 / F7，10-25 实测）：
 * - AssignLeadModal：选接手人、业务线、种类，走 分配线索()——查角色、配额、权限，记进分配记录。原来只有编辑弹窗里能随手改负责人。
 *   新线索（项目，11-01 16:1x 拍板 A9）：业务线只读（项目业务线），接手人只列「正常」参与自动分配、业务线对得上的销售
 *   （暂不分配的项目列全部正常参与的）；市场管理、销售管理、总管理员都能指派，服务端再查一遍
 * - 我分出去的：分出去的线索在别人名下，「按组织架构看客户」开着时列表里看不到，这里看它们后来怎样了
 * 规则判断都在服务端，这里只摆样子、原样报错
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Checkbox, Form, Modal, Select, Table, Tag } from "antd";
import { useConsequence } from "@/components/ConsequenceDialog";
import { SendOutlined } from "@ant-design/icons";
import { LEAD_STATUS_COLOR } from "@/lib/constants";
import { smartTime } from "@/lib/utils";
import { useCarryConfirm } from "@/app/(app)/customers/useCarryConfirm";
import { 分配线索, 批量自动分配, 本月分配情况, 我分出去的线索, 项目分配线, 分配带走的项目, type 分配情况, type 自动分配结果, type 批量自动分配结果 } from "./assign-actions";
import type { 项目线 } from "@/lib/enterprise/assign-line";
import type { 分出去的线索 } from "@/lib/enterprise/lead-assign";
import { 公海规则 } from "@/lib/enterprise/pool-rules";
import { 转走项目说法 } from "@/lib/carry-over";
import { 动作出错话 } from "@/lib/stale-deploy";

/** 「分配」框的接手人默认上次选的（原型 pr.assign）：只记在这台电脑上，不在这次可选名单里就不带 */
const 上次接手人键 = "assign-last-to";
function 读上次接手人(): string | undefined {
  try { return window.localStorage.getItem(上次接手人键) ?? undefined; } catch { return undefined; }
}
function 记上次接手人(id: string) {
  try { window.localStorage.setItem(上次接手人键, id); } catch { /* 无痕窗口存不了，下次不带默认而已 */ }
}

/** 会一起转走的项目：写在框里的那几行（P-转-07），不另叠一个确认框 */
function 一起转说明({ 说法 }: { 说法: NonNullable<ReturnType<typeof 转走项目说法>> }) {
  return (
    <div className="assign-carry" data-testid="assign-carry">
      <div><Tag color="orange">一起转走</Tag>{说法.标题}，负责人会一起改成新负责人</div>
      {说法.行.length > 0 && <ul className="assign-carry-list">{说法.行.map((l, i) => <li key={i} title={l}>{l}</li>)}</ul>}
      {说法.还有 && <div className="muted">{说法.还有}</div>}
      {说法.同事 && <div className="muted">{说法.同事}</div>}
    </div>
  );
}

const 配额说法 = (p: 分配情况[number]) => `本月 ${p.已分} / ${p.配额 ?? "不限"}${p.加额 > 0 ? `（含无效补 ${p.加额}）` : ""}`;

/**
 * 勾选后批量自动分配，弹一张名单说清每条分给了谁：线索页和项目页共用，分给了 = 各页自己的说法。
 * 选中行 = 勾选时看到的每行负责人，交给服务端逐行比（乐观锁，X-89）：被别人先分走的那行回「已被分配」
 */
export function useBatchAutoAssign(
  分给了: (r: Extract<自动分配结果, { ok: true }>) => string,
  选项?: { 项目?: true; 先问?: true; 写进行里?: (结果们: 批量自动分配结果[]) => void },
) {
  const router = useRouter();
  const { modal } = App.useApp();
  const [问后果, 后果框] = useConsequence();
  /** 不先问的那条路没分成：原因就地摆在列表上方（原型 g.notice：不弹顶部提示），可以收 */
  const [批错, set批错] = useState<string | null>(null);
  /** 先问那种（线索页，ls.ld.batch）：分完的名单就地摆在列表上方，可以收，不弹 modal.info */
  const [名单, set名单] = useState<Extract<Awaited<ReturnType<typeof 批量自动分配>>, { ok: true }>["结果"] | null>(null);
  const 传给服务端 = 选项?.项目 ? { 项目: true as const } : {};
  const 批量自动分 = async function 批量自动分(ids: string[], 清空: () => void, 选中行: readonly { id: string; ownerId: string | null }[] = []) {
    const 原负责人们 = Object.fromEntries(选中行.map((r) => [r.id, r.ownerId]));
    if (选项?.先问) {
      /*
        ls.ld.batch（P-界面-40 批量分配 = 后果框）：先说清分给谁、分不出去的怎么办，确认了才分。
        几条分不出去事先算不出（一条条按顺序分、前一条分完再挑下一条的人），所以写规则；分完名单就地列出每条结果
      */
      let 结果: typeof 名单 = null;
      const 成了 = await 问后果({
        题: `自动分配勾选的 ${ids.length} 条线索`,
        后果: [
          { 标: "分给谁", 级: "警", 话: "一条条按顺序分给还有配额的销售，前一条分完再挑下一条的人" },
          { 标: "分不出", 话: "配额满了、没有合适销售的那几条不分，留在原处，分完列出来" },
          { 标: "之后", 话: "接手人会收到通知；分完的名单列在列表上方" },
        ],
        是: "自动分配",
        危: false,
        async 做() {
          const res = await 批量自动分配(ids, { ...传给服务端, 原负责人们 });
          if (!res.ok) return res;
          结果 = res.结果;
          return { ok: true };
        },
      });
      if (!成了 || !结果) return;
      清空();
      set名单(结果);
      router.refresh();
      return;
    }
    let res: Awaited<ReturnType<typeof 批量自动分配>>;
    if (选项?.项目) {
      // 原型 pr.autobatch（P-界面-40 后果确认框）：分出去不能撤回，所以事前一个框写清「将分 N 条」、
      // 会一起转走的项目（P-转-07，原来另叠的「一起转」框并进来）、接手人会收到通知；点「分出去 N 条」才分。
      // 没分成原因写在框里、框不关（ConsequenceDialog）
      let 说法: ReturnType<typeof 转走项目说法> = null;
      try { 说法 = 转走项目说法(await 分配带走的项目(ids)); } catch { /* 取不到不拦着：分本身照样会带走项目 */ }
      let 分完: Extract<typeof res, { ok: true }> | null = null;
      const 好 = await 问后果({
        题: `自动分配 ${ids.length} 条线索`,
        后果: [
          { 标: "会发生", 级: "警", 话: "按规则分给销售，分出去不能撤回" },
          { 标: "通知", 话: "接手人会收到通知" },
        ],
        补充: 说法 ? <div className="assign-sure" data-testid="auto-assign-sure"><一起转说明 说法={说法} /></div> : <div className="assign-sure" data-testid="auto-assign-sure" />,
        是: `分出去 ${ids.length} 条`,
        危: false,
        宽: 520,
        async 做() {
          const r = await 批量自动分配(ids, { ...传给服务端, 原负责人们 });
          if (!r.ok) return r;
          分完 = r;
          return { ok: true };
        },
      });
      if (!好 || !分完) return;
      res = 分完;
    } else {
      set批错(null);
      try {
        res = await 批量自动分配(ids, { ...传给服务端, 原负责人们 });
      } catch (出错) {
        return void set批错(动作出错话(出错, "没分成，请稍后再试"));
      }
      if (!res.ok) return void set批错(res.error);
    }
    if (!res.ok) return;
    清空();
    router.refresh();
    // 原型 pr.autobatch（11-15）：结果原地写进每一行（分给谁 / 没分的原因），不再弹清单
    if (选项?.写进行里) return void 选项.写进行里(res.结果);
    const 成 = res.结果.filter((x) => x.ok).length;
    modal.info({
      title: `自动分配：${成} 条分出去了${成 < res.结果.length ? `，${res.结果.length - 成} 条没分` : ""}`,
      width: 560,
      okText: "知道了",
      content: (
        <ul className="lead-auto-assign-list" data-testid="lead-auto-assign-result">
          {res.结果.map((x) => (
            <li key={x.leadId}>
              <span className="lead-auto-assign-name" title={x.name}>{x.name}</span>
              {x.ok ? <span>{x.随客户 ? `已随客户给 ${x.接手人}` : 分给了(x)}</span> : <span className="muted">没分：{x.error}</span>}
            </li>
          ))}
        </ul>
      ),
    });
  };
  const 成数 = 名单?.filter((x) => x.ok).length ?? 0;
  const 框 = (
    <>
      {后果框}
      {批错 && (
        <Alert
          className="ls-ld-result"
          type="error"
          showIcon
          role="alert"
          closable={{ "aria-label": "收起" }}
          afterClose={() => set批错(null)}
          title={`自动分配没分成：${批错}`}
        />
      )}
      {名单 && (
        <Alert
          className="ls-ld-result"
          type={成数 < 名单.length ? "warning" : "success"}
          showIcon
          closable={{ "aria-label": "收起分配结果" }}
          afterClose={() => set名单(null)}
          title={`自动分配：${成数} 条分出去了${成数 < 名单.length ? `，${名单.length - 成数} 条没分` : ""}`}
          description={
            <ul className="lead-auto-assign-list" data-testid="lead-auto-assign-result">
              {名单.map((x) => (
                <li key={x.leadId}>
                  <span className="lead-auto-assign-name" title={x.name}>{x.name}</span>
                  {x.ok ? <span>{x.随客户 ? `已随客户给 ${x.接手人}` : 分给了(x)}</span> : <span className="muted">没分：{x.error}</span>}
                </li>
              ))}
            </ul>
          }
        />
      )}
    </>
  );
  return Object.assign(批量自动分, { 框 });
}

/**
 * 给一条线索点「分配」：lead = null 时不显示；项目 = 企业版「新线索」（项目的线索阶段），id 是项目的。
 * 不看配额 = 企业版项目列表里的分配入口（11-01 会议 §5）：接手人后面、说明里不写配额，只是不显示，服务端照旧查
 */
export function AssignLeadModal({ lead, 关, 不看配额 = false, 分好了 }: { lead: { id: string; name: string; ownerId: string | null; 项目?: boolean } | null; 关: () => void; 不看配额?: boolean; /** 给了 = 分成了把「分给谁」写回这一行（原型 pr.assign），不再弹成功提示 */ 分好了?: (接手人: string) => void }) {
  const router = useRouter();
  const 问一起转 = useCarryConfirm();
  /** 没分成的原因：就地写在框里（g.save：不弹顶部提示），框不关 */
  const [错, set错] = useState<string | null>(null);
  const [form] = Form.useForm<{ toUserId: string; line: "" | "内贸" | "外贸"; kind: "营销" | "营销企划"; 带待办: boolean }>();
  const [人们, set人们] = useState<分配情况 | null>(null);
  const [忙, set忙] = useState(false);
  // 新线索（项目）的业务线（只读）和能指派的人（正常参与、线对得上的销售）；undefined = 还在取，null = 取不到
  const [项目线, set项目线] = useState<{ 线: 项目线; 可选: string[]; 市场转客户?: boolean } | null | undefined>(undefined);
  /**
   * 企业版 C-06：分的是新线索（项目）才摆「待办一起转」的勾，默认勾、可以关（pool-rules.ts）。
   * 市场首次分给销售（X-18）不摆：待办、计划还归原负责人（P-转-10），服务端也不看这个勾；没取到之前不摆，免得闪一下
   */
  const 带待办勾出 = !!lead?.项目 && 公海规则.换负责人带待办 && 项目线 !== undefined && !项目线?.市场转客户;
  const 可选 = lead?.项目 ? (项目线 ? new Set(项目线.可选) : null) : undefined;
  const 选项们 = (人们 ?? [])
    .filter((p) => p.userId !== lead?.ownerId && (可选 === undefined || (可选 !== null && 可选.has(p.userId))));
  const 选的 = Form.useWatch("toUserId", form);
  const 选的名 = 选项们.find((p) => p.userId === 选的)?.name;
  // 原型 pr.assign：接手人默认上次选的（名单取到了、上次那位在这次可选里才带）
  const 名单好了 = 人们 !== null && (!lead?.项目 || 项目线 !== undefined);
  useEffect(() => {
    if (!lead || !名单好了 || form.getFieldValue("toUserId")) return;
    const 上次 = 读上次接手人();
    if (上次 && 选项们.some((p) => p.userId === 上次)) form.setFieldValue("toUserId", 上次);
    // 选项们 每次画都是新数组；看取回来的名单（每次打开重取、是新数组）——打开时先清空表单再取，取到那一下带一次就够
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead, 名单好了, 人们, 项目线, form]);
  // 会一起转走的项目写在框里（原型 pr.assign：不再在分配框上另叠「一起转」框）；按选的接手人现取，取到了提交时不再问
  const [转走, set转走] = useState<{ 给: string; 说法: ReturnType<typeof 转走项目说法> } | null>(null);
  const 预览请求 = useRef<{ 给: string; p: ReturnType<typeof 分配带走的项目> } | null>(null);
  useEffect(() => {
    if (!lead?.项目 || !选的) return;
    let 作废 = false;
    const p = 分配带走的项目([lead.id], 选的);
    预览请求.current = { 给: 选的, p };
    p.then(
      (x) => { if (!作废) set转走({ 给: 选的, 说法: 转走项目说法(x) }); },
      () => { /* 取不到：提交时照原来再问一次 */ },
    );
    return () => { 作废 = true; };
  }, [lead?.项目, lead?.id, 选的]);
  const 框里写了 = !!lead?.项目 && 转走?.给 === 选的;

  // 每次打开重取一遍：配额、已分随时在变
  function 打开了(open: boolean) {
    if (!open) return;
    form.resetFields();
    set错(null);
    set人们(null);
    void 本月分配情况().then((r) => set人们(r ?? []));
    set项目线(undefined);
    set转走(null);
    if (lead?.项目) void 项目分配线(lead.id).then(set项目线, () => set项目线(null));
  }

  async function 分() {
    if (!lead || 忙) return;
    const v = await form.validateFields().catch(() => null);
    if (!v) return;
    set忙(true);
    set错(null);
    try {
      // P-转-07：市场首次分给销售、客户名下有同事的项目，会一起转走的分之前列出来；点了取消就不分，弹窗留着
      // 框里已经按这位接手人写出会一起转走的项目了，不再叠一个框；预览还在路上（点得太快）就等它，不重取
      if (lead.项目 && 转走?.给 !== v.toUserId) {
        const 在取 = 预览请求.current?.给 === v.toUserId ? 预览请求.current.p : null;
        if (!(await 问一起转(() => 在取 ?? 分配带走的项目([lead.id], v.toUserId)))) return;
      }
      const 哪条 = lead.项目 ? { projectId: lead.id } : { leadId: lead.id };
      // 原负责人 = 打开弹窗时看到的负责人（乐观锁）：别人先分走了回「已被分配」，不覆盖
      const res = await 分配线索({ ...哪条, toUserId: v.toUserId, line: v.line || null, kind: v.kind, 原负责人: lead.ownerId, ...(带待办勾出 ? { 带待办: v.带待办 } : {}) });
      if (!res.ok) {
        set错(res.error);
        return;
      }
      // 分成了：记下这位（下次默认带上）；调用方要写回行里就交给它，没给就关框、这一行刷新后负责人就是 TA，不另弹提示
      记上次接手人(v.toUserId);
      const 名 = 人们?.find((p) => p.userId === v.toUserId)?.name ?? "他";
      分好了?.(名);
      关();
      router.refresh();
    } finally {
      set忙(false);
    }
  }

  return (
    <Modal
      open={!!lead}
      title={lead ? `分配「${lead.name}」` : ""}
      okText={选的名 ? `分给 ${选的名}` : "分配"}
      okButtonProps={{ className: "ls-ld-ok", title: 选的名 ? `分给 ${选的名}` : undefined }}
      cancelText="取消"
      confirmLoading={忙}
      onOk={() => void 分()}
      onCancel={关}
      afterOpenChange={打开了}
      destroyOnHidden
    >
      {错 && <Alert type="error" showIcon role="alert" className="ls-ld-err" title={错} />}
      <p className="muted" style={{ marginTop: 0 }}>{不看配额 ? "只能分给销售或销售管理，分完记进分配记录。" : "只能分给销售或销售管理；配额分满了会拦下，分完记进分配记录。"}</p>
      <Form form={form} layout="vertical" initialValues={{ line: "", kind: "营销", 带待办: 公海规则.带待办默认勾 }}>
        <Form.Item name="toUserId" label="接手人" rules={[{ required: true, message: "选一个接手人" }]}>
          <Select
            showSearch
            optionFilterProp="label"
            loading={人们 === null || (!!lead?.项目 && 项目线 === undefined)}
            placeholder="选销售或销售管理"
            notFoundContent={
              人们 === null || (lead?.项目 && 项目线 === undefined)
                ? "加载中…"
                : lead?.项目 && 项目线 === null
                  ? "这条现在分不了（比如客户已进公海），刷新页面看看"
                  : lead?.项目
                    ? "这条线现在没有正常参与自动分配的销售：请总管理员在 设置 → 组织架构 里看参与状态和各条线的部门"
                    : "组织里还没有销售：先在 设置 → 组织架构 里排好"
            }
            options={选项们
              .map((p) => ({ value: p.userId, label: `${p.name}${p.line ? `（${p.line}）` : ""}${不看配额 ? "" : ` · ${配额说法(p)}`}` }))}
          />
        </Form.Item>
        {lead?.项目 ? (
          <Form.Item
            label="业务线"
            extra="项目上选的业务线；老项目没填按负责人的线，再没有按内贸。接手人只列正常参与自动分配、这条线的销售（暂不分配的项目列全部正常参与的）"
          >
            <span data-testid="assign-line-readonly">
              {项目线 === undefined ? "加载中…" : 项目线 ? 项目线.线 : <span className="muted">取不到，刷新看看</span>}
            </span>
          </Form.Item>
        ) : (
          <Form.Item name="line" label="业务线" extra="选了业务线，只能分给这条线（或没定线）的销售">
            <Select options={[{ value: "", label: "不限" }, { value: "内贸", label: "内贸" }, { value: "外贸", label: "外贸" }]} />
          </Form.Item>
        )}
        <Form.Item name="kind" label="线索种类">
          <Select options={[{ value: "营销", label: "营销" }, { value: "营销企划", label: "营销企划" }]} />
        </Form.Item>
        {框里写了 && 转走?.说法 && <一起转说明 说法={转走.说法} />}
        {带待办勾出 && (
          <Form.Item name="带待办" valuePropName="checked" style={{ marginBottom: 0 }}>
            <Checkbox>原负责人没做完的待办一起转给新负责人</Checkbox>
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}

/** 页头的「我分出去的」：点开看我分出去（或我点分配）的线索现在的状态 */
export function AssignedOutButton() {
  const [开, set开] = useState(false);
  const [行, set行] = useState<分出去的线索[] | null>(null);

  function 打开() {
    set开(true);
    set行(null);
    void 我分出去的线索().then((r) => set行(r ?? []));
  }

  return (
    <>
      <Button icon={<SendOutlined />} onClick={打开}>我分出去的</Button>
      <Modal open={开} title="我分出去的线索" footer={null} width={760} onCancel={() => set开(false)} destroyOnHidden>
        <p className="muted" style={{ marginTop: 0 }}>你分出去、或原来在你名下被分走的线索；同一条分了几次只算最近一次。标「随客户」的是客户转给销售时跟着走的项目，不占额度。</p>
        <Table<分出去的线索>
          size="small"
          rowKey={(r) => r.projectId ?? r.leadId ?? ""}
          loading={行 === null}
          dataSource={行 ?? []}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          locale={{ emptyText: "还没有分出去的线索" }}
          scroll={{ x: 680 }}
          columns={[
            {
              // 长名字在标签前面截断，标签不被挤掉（Windows 窄宽度）
              title: "线索", dataIndex: "name", width: 180,
              render: (v: string, r) => (
                <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <span data-testid="out-name" title={v} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{v}</span>
                  {r.随客户 && <Tag style={{ margin: 0, flexShrink: 0 }}>随客户</Tag>}
                </span>
              ),
            },
            {
              title: "状态", dataIndex: "status", width: 90,
              render: (v: string) => <Tag color={LEAD_STATUS_COLOR[v]} style={{ margin: 0 }}>{v}</Tag>,
            },
            { title: "接手人", dataIndex: "接手人", width: 100, ellipsis: true },
            {
              title: "现在在谁名下", dataIndex: "当前负责人", width: 110, ellipsis: true,
              render: (v: string | null, r) => (v === r.接手人 ? <span className="muted">同接手人</span> : v ?? <span className="muted">—</span>),
            },
            { title: "业务线", dataIndex: "line", width: 80, render: (v: string | null) => v ?? <span className="muted">不限</span> },
            { title: "分配时间", dataIndex: "分配时间", width: 120, render: (v: string) => <span className="muted nowrap">{smartTime(v)}</span> },
          ]}
        />
      </Modal>
    </>
  );
}
