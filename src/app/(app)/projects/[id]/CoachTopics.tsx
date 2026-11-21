"use client";
/**
 * 项目「沟通记录」卡里的教练主题（11-17，销售教练角色 PR3a）：标「教练发起」。
 * 没关的（待回复、已回复）钉在沟通卡身最上面，不混进沟通记录那一串（那一串按时间分页，没回的会沉下去，11-17 评估）；
 * 已关闭的收在「已关闭的 N 条」里，点开才看。
 * 数据和每条能不能回 / 关 / 删都由服务端算好（lib/enterprise/coach-topic-db.ts 读项目主题），这里只画、只调动作。
 * 发起入口是「发起点评 ▾」→「写点评」（教练点评改版 PR1，11-21：客户页挪到右上角，独立项目页留在沟通卡头）。
 * 回复、发起一步完成（不弹确认）；关闭、删除在这一条下面长出确认条（同删沟通）。不是沟通记录：不碰下一步计划、三态。
 */
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, Dropdown, Input, Modal, Tag, type MenuProps } from "antd";
import { DownOutlined } from "@ant-design/icons";
import { fmtDateTime } from "@/lib/utils";
import { 教练发起标签, 主题标题上限, 主题内容上限, 回复上限 } from "@/lib/enterprise/coach-topic";
import type { 项目主题们, 主题给界面 } from "@/lib/enterprise/coach-topic-db";
import { 发主题动作, 回复主题动作, 关闭主题动作, 删主题动作 } from "../../customers/[id]/coach-topic-actions";
import { 动作出错话 } from "@/lib/stale-deploy";
import { useFormDraft } from "@/components/FormDraft";
import { 两行 } from "./project-menu";

const 状态色: Record<string, string> = { 待回复: "orange", 已回复: "blue", 已关闭: "default" };

/** 「录音点评」还没开放（教练点评改版 PR1 只做页头，11-21 用户「相关按钮功能目前点不动即可」）：下拉里灰着，这句既是第二行小字也是悬停说明 */
export const 录音点评未开放 = "录音点评即将开放";

/**
 * 「发起点评 ▾」（教练点评改版 PR1，11-21；原沟通卡头的「发起主题」）：能发才摆（P-教练-11/12/13，数据.能发 由服务端算，不新增规则）。
 * 客户页摆在右上角、「更多操作 ▾」左边；独立项目页（看不到客户的上级留在 /projects/<id>）摆在沟通卡头。
 * 下拉：灰字小标题「当前项目：名字（节点）」→「写点评」（原「发起主题」那只框，字段、服务端都不变）→「录音点评」（灰着、点不动，第二行写为什么）
 */
export function StartReviewButton({ 数据, projectId, size }: { 数据: 项目主题们 | null | undefined; projectId: string; size?: "small" }) {
  const [开, set开] = useState(false);
  if (!数据?.能发) return null;
  const 当前 = `当前项目：${数据.项目名}${数据.当前节点 ? `（${数据.当前节点}）` : ""}`;
  const items: MenuProps["items"] = [{
    type: "group",
    key: "cur",
    label: <span className="rec-menu-cur-t" title={当前}>{当前}</span>,
    children: [
      { key: "write", label: <span data-testid="coach-review-write">{两行("写点评", "打字写，和原来的「发起主题」一样")}</span>, onClick: () => set开(true) },
      { key: "voice", disabled: true, label: <span data-testid="coach-review-voice" title={录音点评未开放}>{两行("录音点评", 录音点评未开放)}</span> },
    ],
  }];
  return (
    <>
      <Dropdown trigger={["click"]} placement="bottomRight" menu={{ items, className: "rec-head-menu" }}>
        <Button size={size} data-testid="coach-topic-new">发起点评 <DownOutlined /></Button>
      </Dropdown>
      {开 && <NewTopicModal 数据={数据} projectId={projectId} 关={() => set开(false)} />}
    </>
  );
}

