"use client";
/**
 * 录音点评 · 确认框「确认录音点评」（11-22，录音点评 PR5，改版方案 §4.3）：AI 整理好了（待确认）或者没整理成（整理失败）都能开。
 *
 * - 内容：关联项目、关联节点、录音回放（只有录的人自己能听）、主题（AI 起草，40 字，可改）、要点（AI 起草，可改）、转写全文（默认收起、只读，旁边「按转写重新整理」）、填写人、会通知。
 *   AI 起草的两格用虚线框（全站「AI 起草」那条视觉语法）；没听清 / 没整理成的，两格空着让人自己写，上面写为什么
 * - 按钮：不要了（先出「放弃这段录音？」确认条，删录音和草稿）/ 稍后再发（存草稿；点 × 也一样）/ 发出（走发主题同一套权限、通知）
 * - 电脑 520 宽弹框；手机（≤767）整屏（同传录音文件那只框的 .crec-modal）
 * - 销售教练看到的转写、草稿里号码打过码（服务端给的就是打过的）
 */
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Modal } from "antd";
import type { 录音给界面 } from "@/lib/enterprise/coach-rec-db";
import type { 项目主题们 } from "@/lib/enterprise/coach-topic-db";
import { 主题标题上限, 主题内容上限 } from "@/lib/enterprise/coach-topic";

async function 调(url: string, 体?: unknown): Promise<{ ok: boolean; status: number; 体: Record<string, unknown> }> {
  const r = await fetch(url, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(体 ?? {}) });
  return { ok: r.ok, status: r.status, 体: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}
const 话 = (x: { 体: Record<string, unknown> }, 默认: string) => (typeof x.体.error === "string" ? x.体.error : 默认);
const 读时长 = (毫秒: number) => `${Math.floor(毫秒 / 60000)}:${String(Math.floor((毫秒 / 1000) % 60)).padStart(2, "0")}`;

