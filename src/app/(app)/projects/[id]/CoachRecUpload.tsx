"use client";
/**
 * 录音点评 ·「传录音文件」（11-22，录音点评 PR2：录音存储与上传，手机优先）。
 *
 * 入口：「发起点评 ▾ → 传录音文件」（电脑弹框；手机 ≤767 整屏，底部选择板见 CoachTopics.tsx StartReviewButton）；
 *       沟通卡最上面的录音草稿条（没传完的「接着传」、传完待提交的回放 / 删掉）。只有开关开着、我能对这个项目发主题时才有（服务端给 数据.录音）。
 * 怎么传（方案 §4.6）：浏览器把文件切成 5MB 一片按顺序 PUT /api/coach-rec/<id>/chunk/1/<片号>；一片失败自动重试 3 次（隔 2 / 5 / 15 秒），
 *       还不行就停下写「网络断了，已传 62%」和「继续」；服务器忙（429）按它说的秒数再试。传完 POST finish → 待提交。
 * 续传：本机 localStorage 只记「文件名 + 大小 + 修改时间 → 录音编号」（读写包 try，失败就当没有）；回来重新选同一个文件，先问服务器收到哪几片、只补没收到的。
 *       选的文件对不上草稿就问「换成这个文件重新传？」（旧的删掉）。
 * 时长：浏览器读出来只给人看（不信它，服务端 PR4 用 ffprobe 算）。「提交整理」要等转写（PR4）接上，这一版灰着。
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Modal, Progress } from "antd";
import type { 录音给界面 } from "@/lib/enterprise/coach-rec-db";
import { 片上限字节, 文件上限字节, 建议WiFi字节, 选文件accept } from "@/lib/enterprise/coach-rec";
import { 通知文字打码 } from "@/lib/enterprise/notice-mask";

const 读大小 = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
const 读时长 = (秒: number) => `${Math.floor(秒 / 60)}:${String(Math.floor(秒 % 60)).padStart(2, "0")}`;
const 百分 = (已: number, 总: number | null) => (总 ? Math.min(100, Math.floor((已 / 总) * 100)) : 0);
const 等 = (毫秒: number) => new Promise((r) => setTimeout(r, 毫秒));
const 重试间隔 = [2000, 5000, 15000];

/** 本机记「哪个文件 → 哪条录音」：只是续传的便利，读写失败就当没有 */
const 记键 = (projectId: string) => `crec-upload:${projectId}`;
const 文件指纹 = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;
function 读记(projectId: string): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(记键(projectId)) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
function 写记(projectId: string, 指纹: string, id: string | null) {
  try {
    const 记 = 读记(projectId);
    if (id) 记[指纹] = id;
    else delete 记[指纹];
    localStorage.setItem(记键(projectId), JSON.stringify(记));
  } catch {
    /* 存不了就不续传，照样能传 */
  }
}

async function 调(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; 体: Record<string, unknown>; 等秒: number }> {
  const r = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init });
  const 体 = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: r.ok, status: r.status, 体, 等秒: Number(r.headers.get("retry-after") ?? 0) || 0 };
}
const 话 = (x: { 体: Record<string, unknown> }, 默认: string) => (typeof x.体.error === "string" ? x.体.error : 默认);
/** 草稿是不是这个文件：大小一样、名字一样（销售教练看到的名字里号码打了码，按打码后的比） */
const 是这个文件 = (d: 录音给界面, f: File) => d.总字节 === f.size && (d.文件名 === f.name || d.文件名 === 通知文字打码(f.name));

type 阶段 = { k: "选" } | { k: "问换"; 旧: 录音给界面 } | { k: "传"; 已: number } | { k: "停"; 已: number; 为什么: string } | { k: "完"; 录音: 录音给界面 };

/**
 * 传录音文件的框。续 = 从草稿条点进来、要接着传的那条（选的文件对不上就问换不换）
 */
