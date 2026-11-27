"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Empty, Input, Modal, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PageHead } from "@/components/ui";
import InlineConfirm from "@/components/InlineConfirm";
import { useViewAs } from "@/components/ViewAsContext";
import { dayjs } from "@/lib/utils";
import { 撤回客户合并申请, 处理客户合并申请, type 合并申请一条 } from "../merge-actions";
import { 凭叫法, 等待工作日, 撤回天数, 拒绝原因上限, 看别人视角话 } from "../merge-request-words";
import "../merge.css";

const 时刻 = (d: Date | string | null) => (d ? dayjs(d).format("YYYY-MM-DD HH:mm") : "");
const 省略 = { ellipsis: true } as const;
const 天 = 86_400_000;
const 网断话 = "没办成，网络可能断了，再点一次";

/** 两家：「并进来那家 → 留下那家」（名字取发起那一刻的快照） */
export const 两家话 = (r: Pick<合并申请一条, "留下" | "并掉">) => `「${r.并掉.名}」并进「${r.留下.名}」`;
/** 已同意几位 / 共几位（发起人不在同意人里，发起即算同意） */
export const 同意进度 = (r: Pick<合并申请一条, "同意人">) => `${r.同意人.filter((x) => x.状态 === "同意").length} / ${r.同意人.length} 位同意`;
/** 还剩几天失效（不足一天按 1 天说；到点了说「今天到期」） */
export function 剩几天(到期: Date | string, 现在 = Date.now()): string {
  const 差 = new Date(到期).getTime() - 现在;
  if (差 <= 0) return "已到期";
  return `还剩 ${Math.max(1, Math.ceil(差 / 天))} 天`;
}
/** 已等几天（发起当天算 0 天，说「今天发起」） */
export function 等了几天(发起: Date | string, 现在 = Date.now()): string {
  const n = Math.floor((现在 - new Date(发起).getTime()) / 天);
  return n <= 0 ? "今天发起" : `已等 ${n} 天`;
}
const 状态色: Record<string, string> = { 待同意: "blue", 执行中: "blue", 已合并: "green", 已拒绝: "red", 已失效: "default", 已作废: "default", 已撤回: "default", 已同意: "blue" };

/** 我发起的一行：服务端可带「显示状态」（作废在库里是已失效，界面和通知都写已作废），没带就用状态 */
type 带显示 = 合并申请一条 & { 显示状态?: string };
const 显示状态 = (r: 带显示) => r.显示状态 ?? r.状态;

/** 一位同意人：「张三 同意」「李四 待同意」「王五 拒绝：原因」 */
const 同意人话 = (x: 合并申请一条["同意人"][number]) => `${x.名} ${x.状态}${x.状态 === "拒绝" && x.一句 ? `：${x.一句}` : ""}`;

/** 我为什么要同意：「并进来那家的客户负责人；2 个项目：项目一、项目二」 */
export function 我的身份话(r: 合并申请一条, 我: string): string {
  const 我那行 = r.同意人.find((x) => x.userId === 我);
  if (!我那行) return "";
  return [...我那行.凭.map((v) => 凭叫法[v]), ...(我那行.项目.length ? [`${我那行.项目.length} 个项目：${我那行.项目.map((p) => p.name).join("、")}`] : [])].join("；");
}

/**
 * 同意框里的后果（P-界面-67）：
 *   - 并掉那家这边（并进来那家的客户负责人，或在它名下有项目的项目负责人）：「同意后，你的 N 个项目挪到留下那家，仍归你」；
 *     N = 我在并进来那家名下、没结束的项目数。N = 0（只是客户负责人、名下没在推的项目）说「这家客户并进留下那家，你名下没有在推的项目要挪」
 *   - 留下那家的同事：「同意后，你的项目不动，客户会多出另一家的联系人和沟通」
 *   - 最后一位（除我以外都同意了）多一句「你是最后一位：同意后立即合并，30 天内发起人可撤回」；不是最后一位写还差几位
 */
