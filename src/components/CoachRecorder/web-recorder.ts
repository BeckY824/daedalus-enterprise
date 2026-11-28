/**
 * 录音点评 · 网页录（11-22，录音点评 PR3，方案 §4.3、§4.7）：getUserMedia + MediaRecorder，按下才开麦克风（不常驻），停了就关。
 *
 * - 格式按顺序试：audio/mp4;codecs=mp4a.40.2 → audio/mp4 → audio/ogg;codecs=opus → audio/webm;codecs=opus；单声道、约 24kbps
 * - 边录边出片：timeslice 15 秒一片（片队列 uploader.ts 接着传）；停的时候最后一片也交出来再算停完
 * - 音量：AnalyserNode 算响度（0–1），每帧回调；拿不到 AudioContext 就不给（界面换成不随声音变的动效）
 * - 打断（方案 §4.6）：麦克风轨道 ended / mute（来电、别的应用占了话筒）、录音器 error → 回调 断了（界面当作松手）
 */
import type { 打断原因 } from "@/lib/enterprise/coach-rec";
import { 登记忙 } from "@/lib/swap-guard";

export const 候选格式 = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm;codecs=opus"] as const;
/** 约 24kbps ≈ 3KB/秒（判网络慢用） */
export const 网页录每秒字节 = 3_000;

export function 能网页录(): boolean {
  return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder === "function";
}

export function 选格式(): string | null {
  if (typeof window === "undefined" || typeof window.MediaRecorder !== "function") return null;
  for (const t of 候选格式) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      /* 有的浏览器问了就抛：当不支持 */
    }
  }
  return null;
}

/** 麦克风权限现在是什么（问不了 = 不知道）：prompt 时这一次按下只拿授权、不录（方案 §4.7 第一次用） */
export async function 麦克风权限(): Promise<"granted" | "denied" | "prompt" | "不知道"> {
  try {
    const r = await navigator.permissions?.query({ name: "microphone" as PermissionName });
    return r ? (r.state as "granted" | "denied" | "prompt") : "不知道";
  } catch {
    return "不知道";
  }
}

export async function 开麦(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
}

/** 开麦失败给人看的话（拒了、没设备、被占用） */
export function 开麦错话(e: unknown): { 话: string; 拒了: boolean } {
  const 名 = e instanceof Error ? e.name : "";
  if (名 === "NotAllowedError" || 名 === "SecurityError") {
    const 飞书 = typeof navigator !== "undefined" && /Lark|Feishu/i.test(navigator.userAgent);
    return { 拒了: true, 话: 飞书 ? "麦克风没被允许：点右上角「…」在浏览器打开，再允许麦克风；或者改用「传录音文件」" : "麦克风没被允许：点地址栏左边的锁形图标，把麦克风改成允许，再按住说话；或者改用「传录音文件」" };
  }
  if (名 === "NotFoundError" || 名 === "OverconstrainedError") return { 拒了: false, 话: "没找到麦克风：插上耳机或麦克风再试，或者改用「传录音文件」" };
  if (名 === "NotReadableError" || 名 === "AbortError") return { 拒了: false, 话: "麦克风被别的应用占着（比如正在通话），挂断后再试" };
  return { 拒了: false, 话: "打不开麦克风，可以改用「传录音文件」" };
}

export type 网页录音 = {
  mime: string;
  /** 停：等最后一片交出来、关麦克风 */
  停: () => Promise<void>;
  /** 取消：不要最后一片，直接关 */
  取消: () => void;
};

export function 开录(流: MediaStream, opt: { 每片毫秒: number; 片到了: (数据: Blob, 序号: number) => void; 音量?: (v: number) => void; 断了?: (原因: 打断原因) => void }): 网页录音 {
  const 格式 = 选格式();
  const rec = new MediaRecorder(流, { ...(格式 ? { mimeType: 格式 } : {}), audioBitsPerSecond: 24_000 });
  // 录着的时候不能静默换版（lib/swap-guard.ts），收拾时放掉；登记放在 rec.start() 成功之后（start 抛错就没有人调收拾）
  let 放忙 = () => {};
  let 序号 = 0;
  let 取消了 = false;
  let 结束了 = false;
  let 停完: (() => void) | null = null;
  const 停好 = new Promise<void>((r) => (停完 = r));
  rec.ondataavailable = (e) => {
    if (取消了 || !e.data || e.data.size === 0) return;
    opt.片到了(e.data, 序号++);
  };
  rec.onstop = () => { 收拾(); 停完?.(); };
  rec.onerror = () => { if (!结束了) opt.断了?.("录音出错"); };
  const 轨们 = 流.getAudioTracks();
  const 轨断 = () => { if (!结束了) opt.断了?.("来电或话筒被占用"); };
  for (const t of 轨们) {
    t.addEventListener("ended", 轨断);
    t.addEventListener("mute", 轨断);
  }
  // 音量条：AnalyserNode 的时域响度
  let 帧 = 0;
  let 上下文: AudioContext | null = null;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AC && opt.音量) {
      上下文 = new AC();
      const 源 = 上下文.createMediaStreamSource(流);
      const an = 上下文.createAnalyser();
      an.fftSize = 512;
      源.connect(an);
      const buf = new Uint8Array(an.fftSize);
      const 看 = () => {
        an.getByteTimeDomainData(buf);
        let 和 = 0;
        for (const b of buf) 和 += ((b - 128) / 128) ** 2;
        opt.音量?.(Math.min(1, Math.sqrt(和 / buf.length) * 3));
        帧 = requestAnimationFrame(看);
      };
      帧 = requestAnimationFrame(看);
    }
  } catch {
    上下文 = null;
  }
  function 收拾() {
    结束了 = true;
    放忙();
    cancelAnimationFrame(帧);
    for (const t of 轨们) {
      t.removeEventListener("ended", 轨断);
      t.removeEventListener("mute", 轨断);
      t.stop();
    }
    void 上下文?.close().catch(() => {});
  }
  try {
    rec.start(opt.每片毫秒);
  } catch (e) {
    try { 收拾(); } catch { /* 不盖住 start 的原错误 */ }
    throw e;
  }
  放忙 = 登记忙("录音");
  return {
    mime: rec.mimeType || 格式 || "",
    async 停() {
      if (rec.state !== "inactive") rec.stop();
      else 收拾();
      await Promise.race([停好, new Promise((r) => setTimeout(r, 3_000))]);
    },
    取消() {
      取消了 = true;
      if (rec.state !== "inactive") rec.stop();
      else 收拾();
    },
  };
}