export function CoachRecConfirm({ 录, 数据, 可整理, 关 }: { 录: 录音给界面; 数据: 项目主题们 | null | undefined; 可整理: boolean; 关: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState(录.确认?.主题 ?? "");
  const [body, setBody] = useState(录.确认?.要点 ?? "");
  const [看转写, set看转写] = useState(false);
  const [问, set问] = useState<"弃" | "重整" | null>(null);
  const [忙, set忙] = useState<"发" | "存" | "弃" | "重整" | null>(null);
  const [错, set错] = useState<string | null>(null);
  // 这条在别处重新整理过（存、发回 412）：框里留着提示好让人抄走自己改的字，再点 × / Esc 直接关掉刷新，不再存（3703 实操跟进）
  const [变了, set变了] = useState(false);
  const 改过 = title !== (录.确认?.主题 ?? "") || body !== (录.确认?.要点 ?? "");
  const AI起草 = !!录.确认?.主题 || !!录.确认?.要点;

  const 跑 = async (哪个: "发" | "存" | "弃" | "重整", 做: () => Promise<{ ok: boolean; status: number; 体: Record<string, unknown> }>, 默认话: string, 关着 = false) => {
    set忙(哪个);
    set错(null);
    const r = await 做().catch(() => null);
    set忙(null);
    if (r && r.status === 412) {
      set变了(true);
      set错(话(r, "内容已在别处更新，请重新打开"));
      return false;
    }
    // 点 × / Esc 关框时存草稿：这条已经在别处发出、删掉、变了（409、404）就不拦着，关掉框刷新（PR5 审查）
    if (关着 && r && (r.status === 409 || r.status === 404)) {
      关();
      router.refresh();
      return true;
    }
    if (!r || !r.ok) {
      set错(r ? 话(r, 默认话) : "网络断了，请重试");
      return false;
    }
    关();
    router.refresh();
    return true;
  };
  const 发 = () => 跑("发", () => 调(`/api/coach-rec/${录.id}/send`, { title, body, 版本: 录.更新于 }), "没发出去，请重试");
  // 稍后再发 / 点 ×：没改过就直接关（不白写一次库）
  const 存 = (关着 = false) => (变了 && 关着 ? (关(), router.refresh(), Promise.resolve(true)) : 改过 ? 跑("存", () => 调(`/api/coach-rec/${录.id}/draft`, { title, body, 版本: 录.更新于 }), "草稿没存上，请重试", 关着) : (关(), Promise.resolve(true)));
  const 弃 = () => 跑("弃", () => 调(`/api/coach-rec/${录.id}/abandon`), "没删掉，请重试");
  const 重整 = () => 跑("重整", () => 调(`/api/coach-rec/${录.id}/retry`), "没交上，请重试");

  const 行 = (名: string, 值: ReactNode) => (
    <div className="cth-form-row"><span className="cth-form-k">{名}</span><span className="cth-form-v">{值}</span></div>
  );
  const 底 = [
    <Button key="no" danger disabled={!!忙} onClick={() => set问("弃")} data-testid="crec-confirm-drop">不要了</Button>,
    <Button key="later" disabled={!!忙 && 忙 !== "存"} loading={忙 === "存"} onClick={() => void 存()} data-testid="crec-confirm-later">稍后再发</Button>,
    <Button key="send" type="primary" disabled={(!!忙 && 忙 !== "发") || !title.trim() || !body.trim()} loading={忙 === "发"} onClick={() => void 发()} data-testid="crec-confirm-send">发出</Button>,
  ];
  return (
    <Modal open title="确认录音点评" onCancel={() => void 存(true)} destroyOnHidden width={560} maskClosable={false} className="crec-modal crec-confirm" footer={底}>
      <div className="cth-form" data-testid="crec-confirm">
        {录.错 && <div role="status" className="crec-warn" data-testid="crec-confirm-hint">{录.错}</div>}
        {行("关联项目", <span className="cth-ellipsis" title={数据?.项目名}>{数据?.项目名 ?? "—"}</span>)}
        {行("关联节点", <span>{数据?.当前节点 || "—"}（当前节点）</span>)}
        {行("录音", 录.能听
          ? <span className="crec-confirm-audio"><audio className="crec-audio" controls preload="none" src={`/api/coach-rec/${录.id}/audio`} aria-label="回放录音" />{录.时长毫秒 ? <span className="crec-hint">{读时长(录.时长毫秒)}</span> : null}</span>
          : <span className="crec-hint">录音文件不在了</span>)}
        {行("主题", <Input aria-label="主题" className={AI起草 ? "crec-ai" : undefined} maxLength={主题标题上限} showCount placeholder="一句话" value={title} onChange={(e) => setTitle(e.target.value)} />)}
        {行("要点", <Input.TextArea aria-label="要点" className={AI起草 ? "crec-ai" : undefined} maxLength={主题内容上限} autoSize={{ minRows: 4, maxRows: 14 }} placeholder="做得好的、要改进的、下一步建议" value={body} onChange={(e) => setBody(e.target.value)} />)}
        {AI起草 && <div className="crec-hint crec-confirm-ai-note">虚线框里是 AI 按转写起草的，发出前看一遍、改对</div>}
        {录.确认?.转写 && (
          <div className="crec-transcript">
            <span className="crec-transcript-h">
              <button type="button" className="cth-closed-toggle" aria-expanded={看转写} onClick={() => set看转写(!看转写)} data-testid="crec-confirm-transcript-toggle">{看转写 ? "收起转写全文" : "看转写全文"}</button>
              {可整理 && <Button size="small" type="link" disabled={!!忙} onClick={() => set问("重整")} data-testid="crec-confirm-redo">按转写重新整理</Button>}
            </span>
            {看转写 && (
              <>
                <pre className="crec-transcript-t" data-testid="crec-confirm-transcript">{录.确认.转写}</pre>
                <div className="crec-hint">机器识别，可能有错字，以录音为准</div>
              </>
            )}
          </div>
        )}
        {行("填写人", <span>{数据?.填写人 ? `${数据.填写人.name}（${数据.填写人.身份}）` : "—"}</span>)}
        {行("会通知", <span>{数据?.负责人 ? `项目负责人 · ${数据.负责人.name}` : "—"}</span>)}
        {问 && (
          <div className="pd-del-band" role="group" aria-label={问 === "弃" ? "放弃这段录音？" : "按转写重新整理？"} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); set问(null); } }}>
            <span className="pd-del-band-t">
              {问 === "弃"
                ? `放弃这段录音？${录.时长毫秒 ? `已录 ${读时长(录.时长毫秒)}，` : ""}录音和草稿一起删，不能恢复`
                : "重新整理会盖掉现在的主题和要点，好了再通知你"}
            </span>
            <span className="pd-del-band-a">
              <Button size="small" onClick={() => set问(null)} disabled={!!忙}>取消</Button>
              <Button size="small" type="primary" danger={问 === "弃"} loading={忙 === "弃" || 忙 === "重整"} autoFocus
                onClick={() => void (问 === "弃" ? 弃() : 重整())} data-testid={问 === "弃" ? "crec-confirm-drop-ok" : "crec-confirm-redo-ok"}>
                {问 === "弃" ? "放弃" : "重新整理"}
              </Button>
            </span>
          </div>
        )}
        {错 && <div role="alert" className="cd-task-err">{错}</div>}
      </div>
    </Modal>
  );
}
