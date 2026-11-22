/**
 * 录音点评 · 飞书原生录（11-22，录音点评 PR3，方案 §4.8；11-22 安卓实测定的路线）：只给「按住说话」用（单次最长 10 分钟），点按录音一律网页录。
 *
 * 准备（每页一次，成功的记着）：在飞书里（UA 认出飞书）→ 引飞书网页 SDK → 取签名（/api/feishu/jsapi-sign，只签本站客户页、项目页）
 *   → h5sdk.config → tt.authorize(scope.record) → tt.getRecorderManager()。任一步不行 = null，调用方退网页录。
 * 录：按下 start（16k 单声道，iOS 出 m4a、安卓出 wav），松手 stop；onStop 给 tempFilePath → getFileSystemManager().readFile 读成字节
 *   （安卓实测：tt.uploadFile 不可用，readFile + fetch 可以）→ 调用方按 5MB 切片走 PUT chunk。
 * 音量：有 onFrameRecorded 就按帧画（不是真响度，只是在动）；中断：onInterruptionBegin / onError → 断了。
 * 中途坏了（停的时候没给文件、readFile 失败、超时没回、录着出错）：这一页记下「原生录坏了」，之后 准备飞书录音 一律回 null、改走网页录，不再反复试原生（PR3 审查）。
 * 产品代码不带桩：测试在页面里注入假的 window.tt / window.h5sdk。
 */
import type { 打断原因 } from "@/lib/enterprise/coach-rec";

export const 飞书SDK地址 = "https://lf-scm-cn.feishucdn.com/lark/op/h5-js-sdk-1.5.44.js";
/** 安卓 wav 16k 单声道约 32KB/秒（判网络慢用） */
export const 飞书录每秒字节 = 32_000;

type 回调参 = { success?: (r: unknown) => void; fail?: (e: unknown) => void };
type 管理器 = {
  start: (o: Record<string, unknown>) => void;
  stop: () => void;
  onStart?: (f: () => void) => void;
  onStop?: (f: (r: { tempFilePath?: string; filePath?: string; duration?: number }) => void) => void;
  onError?: (f: (e: unknown) => void) => void;
  onFrameRecorded?: (f: (r: unknown) => void) => void;
  onInterruptionBegin?: (f: () => void) => void;
};
type 飞书tt = {
  getRecorderManager?: () => 管理器 | null;
  authorize?: (o: { scope: string } & 回调参) => void;
  getFileSystemManager?: () => { readFile?: (o: { filePath: string } & 回调参) => void } | null;
};
type 飞书h5sdk = { config: (o: Record<string, unknown>) => void; error?: (f: (e: unknown) => void) => void };
const w = () => window as unknown as { tt?: 飞书tt; h5sdk?: 飞书h5sdk };

export function 在飞书里(): boolean {
  return typeof navigator !== "undefined" && /Lark|Feishu/i.test(navigator.userAgent);
}

function 引SDK(): Promise<boolean> {
  if (w().h5sdk && w().tt) return Promise.resolve(true);
  return new Promise((ok) => {
    const s = document.createElement("script");
    s.src = 飞书SDK地址;
    s.async = true;
    const 限 = setTimeout(() => ok(false), 8_000);
    s.onload = () => { clearTimeout(限); ok(!!w().h5sdk && !!w().tt); };
    s.onerror = () => { clearTimeout(限); ok(false); };
    document.head.appendChild(s);
  });
}

async function 鉴权(): Promise<boolean> {
  const r = await fetch(`/api/feishu/jsapi-sign?url=${encodeURIComponent(location.href.split("#")[0])}`, { credentials: "same-origin", cache: "no-store" }).catch(() => null);
  if (!r?.ok) return false;
  const j = (await r.json().catch(() => null)) as { appId?: string; timestamp?: number; nonceStr?: string; signature?: string } | null;
  if (!j?.appId) return false;
  return new Promise((ok) => {
    const 限 = setTimeout(() => ok(false), 8_000);
    try {
      w().h5sdk!.config({
        appId: j.appId, timestamp: j.timestamp, nonceStr: j.nonceStr, signature: j.signature,
        jsApiList: ["getRecorderManager", "authorize", "getFileSystemManager"],
        onSuccess: () => { clearTimeout(限); ok(true); },
        onFail: () => { clearTimeout(限); ok(false); },
      });
    } catch {
      clearTimeout(限);
      ok(false);
    }
  });
}

function 要录音授权(): Promise<boolean> {
  const tt = w().tt;
  if (!tt?.authorize) return Promise.resolve(true); // 没有 authorize：按能用试，start 不行会走 onError
  return new Promise((ok) => {
    try {
      tt.authorize!({ scope: "scope.record", success: () => ok(true), fail: () => ok(false) });
    } catch {
      ok(false);
    }
  });
}