function NewTopicModal({ 数据, projectId, 关 }: { 数据: 项目主题们; projectId: string; 关: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [忙, set忙] = useState(false);
  const [错, set错] = useState<string | null>(null);
  // 打了没发的字留草稿（复盘第 1 类：刷新、发版后重开带回）；发出去了、点取消就删
  const 稿 = useFormDraft({ 键: `教练主题:${projectId}`, 值: { title, body }, 带回: (v) => { if (v.title !== undefined) setTitle(v.title); if (v.body !== undefined) setBody(v.body); } });
  const 不要了 = () => { 稿.丢掉(); 关(); };
  const 发 = async () => {
    set忙(true);
    set错(null);
    const r = await 发主题动作(projectId, { title, body }).catch((出错) => ({ ok: false as const, error: 动作出错话(出错, "没发出去，请重试") }));
    set忙(false);
    if (!r.ok) return set错(r.error);
    稿.存好了();
    关();
    router.refresh();
  };
  const 行 = (名: string, 值: ReactNode) => (
    <div className="cth-form-row"><span className="cth-form-k">{名}</span><span className="cth-form-v">{值}</span></div>
  );
  return (
    <Modal open title="写点评" onCancel={不要了} destroyOnHidden width={520}
      footer={[
        <Button key="c" onClick={不要了} disabled={忙}>取消</Button>,
        <Button key="ok" type="primary" loading={忙} disabled={!title.trim() || !body.trim()} onClick={() => void 发()} data-testid="coach-topic-send">发出</Button>,
      ]}>
      {稿.提示}
      <div className="cth-form">
        {行("关联项目", <span className="cth-ellipsis" title={数据.项目名}>{数据.项目名}（当前项目）</span>)}
        {行("关联节点", <span>{数据.当前节点 || "—"}（当前节点）</span>)}
        {行("主题", <Input aria-label="主题" maxLength={主题标题上限} showCount placeholder="一句话" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />)}
        {行("内容", <Input.TextArea aria-label="内容" maxLength={主题内容上限} autoSize={{ minRows: 3, maxRows: 10 }} placeholder="点评或建议" value={body} onChange={(e) => setBody(e.target.value)} />)}
        {行("填写人", <span>{数据.填写人 ? `${数据.填写人.name}（${数据.填写人.身份}）` : "—"}</span>)}
        {行("会通知", <span>{数据.负责人 ? `项目负责人 · ${数据.负责人.name}` : "—"}</span>)}
      </div>
      {错 && <div role="alert" className="cd-task-err">{错}</div>}
    </Modal>
  );
}

/** 沟通卡身最上面那一段：没有主题就什么都不画 */
export default function CoachTopics({ 数据 }: { 数据: 项目主题们 | null | undefined }) {
  const [看关的, set看关的] = useState(false);
  if (!数据 || !数据.们.length) return null;
  const 开着 = 数据.们.filter((t) => t.status !== "已关闭");
  const 关了 = 数据.们.filter((t) => t.status === "已关闭");
  return (
    <div className="cth-list" data-testid="coach-topics" aria-label="教练主题">
      {数据.冻结 && <div className="muted cth-frozen">项目在公海或回收站里，主题只能看</div>}
      {开着.map((t) => <TopicItem key={t.id} t={t} />)}
      {关了.length > 0 && (
        <button type="button" className="cth-closed-toggle" aria-expanded={看关的} onClick={() => set看关的(!看关的)} data-testid="coach-topics-closed">
          {看关的 ? "收起已关闭的主题" : `已关闭的主题 ${关了.length} 条`}
        </button>
      )}
      {看关的 && 关了.map((t) => <TopicItem key={t.id} t={t} />)}
    </div>
  );
}

/** 「谁于何时关闭」：关的人空 = 项目进公海时系统自动关的 */
const 关闭说法 = (t: 主题给界面) => (t.status !== "已关闭" || !t.closedAt ? "" : t.关的人 ? ` · ${t.关的人} 于 ${fmtDateTime(t.closedAt)} 关闭` : ` · 项目进公海，${fmtDateTime(t.closedAt)} 自动关闭`);

function TopicItem({ t }: { t: 主题给界面 }) {
  const router = useRouter();
  const [回, set回] = useState("");
  const [忙, set忙] = useState(false);
  const [错, set错] = useState<string | null>(null);
  const [问, set问] = useState<"关" | "删" | null>(null);
  // 回复打了没交的字留草稿（复盘第 1 类，教练主题回复）；回出去了就删
  const 稿 = useFormDraft({ 键: t.能回 ? `主题回复:${t.id}` : null, 值: { 回 }, 带回: (v) => { if (v.回 !== undefined) set回(v.回); }, 紧凑: true });
  const 跑 = async (f: () => Promise<{ ok: boolean; error?: string }>) => {
    set忙(true);
    set错(null);
    const r = await f().catch((出错) => ({ ok: false, error: 动作出错话(出错, "没成，请重试") }));
    set忙(false);
    if (!r.ok) return set错(r.error ?? "没成，请重试");
    稿.存好了();
    set回("");
    set问(null);
    router.refresh();
  };
  return (
    <div className={`cth-item${t.status === "待回复" ? " cth-wait" : ""}`} id={`coach-topic-${t.id}`} data-testid="coach-topic">
      <div className="cth-head">
        <Tag color="purple" bordered={false}>{教练发起标签}</Tag>
        <Tag color={状态色[t.status]}>{t.status}</Tag>
        <span className="cth-meta">@{t.node || "—"} · {fmtDateTime(t.createdAt)}</span>
      </div>
      <div className="cth-title" title={t.title}>{t.title}</div>
      <div className="cth-body">{t.body}</div>
      <div className="cth-meta">填写人：{t.作者.name}（{t.作者.身份}）{关闭说法(t)}</div>
      {t.回复们.length > 0 && (
        <div className="cth-replies">
          {t.回复们.map((r) => (
            <div key={r.id} className="cth-reply">
              <span className="cth-reply-who">↳ {r.name}{r.是负责人 ? "（负责人）" : ""}：</span>
              <span className="cth-reply-body">{r.body}</span>
              <span className="cth-meta"> · {fmtDateTime(r.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
      {(t.能回 || t.能关 || t.能删) && (
        <div className="cth-acts">
          {t.能回 && 稿.提示}
          {t.能回 && (
            <Input.TextArea aria-label="回复这个主题" className="cth-reply-input" maxLength={回复上限} autoSize={{ minRows: 1, maxRows: 6 }} placeholder="回复…" value={回} disabled={忙} onChange={(e) => set回(e.target.value)} />
          )}
          <span className="cth-btns">
            {t.能回 && <Button size="small" type="primary" disabled={!回.trim()} loading={忙 && !问} onClick={() => void 跑(() => 回复主题动作(t.id, 回))} data-testid="coach-topic-reply">回复</Button>}
            {t.能关 && <Button size="small" disabled={忙} onClick={() => set问("关")} data-testid="coach-topic-close">关闭</Button>}
            {t.能删 && <Button size="small" danger type="text" disabled={忙} onClick={() => set问("删")}>删除</Button>}
          </span>
        </div>
      )}
      {问 && (
        <div className="pd-del-band" role="group" aria-label={问 === "关" ? "确认关闭这个主题" : "确认删除这个主题"} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); set问(null); } }}>
          <span className="pd-del-band-t">{问 === "关" ? "关闭后只能看，不能再回复" : "删了谁都看不到，不能恢复"}</span>
          <span className="pd-del-band-a">
            <Button size="small" onClick={() => set问(null)} disabled={忙}>取消</Button>
            <Button size="small" type="primary" danger={问 === "删"} loading={忙} autoFocus onClick={() => void 跑(() => (问 === "关" ? 关闭主题动作(t.id) : 删主题动作(t.id)))}>
              {问 === "关" ? "确认关闭" : "确认删除"}
            </Button>
          </span>
        </div>
      )}
      {错 && <div role="alert" className="cd-task-err">{错}</div>}
    </div>
  );
}