export function 同意后果(r: 合并申请一条, 我: string): { 后果: string; 最后一位: boolean; 还差: number } {
  const 我那行 = r.同意人.find((x) => x.userId === 我);
  const 挪 = 我那行 ? 我那行.项目.filter((p) => p.customerId === r.并掉.id).length : 0;
  const 并掉边 = !!我那行 && (我那行.凭.includes("被并客户负责人") || 挪 > 0);
  const 还差 = r.同意人.filter((x) => x.userId !== 我 && x.状态 !== "同意").length;
  const 后果 = 并掉边
    ? 挪 > 0 ? `同意后，你的 ${挪} 个项目挪到留下那家，仍归你。` : "同意后，这家客户并进留下那家，你名下没有在推的项目要挪。"
    : "同意后，你的项目不动，客户会多出另一家的联系人和沟通。";
  return { 后果, 最后一位: 还差 === 0, 还差 };
}

/** 一行放不下省略、悬停看全文（企业版一行 + 省略号规矩） */
const 一行 = (话: string, cls = "") => <span className={`mrg-one ${cls}`.trim()} title={话}>{话}</span>;

type 办完 = { 行: 合并申请一条; 状态: string; 话: string };
type 框 = { 种: "同意" | "拒绝"; 行: 合并申请一条 };

/**
 * 合并申请（第二批 2b-3）：等我同意的一张（同意 / 拒绝），我发起的一张（待同意时可撤回申请）。
 * 表格和卡片两套都渲染、CSS @media 显隐（不靠 JS 判宽，首屏不闪）。电脑：表格固定列宽、单元格省略号（悬停看全），放不下在表格里横滚；手机（≤767）每张一块卡片、一项一行，按钮整行 ≥ 触屏点击区。
 * 同意弹确认框（按我站哪边说后果，最后一位多一句）；拒绝弹框写原因（选填、≤100 字，超了点不了）。
 * 办成了这一行留在表里、置灰写结果（刷新后从「等我同意」里去掉）；没办成原因写在框里、框不关。
 * 只读身份（只读管理员、销售教练、设了只看某人、切换视图在看别人）：列表照常，按钮置灰、悬停写原因；服务端本来就拦
 */