function 读文件(路径: string): Promise<ArrayBuffer> {
  return new Promise((ok, 坏) => {
    const fsm = w().tt?.getFileSystemManager?.();
    if (!fsm?.readFile) return 坏(new Error("没有 readFile"));
    fsm.readFile({
      filePath: 路径,
      success: (r) => { const d = (r as { data?: unknown })?.data; if (d instanceof ArrayBuffer) ok(d); else 坏(new Error("readFile 给的不是字节")); },
      fail: () => 坏(new Error("readFile 失败")),
    });
  });
}

export type 飞书一段 = { 数据: ArrayBuffer; 格式: string };
export type 飞书录音器 = {
  /** 按下：开始；音量、断了是这一段的回调 */
  开始: (opt: { 音量?: (v: number) => void; 断了?: (原因: 打断原因) => void }) => void;
  /** 松手：停，读出文件字节；没给文件 / 读不出抛错 */
  停: () => Promise<飞书一段>;
  /** 取消：停了不要文件 */
  取消: () => void;
};

let 准备好: Promise<飞书录音器 | null> | null = null;
/** 这一页飞书原生录中途坏过：之后都走网页录 */
let 原生坏了 = false;
export const 飞书录坏过 = () => 原生坏了;
/** 测试用：重新准备 */
export const 忘掉飞书准备 = () => { 准备好 = null; 原生坏了 = false; };

/** 准备飞书原生录（每页一次；失败的也记着，不反复试）：不在飞书里、这一页原生录坏过、SDK / 鉴权 / 授权 / 管理器任一步不行 = null */
export function 准备飞书录音(): Promise<飞书录音器 | null> {
  if (!在飞书里() || 原生坏了) return Promise.resolve(null);
  准备好 ??= (async () => {
    if (!(await 引SDK())) return null;
    if (!(await 鉴权())) return null;
    if (!(await 要录音授权())) return null;
    let m: 管理器 | null = null;
    try {
      m = w().tt?.getRecorderManager?.() ?? null;
    } catch {
      m = null;
    }
    if (!m || typeof m.start !== "function") return null;
    return 包管理器(m);
  })().catch(() => null);
  return 准备好;
}

function 包管理器(m: 管理器): 飞书录音器 {
  let 这段: { 音量?: (v: number) => void; 断了?: (原因: 打断原因) => void; 取消: boolean; 等停?: { ok: (x: 飞书一段) => void; 坏: (e: Error) => void } } | null = null;
  let 帧 = 0;
  m.onFrameRecorded?.(() => { 帧 += 1; 这段?.音量?.(0.2 + (帧 % 5) * 0.15); });
  m.onInterruptionBegin?.(() => 这段?.断了?.("来电或话筒被占用"));
  m.onError?.(() => {
    const x = 这段;
    if (!x) return;
    原生坏了 = true;
    if (x.等停) x.等停.坏(new Error("飞书录音出错"));
    else x.断了?.("录音出错");
  });
  m.onStop?.((r) => {
    const x = 这段;
    这段 = null;
    if (!x || x.取消 || !x.等停) return;
    const 路径 = r?.tempFilePath || r?.filePath || "";
    if (!路径) return x.等停.坏(new Error("飞书没给录音文件"));
    const 格式 = (/\.([a-z0-9]+)(?:\?|$)/i.exec(路径)?.[1] ?? "").toLowerCase();
    读文件(路径).then((数据) => x.等停!.ok({ 数据, 格式 }), x.等停.坏);
  });
  return {
    开始(opt) {
      这段 = { ...opt, 取消: false };
      帧 = 0;
      m.start({ duration: 600_000, sampleRate: 16_000, numberOfChannels: 1, encodeBitRate: 48_000, format: "aac" });
    },
    停() {
      return new Promise<飞书一段>((成, 败) => {
        // 只认第一个结果：读到文件以后 15 秒的超时不再算「坏了」
        let 定了 = false;
        const ok = (x: 飞书一段) => { if (定了) return; 定了 = true; 成(x); };
        const 坏 = (e: Error) => { if (定了) return; 定了 = true; 原生坏了 = true; 败(e); };
        if (!这段) return 败(new Error("没在录"));
        这段.等停 = { ok, 坏 };
        try {
          m.stop();
        } catch {
          坏(new Error("飞书录音停不下来"));
        }
        setTimeout(() => 坏(new Error("飞书没回录音文件")), 15_000);
      });
    },
    取消() {
      if (这段) 这段.取消 = true;
      try {
        m.stop();
      } catch {
        /* 停不下来也不要了 */
      }
    },
  };
}
