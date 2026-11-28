"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Input, Modal, Tag } from "antd";
import InlineConfirm from "@/components/InlineConfirm";
import { useViewAs } from "@/components/ViewAsContext";
import { dayjs } from "@/lib/utils";
import { 撤回跨并申请单, 处理跨并, 作废跨并申请单, type 跨并申请一条 } from "../merge-actions";
import { 撤回天数, 拒绝原因上限, 看别人视角话, 等待工作日 } from "../merge-request-words";
import "../merge.css";

const 时刻 = (d: Date | string | null) => (d ? dayjs(d).format("YYYY-MM-DD HH:mm") : "");
const 天 = 86_400_000;
const 网断话 = "没办成，网络可能断了，再点一次";
const 状态色: Record<string, string> = { 待确认: "blue", 执行中: "blue", 已合并: "green", 已拒绝: "red", 已失效: "default", 已撤回: "default" };

/** 还剩几天失效（不足一天按 1 天说；到点了说「已到期」） */
export function 跨并剩几天(到期: Date | string, 现在 = Date.now()): string {
  const 差 = new Date(到期).getTime() - 现在;
  return 差 <= 0 ? "已到期" : `还剩 ${Math.max(1, Math.ceil(差 / 天))} 天`;
}
/** 「B（负责人） → A（负责人）」：被并走的并进留下的 */
export const 跨并两个话 = (r: Pick<跨并申请一条, "留下" | "并掉">) => `「${r.并掉.名}」（${r.并掉.负责人}）并进「${r.留下.名}」（${r.留下.负责人}）`;
const 一行 = (话: string) => <span className="mrg-one" title={话}>{话}</span>;

type 办完 = { 行: 跨并申请一条; 状态: string; 话: string; 作废?: true };

/**
 * 合并申请页「项目合并」一节（跨负责人合并，E-380 阶段 2；通知都链到这里的 #xmerge）：
 *   等我确认：被并走那个项目的负责人的上级 / 条线总管理（都没有给系统管理员）在这里确认或拒绝（拒绝原因必填、≤100 字）；
 *   我发起的：待确认时可撤回申请，结束了的看结果。
 * 每张一块，电脑和手机同一套（一项一行、值一行省略悬停看全）；手机（≤767）按钮整行 ≥ 触屏点击区。办成了这一块留着置灰写结果，没办成原因写在框里、框不关。
 * 只读身份、切换视图在看别人：列表照常，按钮置灰悬停写原因；服务端本来就拦
 */