export default function MergeRequestsView({ 等我, 我发起, 我, 只读原因 = null }: { 等我: 合并申请一条[]; 我发起: 合并申请一条[]; 我: string; 只读原因?: string | null }) {
  const router = useRouter();
  const 切换视图 = useViewAs();
  const 不能写 = 只读原因 ?? (切换视图 ? 看别人视角话 : null);
  const [忙, set忙] = useState<string | null>(null);
  /** 撤回没办成的原因：就地写在那一行的操作格里；办成了刷新后这一行变成已撤回 */
  const [行错, set行错] = useState<{ id: string; 话: string } | null>(null);
  const [办了, set办了] = useState<Record<string, 办完>>({});
  const [开着, set开着] = useState<框 | null>(null);
  const [原因, set原因] = useState("");
  const [框错, set框错] = useState<string | null>(null);

  const 撤 = async (id: string) => {
    set忙(id);
    set行错(null);
    const r = await 撤回客户合并申请(id).catch(() => ({ ok: false as const, error: 网断话 }));
    set忙(null);
    if (r.ok) {
      router.refresh();
      return { ok: true };
    }
    set行错({ id, 话: r.error });
    return r;
  };

  const 开 = (种: 框["种"], 行: 合并申请一条) => {
    set开着({ 种, 行 });
    set原因("");
    set框错(null);
  };
  const 关 = () => {
    if (忙) return;
    set开着(null);
  };
  const 超了 = 原因.trim().length > 拒绝原因上限;

  const 定 = async () => {
    if (!开着 || 忙) return;
    const { 种, 行 } = 开着;
    if (种 === "拒绝" && 超了) return;
    set忙(行.id);
    set框错(null);
    const 后 = 种 === "同意" ? 同意后果(行, 我) : null;
    const r = await 处理客户合并申请(行.id, 种, 种 === "拒绝" ? 原因.trim() || undefined : undefined).catch(() => ({ ok: false as const, error: 网断话 }));
    set忙(null);
    if (!r.ok) {
      set框错(r.error);
      // 失效、被别人处理过这类：列表也跟着变；网断了刷新也无妨
      router.refresh();
      return;
    }
    const 完: 办完 = 种 === "拒绝"
      ? { 行, 状态: "已拒绝", 话: `你已拒绝${原因.trim() ? `：${原因.trim()}` : ""}（已通知发起人和其余同意人）` }
      : r.状态 === "已合并"
        ? { 行, 状态: "已合并", 话: `已合并 · ${撤回天数} 天内发起人可撤回` }
        : { 行, 状态: "已同意", 话: 后?.还差 ? `你已同意，还差 ${后.还差} 位` : "你已同意，等其余同意人" };
    set办了((m) => ({ ...m, [行.id]: 完 }));
    set开着(null);
    router.refresh();
  };

  /** 只读时按钮置灰，外面包一层 span 写原因（禁用的按钮自己收不到悬停） */
  const 钮 = (b: ReactNode) => (不能写 ? <span className="mrq-ro" title={不能写}>{b}</span> : b);
  const 处理钮 = (r: 合并申请一条) => (
    <div className="mrq-ops">
      {钮(<Button size="small" type="primary" disabled={!!不能写 || (!!忙 && 忙 !== r.id)} onClick={() => 开("同意", r)} data-testid="merge-request-agree">同意</Button>)}
      {钮(<Button size="small" danger disabled={!!不能写 || (!!忙 && 忙 !== r.id)} onClick={() => 开("拒绝", r)} data-testid="merge-request-reject">拒绝</Button>)}
    </div>
  );
  /** 办成已合并的，进度写「已合并」，不再是办之前的「0 / 1 位同意」 */
  const 进度话 = (r: 合并申请一条) => (办了[r.id]?.状态 === "已合并" ? "已合并" : 同意进度(r));
  const 结果格 = (完: 办完) => (
    <div className="mrq-res" data-testid="merge-request-done">
      <Tag color={状态色[完.状态] ?? "default"}>{完.状态}</Tag>
      {一行(完.话)}
    </div>
  );
  const 撤回钮 = (r: 合并申请一条) => r.状态 === "待同意" && (
    <div className="ls-at-op">
      {不能写
        ? 钮(<Button size="small" disabled data-testid="merge-request-withdraw">撤回申请</Button>)
        : (
          <InlineConfirm 问="撤回后同意人不用再处理，要并得重新发" 是="撤回申请" 中性 做={() => 撤(r.id)}>
            <Button size="small" disabled={!!忙 && 忙 !== r.id} data-testid="merge-request-withdraw">撤回申请</Button>
          </InlineConfirm>
        )}
      {行错?.id === r.id && <div className="ls-row-err" role="alert" title={行错.话}>{行错.话}</div>}
    </div>
  );

  // 办过的留在原位（置灰、写结果），不挪到表底；刷新后已不在「等我同意」里的补到末尾，直到离开这一页
  const 等我行 = [...等我.map((r) => 办了[r.id]?.行 ?? r), ...Object.values(办了).map((x) => x.行).filter((x) => !等我.some((r) => r.id === x.id))];
  const 待处理数 = 等我.filter((r) => !办了[r.id]).length;
  /** 剩一天（含不足一天）标橙 */
  const 剩 = (r: 合并申请一条) => {
    const 话 = 剩几天(r.到期);
    return <span className={话 === "还剩 1 天" || 话 === "已到期" ? "mrq-hot" : ""} title={`${时刻(r.到期)} 前没全部同意就失效`}>{话}</span>;
  };

  const 等我列: ColumnsType<合并申请一条> = [
    { title: "合并", key: "两家", width: 240, ...省略, render: (_, r) => <span title={两家话(r)}>{两家话(r)}</span> },
    { title: "发起人", dataIndex: "发起人", width: 90, ...省略 },
    { title: "要我同意是因为", key: "凭", width: 220, ...省略, render: (_, r) => <span title={我的身份话(r, 我)}>{我的身份话(r, 我)}</span> },
    { title: "进度", key: "进度", width: 100, render: (_, r) => 进度话(r) },
    { title: "发起时间", dataIndex: "发起", width: 140, render: 时刻 },
    { title: "失效", key: "到期", width: 90, render: (_, r) => (办了[r.id] ? "—" : 剩(r)) },
    { title: "", key: "op", width: 200, render: (_, r) => (办了[r.id] ? 结果格(办了[r.id]) : 处理钮(r)) },
  ];
  const 我发起时间 = (r: 合并申请一条) => (r.状态 === "待同意" ? `${等了几天(r.发起)}，${剩几天(r.到期)}` : r.结束 ? `${时刻(r.结束)} 结束` : 时刻(r.发起));
  const 我发起时间全 = (r: 合并申请一条) => `${时刻(r.发起)} 发起${r.原因 ? `；${r.原因}` : ""}`;
  const 我发起列: ColumnsType<合并申请一条> = [
    { title: "合并", key: "两家", width: 260, ...省略, render: (_, r) => <span title={两家话(r)}>{两家话(r)}</span> },
    { title: "状态", key: "状态", width: 90, render: (_, r) => <Tag color={状态色[显示状态(r)] ?? "default"}>{显示状态(r)}</Tag> },
    { title: "同意人", key: "同意人", width: 260, ...省略, render: (_, r) => { const 话 = r.同意人.map(同意人话).join("，"); return <span title={话}>{话}</span>; } },
    { title: "时间", key: "时间", width: 170, ...省略, render: (_, r) => <span title={我发起时间全(r)}>{我发起时间(r)}</span> },
    { title: "", key: "op", width: 150, render: (_, r) => 撤回钮(r) },
  ];

  /** 手机：一张一块，「项 值」一行一项，值一行省略 */
  const 项 = (k: string, v: ReactNode) => (
    <div className="mrq-kv">
      <span className="mrq-k">{k}</span>
      <span className="mrq-v">{v}</span>
    </div>
  );
  const 等我卡 = (r: 合并申请一条) => (
    <li key={r.id} className={`mrq-item${办了[r.id] ? " is-done" : ""}`} data-testid="merge-req-wait-item">
      {项("合并", 一行(两家话(r)))}
      {项("发起人", 一行(r.发起人))}
      {项("因为", 一行(我的身份话(r, 我)))}
      {项("进度", 一行(进度话(r)))}
      {!办了[r.id] && 项("失效", 剩(r))}
      {办了[r.id] ? 结果格(办了[r.id]) : 处理钮(r)}
    </li>
  );
  const 我发起卡 = (r: 合并申请一条) => (
    <li key={r.id} className="mrq-item" data-testid="merge-req-mine-item">
      {项("合并", 一行(两家话(r)))}
      {项("状态", <Tag color={状态色[显示状态(r)] ?? "default"}>{显示状态(r)}</Tag>)}
      {项("同意人", 一行(r.同意人.map(同意人话).join("，")))}
      {项("时间", <span className="mrg-one" title={我发起时间全(r)}>{我发起时间(r)}</span>)}
      {撤回钮(r)}
    </li>
  );

  const 框行 = 开着?.行;
  const 后 = 开着?.种 === "同意" && 框行 ? 同意后果(框行, 我) : null;

  return (
    <div>
      <PageHead title="合并申请" subtitle={`同事负责的客户，或名下有同事在推的项目，合并要发申请：要同意的人都同意了才合并；${等待工作日} 个工作日内没全部同意，申请失效`} />
      <div className="mrq-stack">
        {不能写 && <Alert type="info" showIcon title={`${不能写}：列表照常显示，同意、拒绝、撤回按钮都点不了`} data-testid="merge-req-ro" />}
        <Card title={<span>等我同意{待处理数 ? <span className="mrq-cnt">{待处理数} 张等你处理</span> : null}</span>} size="small">
          {等我行.length
            ? (
              <>
                <div className="mrq-wide"><Table rowKey="id" size="small" columns={等我列} dataSource={等我行} pagination={false} tableLayout="fixed" scroll={{ x: 1080 }} rowClassName={(r) => (办了[r.id] ? "mrq-done" : "")} data-testid="merge-req-wait" /></div>
                <ul className="mrq-list mrq-narrow" data-testid="merge-req-wait-list">{等我行.map(等我卡)}</ul>
              </>
            )
            : <Empty description="没有等你同意的合并申请" />}
        </Card>
        <Card title="我发起的" size="small">
          {我发起.length
            ? (
              <>
                <div className="mrq-wide"><Table rowKey="id" size="small" columns={我发起列} dataSource={我发起} pagination={false} tableLayout="fixed" scroll={{ x: 930 }} data-testid="merge-req-mine" /></div>
                <ul className="mrq-list mrq-narrow" data-testid="merge-req-mine-list">{我发起.map(我发起卡)}</ul>
              </>
            )
            : <Empty description="还没发过合并申请" />}
        </Card>
      </div>

      <Modal
        open={!!开着}
        onCancel={关}
        title={开着?.种 === "拒绝" ? "拒绝这张合并申请" : "同意这张合并申请？"}
        width={520}
        className="mrg-modal"
        destroyOnHidden
        maskClosable={!忙}
        footer={(
          <div className="mrg-foot">
            <span className="mrg-foot-sp" />
            <Button onClick={关} disabled={!!忙}>取消</Button>
            {开着?.种 === "拒绝"
              ? <Button type="primary" danger loading={!!忙} disabled={超了} onClick={() => void 定()} data-testid="merge-request-reject-ok">确认拒绝</Button>
              : <Button type="primary" loading={!!忙} onClick={() => void 定()} data-testid="merge-request-agree-ok">确认同意</Button>}
          </div>
        )}
      >
        {框行 && (
          <div className="mrg-body" data-testid="merge-request-box">
            <div className="mrq-two">
              <div className="mrq-two-r"><span className="mrq-tg">留下</span>{一行(框行.留下.名)}</div>
              <div className="mrq-two-r"><span className="mrq-tg">并掉</span>{一行(框行.并掉.名)}</div>
            </div>
            {后 && (
              <>
                <p className="mrq-eff" data-testid="merge-request-effect">{后.后果}</p>
                {后.最后一位
                  ? <p className="mrq-last" data-testid="merge-request-last">你是最后一位：同意后立即合并，{撤回天数} 天内发起人可撤回。</p>
                  : <p className="mrq-mu">还差 {后.还差} 位同意才合并。</p>}
              </>
            )}
            {开着?.种 === "拒绝" && (
              <>
                <label className="mrq-lbl" htmlFor="mrq-why">拒绝原因（选填，最多 {拒绝原因上限} 字）</label>
                <Input.TextArea id="mrq-why" value={原因} onChange={(e) => set原因(e.target.value)} autoSize={{ minRows: 2, maxRows: 5 }} placeholder="写一句，发起人和其余同意人会看到" data-testid="merge-request-why" />
                <div className="mrq-count">
                  <span className={超了 ? "is-over" : ""} role={超了 ? "alert" : undefined}>{超了 ? `超出 ${原因.trim().length - 拒绝原因上限} 字` : ""}</span>
                  <span className={超了 ? "is-over" : ""}>{原因.trim().length} / {拒绝原因上限}</span>
                </div>
                <p className="mrq-mu">一位拒绝整张就「已拒绝」，发起人和其余同意人会收到通知；发起人可以改了再发一张。</p>
              </>
            )}
            {框错 && <Alert type="warning" showIcon title={框错} data-testid="merge-request-err" />}
          </div>
        )}
      </Modal>
    </div>
  );
}
