"use client";
/**
 * 转让框（原型 cu.transfer「改后」）：原来是三层——选人下拉 → 「会一起转走的项目」框 → 「转让原因」框，合成一个：
 *   选人（默认上次选的，可改；人多可搜）→ 一起转走的项目（换人现取）→ 什么时候生效 → 转让原因（可不选）。
 * 负责人本人转自己的 = 申请移交（P-转-16 / P-转-01 ①）：写进框里——「X 确认后生效，确认前仍在你名下；7 天不确认自动作废」，
 * 确认键叫「转给 X」；上级、条线总管理、系统管理员直接转（服务端 转让走交接 说了算，这里只是提前说）。
 * 转这件事在框里做：没成（权限被挡、交接中……）原因写在框里、框不关，可以改人再点；成了才关。
 * 样式沿用后果框（.csq-*），框外加 .cu-tr-*。
 * 市场成员批量转让（客户 11-17，同客户详情的单个转让框）：勾的里有「暂不分配」的客户（服务端预看，判定同单个那份）才摆「指定分配 / 自动分配」，默认指定。
 *   自动 = 不选人，服务端一位一位按新线索的自动分配挑销售（按客户区域定内贸 / 外贸、本月分得最少的优先，前面刚分出去的算进去）；
 *   勾到的不是暂不分配的那几位不自动分、框里先说清楚为什么，留在原处（可以改用指定分配）。分完框里原地列出分给了谁、几位没分成及原因
 */
import { 指定选项 } from "@/lib/enterprise/designate-options";
import { useEffect, useRef, useState } from "react";
import { Button, Input, Modal, Select } from "antd";
import { 其他项, 其他补充上限, 合其他 } from "@/lib/enterprise/dict-kinds";
import { 转走项目说法, type 转走项目预览 } from "@/lib/carry-over";
import { 跑出原因, type 做的结果 } from "@/lib/confirm-result";
import { 移交作废天数 } from "@/lib/enterprise/handover-expire-days";
import { 转走项目列表 } from "./useCarryConfirm";
import { 逐项选块, 说明框, 默认选, 随转的, type 逐项选择 } from "./TransferItemized";
import { 自动分配说明, 自动分配生效话 } from "@/lib/enterprise/cust-auto-assign-words";
import { 动作出错话 } from "@/lib/stale-deploy";
import { 按方向挑, 指定方向话, type 指定候选表 } from "@/lib/enterprise/assign-direction-pick-core";
import type { 线 } from "@/lib/enterprise/lead-assign";

export type 人 = { value: string; label: string };
/** 批量自动分配预看：勾的里能自动分的有几位、不能的是谁为什么 */
export type 自动预看 = { 可: number; 不可: { name: string; error: string }[];
  /** 摆了「指定 / 自动」时选指定，接手人下拉只列这些人（参与状态正常，审核 11-18 追加；服务端 市场分配指定挡 同口径）；没给 = 不筛 */
  可指定?: string[];
  /** 指定分配也先定方向（P-转-26，11-18）：勾的里有市场成员要按方向指定的才给；默认线 null = 这几位默认不一样 / 判不出，要人选 */
  定向?: { 候选表: 指定候选表; 默认线: 线 | null } };
/** 批量自动分配的结果：分给了谁、哪几位没分成为什么 */
export type 自动结果 = { ok: false; error: string } | { ok: true; 分成: { name: string; 接手人: string }[]; 没成: { name: string; error: string }[] };
type 方式 = "指定" | "自动";
/** 按某一格归拢成行：「接手人：客户A、客户B」「客户A、客户B：原因」，同一句不重复刷屏 */
function 归拢<T>(们: readonly T[], 键: (x: T) => string, 名: (x: T) => string, 拼: (键: string, 名们: string) => string): string[] {
  const m = new Map<string, string[]>();
  for (const x of 们) m.set(键(x), [...(m.get(键(x)) ?? []), 名(x)]);
  return [...m].map(([k, ns]) => 拼(k, ns.join("、")));
}
const 上次键 = "cust-transfer-last";