export function CoachRecUploadModal({ projectId, 项目名, 续, 关 }: { projectId: string; 项目名: string; 续?: 录音给界面 | null; 关: () => void }) {
  const router = useRouter();
  const [文件, set文件] = useState<File | null>(null);
  const [时长, set时长] = useState<number | null>(null);
  const [阶, set阶] = useState<阶段>({ k: "选" });
  const [错, set错] = useState<string | null>(null);
  const 停了 = useRef(false);
  const 选 = useRef<HTMLInputElement>(null);
  useEffect(() => () => { 停了.current = true; }, []);

  const 传中 = 阶.k === "传";
  const 选好 = (f: File | null) => {
    set错(null);
    set时长(null);
    set文件(f);
    set阶({ k: "选" });
    if (!f) return;
    if (f.size > 文件上限字节) return set错(`文件 ${读大小(f.size)}，超过 ${文件上限字节 / 1024 / 1024}MB，传不了；可以用录音机 App 分成几段再传`);
    if (f.size === 0) return set错("这个文件是空的");
    // 时长只给人看：浏览器读不出（amr 之类）就不写
    const url = URL.createObjectURL(f);
    const a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () => { if (Number.isFinite(a.duration)) set时长(a.duration); URL.revokeObjectURL(url); };
    a.onerror = () => URL.revokeObjectURL(url);
    a.src = url;
    if (续 && 续.status === "上传中" && !是这个文件(续, f)) set阶({ k: "问换", 旧: 续 });
  };

  /** 找这个文件能接着传的那条：草稿条点进来的、或本机记过的；服务器上还在上传中才算 */
  const 找续 = async (f: File): Promise<录音给界面 | null> => {
    const 候选 = 续?.status === "上传中" && 是这个文件(续, f) ? 续.id : 读记(projectId)[文件指纹(f)];
    if (!候选) return null;
    const r = await 调(`/api/coach-rec/${候选}/status`);
    const 录 = r.ok ? (r.体.录音 as 录音给界面) : null;
    if (录?.status === "上传中" && 录.总字节 === f.size) return 录;
    写记(projectId, 文件指纹(f), null);
    return null;
  };

  const 传 = async () => {
    if (!文件) return;
    set错(null);
    停了.current = false;
    set阶({ k: "传", 已: 0 });
    let 录 = await 找续(文件).catch(() => null);
    if (!录) {
      const r = await 调("/api/coach-rec/start", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, sourceKind: "上传", fileName: 文件.name, bytes: 文件.size, mime: 文件.type }),
      }).catch(() => null);
      if (!r || !r.ok) {
        set阶({ k: "选" });
        return set错(r ? 话(r, "没开始传，请重试") : "网络断了，没开始传，请重试");
      }
      录 = r.体.录音 as 录音给界面;
      写记(projectId, 文件指纹(文件), 录.id);
    }
    const 收过 = new Map(录.已收片.filter((x) => x.段 === 1).map((x) => [x.片, x.字节]));
    const 片数 = Math.ceil(文件.size / 片上限字节);
    let 已 = 0;
    for (let i = 0; i < 片数; i++) {
      const 起 = i * 片上限字节;
      const 片 = 文件.slice(起, Math.min(文件.size, 起 + 片上限字节));
      if (收过.get(i) === 片.size) {
        已 += 片.size;
        set阶({ k: "传", 已 });
        continue;
      }
      let 好 = false;
      let 最后话 = "网络断了";
      for (let 次 = 0; 次 <= 重试间隔.length && !好; 次++) {
        if (停了.current) return;
        const r = await 调(`/api/coach-rec/${录.id}/chunk/1/${i}`, { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: 片 }).catch(() => null);
        if (r?.ok) { 好 = true; break; }
        // 服务器明说不行的（没权限、格式不对、超了）不重试；网络断、超时、服务器忙才重试
        if (r && r.status !== 429 && r.status !== 408 && r.status < 500) {
          set阶({ k: "选" });
          return set错(话(r, "没传上去"));
        }
        最后话 = r?.status === 429 ? "服务器忙" : "网络断了";
        if (次 < 重试间隔.length) await 等(r?.status === 429 && r.等秒 ? r.等秒 * 1000 : 重试间隔[次]);
      }
      if (!好) return set阶({ k: "停", 已, 为什么: 最后话 });
      已 += 片.size;
      set阶({ k: "传", 已 });
    }
    const f = await 调(`/api/coach-rec/${录.id}/finish`, { method: "POST" }).catch(() => null);
    if (!f || !f.ok) return set阶({ k: "停", 已, 为什么: f ? 话(f, "没传完") : "网络断了" });
    写记(projectId, 文件指纹(文件), null);
    set阶({ k: "完", 录音: f.体.录音 as 录音给界面 });
    router.refresh();
  };

  const 换掉旧的 = async (旧: 录音给界面) => {
    const r = await 调(`/api/coach-rec/${旧.id}/abandon`, { method: "POST" }).catch(() => null);
    if (!r || !r.ok) return set错(r ? 话(r, "旧的没删掉，请重试") : "网络断了，请重试");
    set阶({ k: "选" });
    router.refresh();
  };

  const 关框 = () => {
    停了.current = true;
    关();
  };
  const 已传 = 阶.k === "传" || 阶.k === "停" ? 阶.已 : 0;
  const 底 = 阶.k === "完"
    ? [<Button key="ok" type="primary" onClick={关框} data-testid="crec-done">好了</Button>]
    : 阶.k === "问换"
      ? [
          <Button key="c" onClick={() => { set文件(null); set阶({ k: "选" }); }}>不换，重新选</Button>,
          <Button key="ok" type="primary" danger onClick={() => void 换掉旧的(阶.旧)}>换成这个文件重新传</Button>,
        ]
      : [
          <Button key="c" onClick={关框}>{传中 ? "先不传了" : "取消"}</Button>,
          阶.k === "停"
            ? <Button key="ok" type="primary" onClick={() => void 传()} data-testid="crec-resume">继续</Button>
            : <Button key="ok" type="primary" loading={传中} disabled={!文件 || !!错} onClick={() => void 传()} data-testid="crec-start">开始上传</Button>,
        ];
  return (
    <Modal open title="传录音文件" onCancel={关框} destroyOnHidden width={520} maskClosable={false} className="crec-modal" footer={底}>
      <div className="crec-form" data-testid="crec-upload">
        <div className="crec-notice">录音里可能有客户、同事的声音：原声只有你和项目负责人能听；转写和要点给能看这条点评的人看。</div>
        <div className="crec-row"><span className="crec-k">关联项目</span><span className="crec-v crec-ellipsis" title={项目名}>{项目名}</span></div>
        {阶.k !== "完" && (
          <>
            <input ref={选} type="file" accept={选文件accept} hidden aria-label="选录音文件" disabled={传中}
              onChange={(e) => 选好(e.target.files?.[0] ?? null)} data-testid="crec-file" />
            <Button block onClick={() => 选.current?.click()} disabled={传中}>{文件 ? "换一个文件" : "选录音文件"}</Button>
            <div className="crec-hint">手机录音机、通话录音录好的文件都能传：m4a、mp3、wav、aac、amr 等，单个不超过 {文件上限字节 / 1024 / 1024}MB、2 小时。</div>
          </>
        )}
        {文件 && (
          <div className="crec-file" data-testid="crec-file-info">
            <div className="crec-file-name" title={文件.name}>{文件.name}</div>
            <div className="crec-hint">{读大小(文件.size)}{时长 !== null ? ` · 约 ${读时长(时长)}` : ""}{文件.size > 建议WiFi字节 ? ` · 约 ${读大小(文件.size)}，建议连 Wi-Fi` : ""}</div>
          </div>
        )}
        {阶.k === "问换" && (
          <div role="alert" className="crec-warn">上次没传完的是「{阶.旧.文件名 ?? "录音"}」（{读大小(阶.旧.总字节 ?? 0)}），和这个文件对不上。换成这个文件重新传？上次传的那部分会删掉。</div>
        )}
        {(阶.k === "传" || 阶.k === "停") && 文件 && (
          <div className="crec-progress" aria-live="polite">
            <Progress percent={百分(已传, 文件.size)} status={阶.k === "停" ? "exception" : "active"} />
            {阶.k === "停" && <div role="alert" className="crec-warn" data-testid="crec-stopped">{阶.为什么}，已传 {百分(已传, 文件.size)}%。点「继续」从断的地方接着传。</div>}
          </div>
        )}
        {阶.k === "完" && <PendingCard 录={阶.录音} />}
        {错 && <div role="alert" className="cd-task-err">{错}</div>}
      </div>
    </Modal>
  );
}

