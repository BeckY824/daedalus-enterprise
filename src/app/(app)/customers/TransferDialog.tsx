"use client";
/**
 * 转让框（原型 cu.transfer「改后」）：原来是三层——选人下拉 → 「会一起转走的项目」框 → 「转让原因」框，合成一个：
 *   选人（默认上次选的，可改；人多可搜）→ 一起转走的项目（换人现取）→ 什么时候生效 → 转让原因（可不选）。
 * 负责人本人转自己的 = 申请移交（P-转-16 / P-转-01 ①）：写进框里——「X 确认后生效，确认前仍在你名下；7 天不确认自动作废」，
 * 确认键叫「转给 X」；上级、条线总管理、系统管理员直接转（服务端 转让走交接 说了算，这里只是提前说）。
 * 转这件事在框里做：没成（权限被挡、交接中……）原因写在框里、框不关，可以改人再点；成了才关。
 * 样式沿用后果框（.csq-*），框外加 .cu-tr-*。
 */
import { useEffect, useRef, useState } from "react";
import { Button, Input, Modal, Select } from "antd";
import { 其他项, 其他补充上限, 合其他 } from "@/lib/enterprise/dict-kinds";
import { 转走项目说法, type 转走项目预览 } from "@/lib/carry-over";
import { 跑出原因, type 做的结果 } from "@/lib/confirm-result";
import { 移交作废天数 } from "@/lib/enterprise/handover-expire-days";
import { 转走项目列表 } from "./useCarryConfirm";

export type 人 = { value: string; label: string };
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
  /** 转给这位要不要接手人确认（申请移交） */
  申请: boolean | ((人id: string) => boolean);
  /** 字典「转让原因」；空 = 不问 */
  原因选项?: readonly string[];
  /** 我是谁：转给自己不问原因 */
  自己?: string;
  /** 确认键的字；不给 = 「转给 X」 */
  是字?: string;
  做: (人id: string, 原因: string | null) => 做的结果 | Promise<做的结果>;
}) {
  const 默认 = () => 固定人?.value ?? (人们.some((p) => p.value === 上次转给()) ? 上次转给() : undefined);
  const [谁, set谁] = useState<string | undefined>(默认);
  const [选, set选] = useState<string | null>(null);
  const [写, set写] = useState("");
  const [忙, set忙] = useState(false);
  const [错, set错] = useState("");
  const [转走, set转走] = useState<{ 谁: string; 说法: ReturnType<typeof 转走项目说法> } | null>(null);
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
    }
  }

  useEffect(() => {
    if (!open || !谁 || !取转走) return;
    let 还在 = true;
    取转走(谁).then(
      (p) => 还在 && set转走({ 谁, 说法: 转走项目说法(p) }),
      // 取不到不拦着：转本身照样会带走项目，这里只是提前说
      () => 还在 && set转走({ 谁, 说法: null }),
    );
    return () => {
      还在 = false;
    };
  }, [open, 谁, 取转走]);

  const 名 = 固定人?.label ?? 人们.find((p) => p.value === 谁)?.label ?? "";
  const 要原因 = 原因选项.length > 0 && 谁 !== 自己;
  const 原因齐 = !要原因 || 选 !== 其他项 || !!写.trim();
  const 转走好了 = !取转走 || (转走 && 转走.谁 === 谁);
  const 能转 = !!谁 && 原因齐 && !忙;
  const 是申请 = !!谁 && (typeof 申请 === "function" ? 申请(谁) : 申请);

  async function 转() {
    if (!能转 || !谁) return;
    set忙(true);
    set错("");
    const 因 = await 跑出原因(() => 做(谁, 要原因 ? 合其他(选, 写) : null));
    set忙(false);
    if (因) return set错(因);
    if (!固定人) 记上次(谁);
    onClose(true);
  }
  const 取消 = () => {
    if (!忙) onClose(false);
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
          <Button onClick={取消} disabled={忙}>
            取消
          </Button>
          <Button type="primary" loading={忙} disabled={!能转 && !忙} onClick={() => void 转()}>
            {是字 ?? (名 ? `转给${名}` : "转让")}
          </Button>
        </div>
      }
    >
      {!固定人 && (
        <div className="cu-tr-who">
          <Select
            showSearch
            optionFilterProp="label"
            aria-label="转给谁"
            placeholder="选接手人"
            value={谁}
            disabled={忙}
            options={人们}
            onChange={(v) => {
              set谁(v);
              set错("");
            }}
          />
          {谁 && 谁 === 上次转给() && <span className="cu-tr-hint">默认上次选的</span>}
        </div>
      )}
      {谁 && (
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
              {是申请
                ? `要「${名}」点接受：接手人确认后生效，确认前仍在你名下；${移交作废天数} 天内不确认自动作废，归属不变`
                : `马上转到「${名}」名下，名下联系人、项目一起转过去`}
            </span>
          </li>
        </ul>
      )}
      {谁 && 要原因 && (
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
    </Modal>
  );
}