/** 上次转给的人（这台浏览器记的）；读不到就算了 */
export function 上次转给(): string | undefined {
  try {
    return localStorage.getItem(上次键) ?? undefined;
  } catch {
    return undefined;
  }
}
function 记上次(id: string) {
  try {
    localStorage.setItem(上次键, id);
  } catch {
    /* 隐私窗口等：不记 */
  }
}

export default function TransferDialog({
  open,
  onClose,
  题,
  人们 = [],
  固定人,
  取转走,
  申请,
  原因选项 = [],
  自己,
  是字,
  做,
  自动,
  批量,
}: {
  open: boolean;
  onClose: (成了: boolean) => void;
  /** 标题：「把 3 位客户转给」「把客户转让给「X」」 */
  题: string;
  /** 可选的接手人；给了 固定人 就不摆选人 */
  人们?: 人[];
  固定人?: 人;
  /** 换人就现取「会一起转走的项目」；不给 = 不说 */
  取转走?: (人id: string) => Promise<转走项目预览 | null | undefined>;
  /**
   * 转给这位要不要接手人确认（申请移交）。不给 = 看 取转走 回来的「要确认」（服务端同一个判定）；
   * 两边都说不清 = 生效那条写中性说法，不写错
   */
  申请?: boolean;
  /** 字典「转让原因」；空 = 不问 */
  原因选项?: readonly string[];
  /** 我是谁：转给自己不问原因 */
  自己?: string;
  /** 确认键的字；不给 = 「转给 X」 */
  是字?: string;
  做: (人id: string, 原因: string | null, 方向?: 线, 逐项?: { 说明?: string; 随转?: string[] }) => 做的结果 | Promise<做的结果>;
  /**
   * 市场成员批量转让才给（页面判了是市场成员、规则开着）：打开时 预看 一次，勾的里有能自动分的才摆「指定分配 / 自动分配」；
   * 预看回 null（不是市场成员、出错）= 不摆，框和原来一样
   */
  /** 一次转多位客户：框里说一句同事项目都保留（12-22） */
  批量?: boolean;
  自动?: { 预看: () => Promise<自动预看 | null>; 做: (原因: string | null) => Promise<自动结果> };
}) {
  const 默认 = () => 固定人?.value ?? (人们.some((p) => p.value === 上次转给()) ? 上次转给() : undefined);
  const [谁, set谁] = useState<string | undefined>(默认);
  const [选, set选] = useState<string | null>(null);
  const [写, set写] = useState("");
  const [忙, set忙] = useState(false);
  const [错, set错] = useState("");
  const [转走, set转走] = useState<{ 谁: string; 说法: ReturnType<typeof 转走项目说法>; 要确认?: boolean; 原?: 转走项目预览 | null } | null>(null);
  /** 12-22 逐项选（只选了一位客户时服务端才列同事项目）+ 上级直接转必填的原因 */
  const [逐项, set逐项] = useState<逐项选择>({});
  const [说明, set说明] = useState("");
  const [法, set法] = useState<方式>("指定");
  /** 指定分配的方向（P-转-26）：人改了才有；没改 = 预看给的默认线 */
  const [向, set向] = useState<线 | null>(null);
  /** 自动分配预看：null = 还没回 / 不给自动 */
  const [预看, set预看] = useState<自动预看 | null>(null);
  /** 自动分配分完（至少分出去一位）：框里原地列结果，只剩「知道了」 */
  const [分完, set分完] = useState<Extract<自动结果, { ok: true }> | null>(null);
  const 写框 = useRef<HTMLInputElement>(null);

  // 每次打开从头来（同后果框）：渲染时比上一次的 open
  const [上次开, set上次开] = useState(open);
  if (open !== 上次开) {
    set上次开(open);
    if (open) {
      set谁(默认());
      set选(null);
      set写("");
      set错("");
      set忙(false);
      set转走(null);
      set逐项({});
      set说明("");
      set法("指定");
      set向(null);
      set预看(null);
      set分完(null);
    }
  }

  const 有固定人 = !!固定人;
  useEffect(() => {
    if (!open || !自动) return;
    let 还在 = true;
    // 取不到不摆选择：照原来指定分配
    自动.预看().then(
      (x) => {
        if (!还在) return;
        set预看(x);
        // 默认挑的（上次转给的）不在默认方向能接的人里：清掉，别带着一个会被拒的人
        const 定 = x?.定向;
        if (定 && !有固定人) set谁((w) => (w && 按方向挑(定.候选表, 定.默认线).includes(w) ? w : undefined));
      },
      () => 还在 && set预看(null),
    );
    return () => {
      还在 = false;
    };
  }, [open, 自动, 有固定人]);
  /** 摆不摆「指定分配 / 自动分配」：勾的里至少一位能自动分 */
  const 有自动 = !!自动 && !!预看 && 预看.可 > 0;
  const 自动中 = 有自动 && 法 === "自动";
  /** 市场分配（摆了「指定 / 自动」）选指定：只列能被指定的；普通批量转让照旧 */
  const 列的人 = 有自动 ? 指定选项(人们, 预看?.可指定, null, 谁) : 人们;
  /** 指定也定方向（P-转-26）：预看给了定向才摆方向格，下拉只列这个方向能接的人；没定（默认不一样 / 判不出）= 两条线都列，服务端每位按各自默认核 */
  const 定向 = !自动中 && !固定人 ? 预看?.定向 : undefined;
  const 指定线 = 定向 ? 向 ?? 定向.默认线 : null;
  const 可挑 = 定向 ? new Set(按方向挑(定向.候选表, 指定线)) : null;
  const 列的人们 = 可挑 ? 列的人.filter((p) => 可挑.has(p.value)) : 列的人;

  useEffect(() => {
    if (!open || !谁 || !取转走) return;
    let 还在 = true;
    取转走(谁).then(
      (p) => { if (!还在) return; set转走({ 谁, 说法: 转走项目说法(p), 要确认: p?.要确认, 原: p }); set逐项(默认选(p)); },
      // 取不到不拦着：转本身照样会带走项目，这里只是提前说
      () => 还在 && set转走({ 谁, 说法: null }),
    );
    return () => {
      还在 = false;
    };
  }, [open, 谁, 取转走]);

  const 名 = 固定人?.label ?? 人们.find((p) => p.value === 谁)?.label ?? "";
  const 要原因 = 原因选项.length > 0 && (自动中 || 谁 !== 自己);
  const 要说明 = !自动中 && !!谁 && !!转走 && 转走.谁 === 谁 && !!转走.原?.要说明;
  const 原因齐 = !要原因 || 选 !== 其他项 || !!写.trim();
  const 转走好了 = !取转走 || (转走 && 转走.谁 === 谁);
  const 能转 = (自动中 || !!谁) && 原因齐 && !忙 && (!要说明 || !!说明.trim());
  /** true 要确认 / false 直接生效 / undefined 说不清（还在取、取不到） */
  const 是申请: boolean | undefined = !谁 ? undefined : 申请 ?? (转走好了 ? 转走?.要确认 : undefined);

  async function 自动分() {
    if (!能转 || !自动) return;
    set忙(true);
    set错("");
    let r: 自动结果;
    try {
      r = await 自动.做(要原因 ? 合其他(选, 写) : null);
    } catch (出错) {
      r = { ok: false, error: 动作出错话(出错, "没分成，请稍后再试") };
    }
    set忙(false);
    if (!r.ok) return set错(r.error);
    // 一位都没分出去：什么都没动，原因写在框里、框不关，可以改用指定分配
    if (!r.分成.length) return set错(`一位都没分出去：${r.没成.map((x) => `${x.name}：${x.error}`).join("；") || "没有能自动分的客户"}`);
    set分完(r);
  }

  async function 转() {
    if (自动中) return 自动分();
    if (!能转 || !谁) return;
    set忙(true);
    set错("");
    const 因 = await 跑出原因(() => 做(谁, 要原因 && !要说明 ? 合其他(选, 写) : null, 定向 ? 向 ?? undefined : undefined, 要说明 ? { 说明: 说明.trim(), 随转: 随转的(逐项) } : undefined));
    set忙(false);
    if (因) return set错(因);
    if (!固定人) 记上次(谁);
    onClose(true);
  }
  const 取消 = () => {
    if (!忙) onClose(!!分完);
  };

  return (
    <Modal
      open={open}
      onCancel={取消}
      title={题}
      width={480}
      maskClosable={!忙}
      keyboard={!忙}
      closable={false}
      destroyOnHidden
      className="csq cu-tr"
      footer={
        <div className="csq-foot">
          {分完 ? (
            <Button type="primary" onClick={() => onClose(true)}>
              知道了
            </Button>
          ) : (
            <>
              <Button onClick={取消} disabled={忙}>
                取消
              </Button>
              <Button type="primary" loading={忙} disabled={!能转 && !忙} onClick={() => void 转()}>
                {自动中 ? `自动分配 ${预看!.可} 位` : 是字 ?? (名 ? `转给${名}` : "转让")}
              </Button>
            </>
          )}
        </div>
      }
    >
      {分完 ? (
        <div role="status" className="cu-tr-done">
          <ul className="csq-list">
            <li className="csq-row">
              <span className="csq-tag">已分配</span>
              <span className="csq-t">
                已自动分配 {分完.分成.length} 位
                <名单 行={归拢(分完.分成, (x) => x.接手人, (x) => x.name, (人, 名们) => `${人}：${名们}`)} />
              </span>
            </li>
            {分完.没成.length > 0 && (
              <li className="csq-row">
                <span className="csq-tag" data-level="警">
                  没分成
                </span>
                <span className="csq-t">
                  {分完.没成.length} 位没分成，还在原负责人名下
                  <名单 行={归拢(分完.没成, (x) => x.error, (x) => x.name, (因, 名们) => `${名们}：${因}`)} />
                </span>
              </li>
            )}
          </ul>
        </div>
      ) : (
        <>
          {有自动 && (
            <div className="cu-tr-way csq-chips" role="radiogroup" aria-label="分配方式">
              {(["指定", "自动"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={法 === m}
                  className="csq-chip"
                  disabled={忙}
                  onClick={() => {
                    set法(m);
                    set错("");
                  }}
                >
                  {m}分配
                </button>
              ))}
            </div>
          )}
          {自动中 && 预看 && (
            <ul className="csq-list" data-testid="transfer-auto">
              <li className="csq-row">
                <span className="csq-tag">转给</span>
                <span className="csq-t" data-testid="transfer-auto-note">
                  {自动分配说明}；{预看.可} 位一位一位挑，前面刚分出去的算进本月数，不会都给同一个人
                </span>
              </li>
              {预看.不可.length > 0 && (
                <li className="csq-row">
                  <span className="csq-tag" data-level="警">
                    不自动分
                  </span>
                  <span className="csq-t" data-testid="transfer-auto-skip">
                    {预看.不可.length} 位不会自动分，留在原处（要转请用指定分配）
                    <名单 行={归拢(预看.不可, (x) => x.error, (x) => x.name, (因, 名们) => `${名们}：${因}`)} />
                  </span>
                </li>
              )}
              <li className="csq-row">
                <span className="csq-tag" data-level="警">
                  生效
                </span>
                <span className="csq-t">{自动分配生效话}</span>
              </li>
            </ul>
          )}
          {定向 && (
            <div className="cu-tr-who" data-testid="transfer-direction-row">
              <Select
                className="dir-select-w120"
                aria-label="分配方向"
                data-testid="transfer-direction"
                placeholder="内贸 / 外贸"
                value={指定线 ?? undefined}
                disabled={忙}
                options={(["内贸", "外贸"] as const).map((v) => ({ value: v, label: v }))}
                onChange={(v: 线) => {
                  set向(v);
                  set错("");
                  if (谁 && !按方向挑(定向.候选表, v).includes(谁)) set谁(undefined);
                }}
              />
              <span className="cu-tr-hint" data-testid="transfer-direction-why">
                {向 && 向 !== 定向.默认线 ? `你改成了${向}；` : 定向.默认线 ? `默认按客户区域 / 电话 / 你的事业部定${定向.默认线}；` : "这几位默认方向不一样或判不出，按各自默认核；"}
                {指定方向话(指定线)}
              </span>
            </div>
          )}
          {!固定人 && !自动中 && (
            <div className="cu-tr-who">
              <Select
                showSearch
                optionFilterProp="label"
                aria-label="转给谁"
                placeholder="选接手人"
                value={谁}
                disabled={忙}
                options={列的人们}
                onChange={(v) => {
                  set谁(v);
                  set错("");
                }}
              />
              {谁 && 谁 === 上次转给() && <span className="cu-tr-hint">默认上次选的</span>}
            </div>
          )}
          {谁 && !自动中 && (
            <ul className="csq-list">
              {取转走 && !转走好了 && (
                <li className="csq-row">
                  <span className="csq-tag">一起转走</span>
                  <span className="csq-t cu-tr-skel" aria-busy>
                    正在数名下的项目
                  </span>
                </li>
              )}
              {转走好了 && 转走?.说法 && (
                <li className="csq-row">
                  <span className="csq-tag" data-level="警">
                    一起转走
                  </span>
                  <span className="csq-t">
                    {转走.说法.标题}
                    {转走.说法.同事 && `；${转走.说法.同事}`}
                    <转走项目列表 说法={转走.说法} />
                  </span>
                </li>
              )}
              <li className="csq-row">
                <span className="csq-tag" data-level={是申请 ? "警" : "常"}>
                  生效
                </span>
                <span className="csq-t">
                  {是申请 === true
                    ? `要「${名}」点接受：接手人确认后生效，确认前仍在你名下；${移交作废天数} 天内不确认自动作废，归属不变`
                    : 是申请 === false
                      ? `马上转到「${名}」名下，名下联系人、项目一起转过去`
                      // 判定没取到：不猜，两种都说
                      : `以接手人确认为准，或直接生效：负责人本人转出的要「${名}」确认后才生效（${移交作废天数} 天内不确认作废），上级、管理员转的直接生效`}
                </span>
              </li>
            </ul>
          )}
          {要说明 && 批量 && <div className="cd-transfer-mut" role="note">一次转多位客户时，同事在推的项目都保留原负责人；要一起转请一位一位转</div>}
          {要说明 && <逐项选块 预览={转走?.原} 选={逐项} 改={set逐项} 忙={忙} />}
          {要说明 && <说明框 预览={转走?.原} 值={说明} 改={set说明} 忙={忙} onEnter={() => void 转()} />}
          {(谁 || 自动中) && 要原因 && !要说明 && (
            <div className="csq-why" role="radiogroup" aria-label="转让原因">
              <div className="csq-why-h">转让原因（可不选）</div>
              <div className="csq-chips">
                {原因选项.map((o) => (
                  <button
                    key={o}
                    type="button"
                    role="radio"
                    aria-checked={选 === o}
                    className="csq-chip"
                    disabled={忙}
                    onClick={() => {
                      // 可不选：再点一下取消
                      set选(选 === o ? null : o);
                      if (o === 其他项 && 选 !== o) requestAnimationFrame(() => 写框.current?.focus());
                    }}
                  >
                    {o}
                  </button>
                ))}
              </div>
              {选 === 其他项 && (
                <Input
                  ref={(r) => {
                    写框.current = r?.input ?? null;
                  }}
                  className="csq-other"
                  maxLength={其他补充上限}
                  showCount
                  disabled={忙}
                  placeholder="具体是什么（必填）"
                  aria-label="转让原因：其他的具体内容"
                  value={写}
                  onChange={(e) => set写(e.target.value)}
                  onPressEnter={() => void 转()}
                />
              )}
            </div>
          )}
          {错 && (
            <div className="csq-err" role="alert">
              {错}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

/** 「不会自动分」「分给了谁」「没分成」那几行：全列出来，折行不截断；多了框里限高滚动 */
function 名单({ 行 }: { 行: string[] }) {
  if (!行.length) return null;
  return (
    <ul className="cu-tr-names">
      {行.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ul>
  );
}