export default function ProjectMergeRequests({ 等我, 我发起, 可作废 = [], 只读原因 = null }: { 等我: 跨并申请一条[]; 我发起: 跨并申请一条[]; /** 系统管理员才有：所有待确认的申请，可作废（原因必填） */ 可作废?: 跨并申请一条[]; 只读原因?: string | null }) {
  const router = useRouter();
  const 切换视图 = useViewAs();
  const 不能写 = 只读原因 ?? (切换视图 ? 看别人视角话 : null);
  const [忙, set忙] = useState<string | null>(null);
  const [行错, set行错] = useState<{ id: string; 话: string } | null>(null);
  const [办了, set办了] = useState<Record<string, 办完>>({});
  const [开着, set开着] = useState<{ 种: "确认" | "拒绝" | "作废"; 行: 跨并申请一条 } | null>(null);
  const [原因, set原因] = useState("");
  const [框错, set框错] = useState<string | null>(null);
  if (!等我.length && !我发起.length && !可作废.length && !Object.keys(办了).length) return null;

  const 超了 = 原因.trim().length > 拒绝原因上限;
  const 没写 = 开着?.种 !== "确认" && !!开着 && !原因.trim();
  const 开 = (种: "确认" | "拒绝" | "作废", 行: 跨并申请一条) => { set开着({ 种, 行 }); set原因(""); set框错(null); };
  const 关 = () => { if (!忙) set开着(null); };
  const 定 = async () => {
    if (!开着 || 忙 || 超了 || 没写) return;
    const { 种, 行 } = 开着;
    set忙(行.id);
    set框错(null);
    const r = 种 === "作废"
      ? await 作废跨并申请单(行.id, 原因.trim()).catch(() => ({ ok: false as const, error: 网断话 }))
      : await 处理跨并(行.id, 种, 种 === "拒绝" ? 原因.trim() : undefined).catch(() => ({ ok: false as const, error: 网断话 }));
    set忙(null);
    if (!r.ok) { set框错(r.error); router.refresh(); return; }
    set办了((m) => ({ ...m, [行.id]: 种 === "作废"
      ? { 行, 状态: "已失效", 话: `你已作废：${原因.trim()}（已通知发起人和确认人）`, 作废: true }
      : 种 === "拒绝"
      ? { 行, 状态: "已拒绝", 话: `你已拒绝：${原因.trim()}（已通知发起人）` }
      : { 行, 状态: "已合并", 话: `已合并 · ${撤回天数} 天内可在「历史变更」里撤回` } }));
    set开着(null);
    router.refresh();
  };
  const 撤 = async (id: string) => {
    set忙(id);
    set行错(null);
    const r = await 撤回跨并申请单(id).catch(() => ({ ok: false as const, error: 网断话 }));
    set忙(null);
    if (r.ok) { router.refresh(); return { ok: true }; }
    set行错({ id, 话: r.error });
    return r;
  };

  const 钮 = (b: ReactNode) => (不能写 ? <span className="mrq-ro" title={不能写}>{b}</span> : b);
  const 项 = (k: string, v: ReactNode) => (
    <div className="mrq-kv"><span className="mrq-k">{k}</span><span className="mrq-v">{v}</span></div>
  );
  const 共同项 = (r: 跨并申请一条) => (
    <>
      {项("合并", 一行(跨并两个话(r)))}
      {项("客户", 一行(r.客户))}
      {项("沟通", 一行(`被并走 ${r.并掉.沟通} 条，留下 ${r.留下.沟通} 条`))}
    </>
  );
  const 等我卡 = (r: 跨并申请一条) => {
    const 完 = 办了[r.id];
    return (
      <li key={r.id} className={`mrq-item${完 ? " is-done" : ""}`} data-testid="xmerge-wait-item">
        {共同项(r)}
        {项("发起人", 一行(r.发起人))}
        {项("失效", <span className={跨并剩几天(r.到期) === "还剩 1 天" ? "mrq-hot" : ""} title={`${时刻(r.到期)} 前没人确认就失效`}>{完 ? "—" : 跨并剩几天(r.到期)}</span>)}
        {完
          ? <div className="mrq-res" data-testid="xmerge-done"><Tag color={状态色[完.状态] ?? "default"}>{完.状态}</Tag>{一行(完.话)}</div>
          : (
            <div className="mrq-ops">
              {钮(<Button size="small" type="primary" disabled={!!不能写 || (!!忙 && 忙 !== r.id)} onClick={() => 开("确认", r)} data-testid="xmerge-confirm">确认</Button>)}
              {钮(<Button size="small" danger disabled={!!不能写 || (!!忙 && 忙 !== r.id)} onClick={() => 开("拒绝", r)} data-testid="xmerge-reject">拒绝</Button>)}
            </div>
          )}
      </li>
    );
  };
  const 我发起卡 = (r: 跨并申请一条) => (
    <li key={r.id} className="mrq-item" data-testid="xmerge-mine-item">
      {共同项(r)}
      {项("状态", <Tag color={状态色[r.状态] ?? "default"}>{r.状态}</Tag>)}
      {项("确认人", 一行(r.确认人.map((x) => `${x.名}（${x.层级}）`).join("、")))}
      {项("时间", <span className="mrg-one" title={`${时刻(r.发起)} 发起${r.原因 ? `；${r.原因}` : ""}`}>{r.状态 === "待确认" ? `${跨并剩几天(r.到期)}失效` : r.结束 ? `${时刻(r.结束)} 结束${r.原因 ? `：${r.原因}` : ""}` : 时刻(r.发起)}</span>)}
      {r.状态 === "待确认" && (
        <div className="ls-at-op">
          {不能写
            ? 钮(<Button size="small" disabled data-testid="xmerge-withdraw">撤回申请</Button>)
            : (
              <InlineConfirm 问="撤回后确认人不用再处理，要并得重新发" 是="撤回申请" 中性 做={() => 撤(r.id)}>
                <Button size="small" disabled={!!忙 && 忙 !== r.id} data-testid="xmerge-withdraw">撤回申请</Button>
              </InlineConfirm>
            )}
          {行错?.id === r.id && <div className="ls-row-err" role="alert" title={行错.话}>{行错.话}</div>}
        </div>
      )}
    </li>
  );

  const 作废卡 = (r: 跨并申请一条) => (
    <li key={r.id} className={`mrq-item${办了[r.id] ? " is-done" : ""}`} data-testid="xmerge-void-item">
      {共同项(r)}
      {项("发起人", 一行(r.发起人))}
      {项("确认人", 一行(r.确认人.map((x) => `${x.名}（${x.层级}）`).join("、")))}
      {办了[r.id]
        ? <div className="mrq-res" data-testid="xmerge-done"><Tag color="default">已失效</Tag>{一行(办了[r.id].话)}</div>
        : <div className="mrq-ops">{钮(<Button size="small" danger disabled={!!不能写 || (!!忙 && 忙 !== r.id)} onClick={() => 开("作废", r)} data-testid="xmerge-void">作废申请</Button>)}</div>}
    </li>
  );
  const 等我行 = [...等我.map((r) => 办了[r.id]?.行 ?? r), ...Object.values(办了).filter((x) => !x.作废).map((x) => x.行).filter((x) => !等我.some((r) => r.id === x.id))];
  const 待处理数 = 等我.filter((r) => !办了[r.id]).length;
  const 要等我卡 = 等我行.filter((r) => !办了[r.id]?.作废);
  const 框行 = 开着?.行;
  return (
    <div id="xmerge" className="mrq-stack">
      {要等我卡.length > 0 && (
        <Card title={<span>项目合并 · 等我确认{待处理数 ? <span className="mrq-cnt">{待处理数} 张等你处理</span> : null}</span>} size="small">
          <ul className="mrq-list" data-testid="xmerge-wait-list">{要等我卡.map(等我卡)}</ul>
        </Card>
      )}
      {可作废.length > 0 && (
        <Card title="项目合并 · 系统管理员：待确认的申请" size="small">
          <ul className="mrq-list" data-testid="xmerge-void-list">{可作废.map(作废卡)}</ul>
        </Card>
      )}
      {我发起.length > 0 && (
        <Card title="项目合并 · 我发起的" size="small">
          <ul className="mrq-list" data-testid="xmerge-mine-list">{我发起.map(我发起卡)}</ul>
        </Card>
      )}
      <Modal
        open={!!开着}
        onCancel={关}
        title={开着?.种 === "作废" ? "作废这张项目合并申请" : 开着?.种 === "拒绝" ? "拒绝这张项目合并申请" : "确认这张项目合并申请？"}
        width={520}
        className="mrg-modal"
        destroyOnHidden
        maskClosable={!忙}
        footer={(
          <div className="mrg-foot">
            <span className="mrg-foot-sp" />
            <Button onClick={关} disabled={!!忙}>取消</Button>
            {开着?.种 === "拒绝" || 开着?.种 === "作废"
              ? <Button type="primary" danger loading={!!忙} disabled={超了 || 没写} onClick={() => void 定()} data-testid={开着.种 === "作废" ? "xmerge-void-ok" : "xmerge-reject-ok"}>{开着.种 === "作废" ? "确认作废" : "确认拒绝"}</Button>
              : <Button type="primary" loading={!!忙} onClick={() => void 定()} data-testid="xmerge-confirm-ok">确认合并</Button>}
          </div>
        )}
      >
        {框行 && (
          <div className="mrg-body" data-testid="xmerge-box">
            <div className="mrq-two">
              <div className="mrq-two-r"><span className="mrq-tg">留下</span>{一行(`${框行.留下.名}（${框行.留下.负责人}）`)}</div>
              <div className="mrq-two-r"><span className="mrq-tg">并走</span>{一行(`${框行.并掉.名}（${框行.并掉.负责人}）`)}</div>
            </div>
            {开着?.种 === "作废"
              ? (
                <>
                  <label className="mrq-lbl" htmlFor="xmerge-why">作废原因（必填，最多 {拒绝原因上限} 字）</label>
                  <Input.TextArea id="xmerge-why" value={原因} onChange={(e) => set原因(e.target.value)} autoSize={{ minRows: 2, maxRows: 5 }} placeholder="写一句，发起人和确认人会看到" data-testid="xmerge-why" />
                  <div className="mrq-count">
                    <span className={超了 ? "is-over" : ""} role={超了 ? "alert" : undefined}>{超了 ? `超出 ${原因.trim().length - 拒绝原因上限} 字` : ""}</span>
                    <span className={超了 ? "is-over" : ""}>{原因.trim().length} / {拒绝原因上限}</span>
                  </div>
                  <p className="mrq-mu">作废后申请结束为已失效，发起人和确认人收到通知；用于确认人停用、等不到人时。</p>
                </>
              )
              : 开着?.种 === "确认"
              ? <p className="mrq-eff" data-testid="xmerge-effect">确认后立即合并：「{框行.并掉.名}」的沟通、附件、联系人并进「{框行.留下.名}」，归{框行.留下.负责人}；它结束为重复线索，不退还已占线索名额；{撤回天数} 天内可撤回。{框行.并掉.负责人}不用事先同意，并后会收到通知。</p>
              : (
                <>
                  <label className="mrq-lbl" htmlFor="xmerge-why">拒绝原因（必填，最多 {拒绝原因上限} 字）</label>
                  <Input.TextArea id="xmerge-why" value={原因} onChange={(e) => set原因(e.target.value)} autoSize={{ minRows: 2, maxRows: 5 }} placeholder="写一句，发起人会看到" data-testid="xmerge-why" />
                  <div className="mrq-count">
                    <span className={超了 ? "is-over" : ""} role={超了 ? "alert" : undefined}>{超了 ? `超出 ${原因.trim().length - 拒绝原因上限} 字` : ""}</span>
                    <span className={超了 ? "is-over" : ""}>{原因.trim().length} / {拒绝原因上限}</span>
                  </div>
                  <p className="mrq-mu">拒绝后申请结束，发起人收到通知；两个项目的验证计时重新起算。{等待工作日} 个工作日内没人处理会自动失效。</p>
                </>
              )}
            {框错 && <Alert type="warning" showIcon title={框错} data-testid="xmerge-err" />}
          </div>
        )}
      </Modal>
    </div>
  );
}
