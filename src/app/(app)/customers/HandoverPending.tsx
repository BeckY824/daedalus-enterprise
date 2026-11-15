"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Modal, Select, Space } from "antd";
import InlineConfirm from "@/components/InlineConfirm";
import { 确认交接, 撤回交接, 拒收交接, 改接手人, type 交接行 } from "./handover-actions";

/**
 * 企业版「交接中」（D10）：客户页顶上列出等我确认的交接、我发起还没被确认的。
 * 确认前这些客户还归原负责人，接手人的客户列表里没有；这里只给个数和前几位的名字，好决定接不接。
 * 离职交接（11-13 起「项目 → 离职交接」交的都要接手人确认）：交的可能是一位客户、一个项目或全部，标题按 离职说 写；
 * 发起人、总管理在「我发起的」里能撤回、改接手人。
 * 没有待确认的交接 = 什么都不显示（不是企业版的页面根本不放这个组件）
 */
export default function HandoverPending({ 等我确认, 我发起的, 候选 = [], 我 }: {
  等我确认: 交接行[]; 我发起的: 交接行[];
  /** 改接手人的下拉（X-46 ⑥）：同转让的负责人候选，服务端再挡一遍 */
  候选?: { id: string; name: string }[]; 我?: string;
}) {
  const router = useRouter();
  const [忙, set忙] = useState<string | null>(null);
  /** 接手成了的那几笔：按钮原地变「✓ 已接手」，横幅等列表刷新后自己收（原型 cu.handover） */
  const [接了, set接了] = useState<Set<string>>(() => new Set());
  /** 没办成的原因：写在这一条横幅里，不弹顶部提示 */
  const [错, set错] = useState<Record<string, string>>({});
  const [改, set改] = useState<交接行 | null>(null);
  const [新, set新] = useState<string | undefined>();
  const [改错, set改错] = useState("");
  if (!等我确认.length && !我发起的.length) return null;

  /** 负责人本人转自己的 = 申请移交（X4）：说「接受 / 拒绝 / 撤回申请」 */
  const 是申请 = (h: 交接行) => h.kind === "转让" && h.自己的;
  /**
   * 确认接手：一步完成，不再弹确认（原型 cu.handover「不再确认」，接手是收下、不是丢掉）；
   * 拒收、撤回：原地确认（P-界面-40「撤回交接」= 原地确认），由 InlineConfirm 问过再进来。
   * 回 { ok:false } 给 InlineConfirm：问句留着可以再点
   */
  async function 办(h: 交接行, 做: "确认" | "拒收" | "撤回") {
    set忙(h.id);
    set错((e) => ({ ...e, [h.id]: "" }));
    try {
      const r = await (做 === "确认" ? 确认交接 : 做 === "拒收" ? 拒收交接 : 撤回交接)(h.id);
      if (!r.ok) {
        set错((e) => ({ ...e, [h.id]: r.error }));
        return { ok: false, error: r.error };
      }
      if (做 === "确认") set接了((s) => new Set(s).add(h.id));
    } catch {
      set错((e) => ({ ...e, [h.id]: "没办成，刷新再试" }));
      return { ok: false, error: "没办成，刷新再试" };
    } finally {
      set忙(null);
      router.refresh();
    }
  }

  async function 改成() {
    if (!改 || !新) return;
    set忙(改.id);
    set改错("");
    try {
      const r = await 改接手人(改.id, 新);
      if (!r.ok) set改错(r.error);
      else set改(null);
    } catch {
      set改错("没办成，刷新再试");
    } finally {
      set忙(null);
      router.refresh();
    }
  }

  // 发起人转的是自己名下的：横幅写「自己名下」，不写两遍名字（11-03 C3-4，铃铛标题同样处理）
  const 说 = (h: 交接行, 发起人说 = false) => {
    if (h.kind === "离职") return `离职成员「${h.从}」名下的 ${h.离职说}`;
    const 名 = h.客户.length ? `：${h.客户.join("、")}${h.客户总数 > h.客户.length ? ` 等 ${h.客户总数} 位` : ""}` : "";
    const 谁的 = 发起人说 && h.自己的 ? "自己名下" : `「${h.从}」名下`;
    return `${谁的}的 ${h.客户总数} 位客户${名}${h.reason ? `（转让原因：${h.reason}）` : ""}`;
  };

  return (
    // 名字很长（外文公司名不带空格）也要折行，不顶出右边按钮（Windows 1024 宽）
    <Space orientation="vertical" style={{ width: "100%", marginBottom: 12, overflowWrap: "anywhere" }}>
      {等我确认.map((h) => (
        <Alert key={h.id} type="warning" showIcon
          title={是申请(h) ? `「${h.发起人}」申请把${说(h, true)}移交给你，等你确认` : `「${h.发起人}」把${说(h, true)}交接给你，等你确认`}
          description={<>
            {是申请(h) ? "你接受后才转到你名下；不接受不生效，客户还在原负责人名下。" : h.kind === "离职" ? "你确认后才转到你名下；确认前还在离职成员名下，你的列表里看不到。" : "确认前这些客户还在原负责人名下，你的客户列表里看不到。"}
            {/* 原来写在确认框里的「确认后什么转过来」：确认不再弹框，挪到横幅里先看清（cu.handover） */}
            {h.确认说明 && <div className="cu-ho-what">{h.确认说明}</div>}
            {错[h.id] && <div className="cu-ho-err" role="alert">{错[h.id]}</div>}
          </>}
          action={接了.has(h.id) ? <span className="cu-ho-done" role="status">✓ {是申请(h) ? "已接受" : "已接手"}</span> : <Space>
            <Button size="small" type="primary" loading={忙 === h.id} onClick={() => void 办(h, "确认")}>{是申请(h) ? "接受" : "确认接手"}</Button>
            {/* 拒收仍保留确认（原型 cu.handover nextMeta）：一行后果说得完，原地确认 */}
            <InlineConfirm 问={是申请(h) ? "拒绝后不生效" : "拒收后不转"} 是={是申请(h) ? "拒绝" : "拒收"} 做={() => 办(h, "拒收")}>
              <Button size="small" disabled={忙 === h.id}>{是申请(h) ? "拒绝" : "拒收"}</Button>
            </InlineConfirm>
          </Space>}
        />
      ))}
      {我发起的.map((h) => h.状态 !== "待确认" ? (
        // 系统作废的申请移交（挂满 7 天没人处理，11-10）：只说明，没有可点的
        <Alert key={h.id} type="warning" showIcon
          title={`移交申请${h.状态}：${说(h, true)}，原接手人「${h.给}」`}
          description="客户仍在你名下，归属没有变；需要的话可以重新申请移交。"
        />
      ) : (
        <Alert key={h.id} type="info" showIcon
          title={是申请(h) ? `移交申请中：${说(h)}，等「${h.给}」确认，确认前仍在原负责人名下` : `交接中：${说(h)}，等「${h.给}」确认`}
          description={错[h.id] ? <div className="cu-ho-err" role="alert">{错[h.id]}</div> : undefined}
          action={<Space>
            {h.我能改接手人 ? <Button size="small" disabled={忙 === h.id} onClick={() => { set新(undefined); set改(h); }}>改接手人</Button> : null}
            {h.我能撤回 ? (
              <InlineConfirm 问="撤回后不转" 是={是申请(h) ? "撤回申请" : "撤回"} 中性 做={() => 办(h, "撤回")}>
                <Button size="small" disabled={忙 === h.id}>{是申请(h) ? "撤回申请" : "撤回"}</Button>
              </InlineConfirm>
            ) : null}
          </Space>}
        />
      ))}
      <Modal open={!!改} title="改接手人" okText="改" cancelText="取消" onCancel={() => { set改(null); set改错(""); }} onOk={改成}
        okButtonProps={{ disabled: !新, loading: !!改 && 忙 === 改.id }} destroyOnHidden>
        <p>{改?.kind === "离职" ? "这笔离职交接" : "移交申请"}改给另一位，等新接手人确认；原接手人「{改?.给}」不用再确认。</p>
        <Select showSearch optionFilterProp="label" style={{ width: "100%" }} placeholder="选新接手人" value={新} onChange={set新}
          options={候选.filter((u) => u.id !== 改?.接手人id && (改?.kind === "离职" || u.id !== 我)).map((u) => ({ value: u.id, label: u.name }))} />
        {改错 && <div className="csq-err" role="alert">{改错}</div>}
      </Modal>
    </Space>
  );
}