/** 待提交卡：回放、「提交整理」（转写接上之前灰着）、删掉。只有录的人看得到（数据只给录的人） */
export function PendingCard({ 录, 删 }: { 录: 录音给界面; 删?: () => void }) {
  return (
    <div className="crec-pending" data-testid="crec-pending">
      <div className="crec-pending-h">
        <span className="crec-file-name" title={录.文件名 ?? ""}>{录.文件名 ?? "录音"}</span>
        <span className="crec-hint">待提交 · {读大小(录.已收字节)}</span>
      </div>
      {录.能听 && <audio className="crec-audio" controls preload="none" src={`/api/coach-rec/${录.id}/audio`} aria-label="回放录音" />}
      <div className="crec-acts">
        <Button size="small" type="primary" disabled title="转写还没开放，开放后点这里开始整理">提交整理</Button>
        {删 && <Button size="small" danger type="text" onClick={删}>删掉</Button>}
      </div>
    </div>
  );
}

/**
 * 沟通卡最上面的录音草稿条（只有录的人自己看得到）：没传完的写「上次传到 62%」+「接着传」「删掉」；传完待提交的出待提交卡
 */
export function CoachRecDrafts({ projectId, 项目名, 草稿们 }: { projectId: string; 项目名: string; 草稿们: 录音给界面[] }) {
  const router = useRouter();
  const [续, set续] = useState<录音给界面 | null>(null);
  const [问删, set问删] = useState<string | null>(null);
  const [忙, set忙] = useState(false);
  const [错, set错] = useState<string | null>(null);
  if (!草稿们.length) return null;
  const 删 = async (id: string) => {
    set忙(true);
    set错(null);
    const r = await 调(`/api/coach-rec/${id}/abandon`, { method: "POST" }).catch(() => null);
    set忙(false);
    if (!r || !r.ok) return set错(r ? 话(r, "没删掉，请重试") : "网络断了，请重试");
    set问删(null);
    router.refresh();
  };
  return (
    <div className="crec-drafts" data-testid="crec-drafts" aria-label="我的录音草稿">
      {草稿们.map((d) => (
        <div key={d.id} className="crec-draft" data-testid="crec-draft">
          {d.status === "上传中" ? (
            <div className="crec-draft-row">
              <span className="crec-draft-t">「{d.文件名 ?? "录音"}」上次传到 {百分(d.已收字节, d.总字节)}%，重新选同一个文件接着传</span>
              <span className="crec-acts">
                <Button size="small" type="primary" onClick={() => set续(d)} data-testid="crec-continue">接着传</Button>
                <Button size="small" danger type="text" onClick={() => set问删(d.id)}>删掉</Button>
              </span>
            </div>
          ) : (
            <PendingCard 录={d} 删={() => set问删(d.id)} />
          )}
          {问删 === d.id && (
            <div className="pd-del-band" role="group" aria-label="确认删掉这条录音" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); set问删(null); } }}>
              <span className="pd-del-band-t">删掉后录音文件一起删，不能恢复</span>
              <span className="pd-del-band-a">
                <Button size="small" onClick={() => set问删(null)} disabled={忙}>取消</Button>
                <Button size="small" type="primary" danger loading={忙} autoFocus onClick={() => void 删(d.id)}>确认删掉</Button>
              </span>
            </div>
          )}
        </div>
      ))}
      {错 && <div role="alert" className="cd-task-err">{错}</div>}
      {续 && <CoachRecUploadModal projectId={projectId} 项目名={项目名} 续={续} 关={() => set续(null)} />}
    </div>
  );
}
