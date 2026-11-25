"use client";
/**
 * 录音点评 · 录音面板（11-22，录音点评 PR3，方案 §4.6–4.8 + 11-22 安卓实测后的调整）：「按住说话」「点按录音」并排两种，记住上次选的。
 *
 * 按住说话（短的口头点评，一条几段合计 ≤10 分钟）：按住按钮（或焦点在录音按钮 / 面板本身时按住空格；焦点在别的按钮、输入框上不拦，PR3 审查）开始，松手结束 → 待提交；
 *   按着往上滑 ≥60px（鼠标拖出按钮）/ 按 Esc = 待取消，松手丢掉；不到 1 秒丢掉（「说话时间太短」）；9:30 起「还能说 30 秒」，10:00 自动当松手。
 *   飞书里优先飞书原生录（feishu-recorder.ts，准备不好退网页录）；第一次用（麦克风还没问过）这一次只拿授权不录。
 * 点按录音（线下陪练这类长录音，一条最长 2 小时）：点一下开始、再点一下停，单独「取消」（先问一句再丢，Esc 不管用，PR3 审查）；一律网页录；手机上开录前提示别锁屏、申请屏幕常亮；录着离开页面先问。
 * 补段沿用第一段的录法（看 sourceKind：飞书原生录的只能接着飞书录、只能按住，录法切换锁住；网页录的在飞书里也走网页录，
 *   按住 / 点按都是网页录、格式一样，不锁——第一段点按录了 30 分钟的，补段照样能点按，PR3 二审）。补段传片被拒（格式、大小）：丢掉这段、退回待提交，前面的段留着。
 * 「准备中」（引飞书 SDK、问麦克风权限）面板关了：中止，不再开麦克风（PR3 审查）。
 * 打断（来电、锁屏、切后台、话筒被占用、录音器出错、触摸被系统收走）→ 当作松手：已录的进待提交，卡上写「录音在 0:42 被打断（…），已录部分已保存」，
 *   可以「再按住补一段」（同一条录音的下一段，服务端拼）。
 * 边录边传：15 秒一片（uploader.ts 片队列，断网攒着重试）；网络跟不上录音时提示「网络较慢……先别关页面」。
 * 两条录法都用不了（飞书里拿不到麦克风、浏览器太老）：给「传录音文件」和「复制链接」到浏览器打开。
 * 电脑：弹框；手机（≤767）：底部升起，左右贴边、上边两角圆（同名单抽屉 .pane-sheet），内容左右各留 16、不横滚（11-26）。按钮关掉长按菜单、选中文字、触摸滚动（.ptt-btn）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Drawer, Modal, Segmented } from "antd";
import { useNarrow } from "@/lib/roster";
import type { 录音给界面 } from "@/lib/enterprise/coach-rec-db";
import { 复制文字 } from "@/lib/clipboard";
import { 按住上限毫秒, 点按上限毫秒, 最短录音毫秒, 录音每片毫秒, 片上限字节, type 打断原因 } from "@/lib/enterprise/coach-rec";
import { 建片队列, 慢话, type 片队列, type 队列状态 } from "./uploader";
import { 能网页录, 麦克风权限, 开麦, 开麦错话, 开录, 网页录每秒字节, type 网页录音 } from "./web-recorder";
import { 在飞书里, 准备飞书录音, 飞书录每秒字节, type 飞书录音器 } from "./feishu-recorder";

export type 录法式 = "按住" | "点按";
const 式键 = "crec-rec-mode";
function 读式(): 录法式 {
  try {
    return localStorage.getItem(式键) === "点按" ? "点按" : "按住";
  } catch {
    return "按住";
  }
}
function 记式(x: 录法式) {
  try {
    localStorage.setItem(式键, x);
  } catch {
    /* 记不住就下次再选 */
  }
}

export const 读秒 = (毫秒: number) => {
  const 秒 = Math.max(0, Math.floor(毫秒 / 1000));
  return 秒 >= 3600 ? `${Math.floor(秒 / 3600)}:${String(Math.floor((秒 % 3600) / 60)).padStart(2, "0")}:${String(秒 % 60).padStart(2, "0")}` : `${Math.floor(秒 / 60)}:${String(秒 % 60).padStart(2, "0")}`;
};
const 上滑取消距离 = 60;
const 倒数毫秒 = 30_000;

async function 调(url: string, 体?: unknown): Promise<{ ok: boolean; 体: Record<string, unknown> }> {
  const r = await fetch(url, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(体 ?? {}) });
  return { ok: r.ok, 体: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}
const 话 = (x: { 体: Record<string, unknown> }, 默认: string) => (typeof x.体.error === "string" ? x.体.error : 默认);

type 一次 = {
  录法: "网页" | "飞书";
  web?: 网页录音;
  fs?: 飞书录音器;
  队列: 片队列;
  每秒字节: number;
  编号: Promise<string | null>;
  段: number;
  起: number;
  结束中: boolean;
  /** 开始 / 接着录接口没成：丢掉这段时给这句，不说「已取消」 */
  失败话?: string;
};

export function HoldToTalkPanel({ projectId, 项目名, 续, 关, 改传文件 }: { projectId: string; 项目名: string; 续?: 录音给界面 | null; 关: () => void; 改传文件?: () => void }) {
  const router = useRouter();
  // 手机按 767 断点直接读（11-26）：Grid.useBreakpoint 头一次渲染还是空的（md 未知），手机上会先挂一下 480 宽的弹框再换成底部面板
  const 手机 = useNarrow("(max-width: 767px)");
  const [选式, set式] = useState<录法式>(() => (typeof window === "undefined" ? "按住" : 读式()));
  const [录, set录] = useState<录音给界面 | null>(续 ?? null);
  const [阶, set阶] = useState<"空" | "准备" | "录" | "收">("空");
  const [已, set已] = useState(0);
  const [取消中, set取消中] = useState(false);
  const [音量, set音量] = useState(0);
  const [提示, set提示] = useState<{ 话: string; 坏?: boolean } | null>(null);
  const [队, set队] = useState<队列状态 | null>(null);
  const [问删, set问删] = useState(false);
  const [忙, set忙] = useState(false);
  const 这次 = useRef<一次 | null>(null);
  const 按着 = useRef(false);
  const 按钮 = useRef<HTMLButtonElement>(null);
  const 面板 = useRef<HTMLDivElement>(null);
  /** 面板关了（点 ×、Esc、换页）：准备中的这次中止，不再开麦克风 */
  const 关了 = useRef(false);
  /** 这次是空格按下开始的：松空格才收尾（焦点挪走了也照样收） */
  const 空格按着 = useRef(false);
  const [问丢段, set问丢段] = useState(false);
  /** 音量条（不写行内样式：按音量改 transform） */
  const 音量条 = useRef<HTMLSpanElement>(null);
  const 常亮 = useRef<{ release: () => Promise<void> } | null>(null);
  const 能录 = 能网页录() || 在飞书里();

  // 补段：沿用第一段的录法（飞书原生录 / 网页录），录法切换锁住；飞书原生录只有按住说话
  const 定的来源 = 录 && 录.段数 >= 1 && 录.sourceKind !== "上传" ? 录.sourceKind : null;
  const 锁式 = 定的来源 === "飞书原生录";
  const 式: 录法式 = 锁式 ? "按住" : 选式;
  // 已经录了多少（补段时前面几段的；服务端算的时长，读不出按 0）
  const 前面 = 录?.时长毫秒 ?? 0;
  const 上限 = 式 === "按住" ? 按住上限毫秒 : 点按上限毫秒;
  const 还能 = 上限 - 前面;

  // 飞书里先把原生录音准备好（按下时少等一会儿）；准备不好按下时退网页录
  useEffect(() => { if (式 === "按住" && 在飞书里() && 定的来源 !== "网页录") void 准备飞书录音(); }, [式, 定的来源]);

  const 收尾 = useCallback(async (怎么: "松手" | "取消" | { 打断: 打断原因 }) => {
    const x = 这次.current;
    if (!x || x.结束中) return;
    x.结束中 = true;
    set问丢段(false);
    const 时长 = Date.now() - x.起;
    void 常亮.current?.release().catch(() => {});
    常亮.current = null;
    set取消中(false);
    set音量(0);
    const 丢 = 怎么 === "取消" || 时长 < 最短录音毫秒;
    if (丢) {
      x.web?.取消();
      x.fs?.取消();
      x.队列.停();
      这次.current = null;
      set阶("收");
      const id = await x.编号;
      if (id) {
        const r = await 调(`/api/coach-rec/${id}/drop`).catch(() => null);
        set录(r?.ok ? ((r.体.录音 as 录音给界面 | null) ?? null) : 录);
      }
      set阶("空");
      set提示(x.失败话 ? { 话: x.失败话, 坏: true } : { 话: 怎么 === "取消" ? "已取消，这段没留" : "说话时间太短，这段没留" });
      router.refresh();
      return;
    }
    const 打断 = typeof 怎么 === "object" ? 怎么.打断 : undefined;
    set阶("收");
    try {
      if (x.web) await x.web.停();
      if (x.fs) {
        const 段 = await x.fs.停();
        for (let i = 0; i * 片上限字节 < 段.数据.byteLength; i++) x.队列.放(x.段, i, new Blob([段.数据.slice(i * 片上限字节, (i + 1) * 片上限字节)]));
      }
    } catch {
      // 飞书原生录中途坏了：这一页之后改走网页录（feishu-recorder 记着）；前面是飞书录的补段不能换网页录
      x.队列.停();
      这次.current = null;
      set阶("空");
      set提示({ 话: 定的来源 === "飞书原生录" ? "这段没录下来（飞书录音出错）。这条前面是飞书录的，补的也得飞书录：先提交这条，要补的另录一条" : "这段没录下来（飞书录音出错），再按住一次会改用网页录", 坏: true });
      const id = await x.编号;
      if (id) await 调(`/api/coach-rec/${id}/drop`).catch(() => null);
      return;
    }
    const id = await x.编号;
    if (!id) { 这次.current = null; set阶("空"); return; }
    // 等片传完：网络断了一直重试（界面写「联网后自动补传」），服务器明说不行的停下
    for (;;) {
      if (await x.队列.等传完(60_000)) break;
      const s = x.队列.状态();
      if (s.错 || s.停了) break;
    }
    const 错 = x.队列.状态().错;
    这次.current = null;
    if (错) {
      // 补段（前面已有拼好的段）传片被拒（格式不一样、超大小）：丢掉这段、退回待提交，不让整条停在上传中（7 天后连前面的段一起删，PR3 二审）
      if (x.段 > 1) {
        const d = await 调(`/api/coach-rec/${id}/drop`).catch(() => null);
        if (d?.ok) set录((d.体.录音 as 录音给界面 | null) ?? null);
        set阶("空");
        // 录音的说法（跟进 11-22）：先说这段没传上、前面的还在，原因放括号里（「这一段……」开头的去掉重复的「这一段」）
        set提示({ 话: `这一段录音没传上，前面录的还在（${错.replace(/^这一段/, "")}）`, 坏: true });
        router.refresh();
        return;
      }
      set阶("空");
      set提示({ 话: 错, 坏: true });
      return;
    }
    const 秒 = Math.round((前面 + 时长) / 1000);
    const r = await 调(`/api/coach-rec/${id}/finish`, 打断 ? { 打断: { 秒, 原因: 打断 } } : {}).catch(() => null);
    set阶("空");
    set队(null);
    if (!r?.ok) { set提示({ 话: r ? 话(r, "没存上，请重试") : "网络断了，没存上，刷新后从草稿条接着来", 坏: true }); return; }
    set录(r.体.录音 as 录音给界面);
    set提示(打断 ? { 话: `录音在 ${读秒(前面 + 时长)} 被打断（${打断}），已录部分已保存，可以再${式 === "按住" ? "按住" : "点"}补一段` } : 前面 + 时长 >= 上限 - 500 ? { 话: `单次最长 ${上限 / 60_000} 分钟，已到上限` } : null);
    router.refresh();
  }, [前面, 上限, 式, 录, 定的来源, router]);

  const 开始 = useCallback(async () => {
    if (阶 !== "空" || 这次.current) return;
    set提示(null);
    if (还能 <= 最短录音毫秒) return set提示({ 话: 式 === "按住" && 定的来源 === "网页录" && 前面 < 点按上限毫秒 ? `这条已经超过 ${上限 / 60_000} 分钟，改用「点按录音」接着录，或者先提交` : `这条已经录满 ${上限 / 60_000} 分钟，提交以后另录一条`, 坏: true });
    if (录 && !录.能补) return set提示({ 话: "这条已经交了，另起一条录", 坏: true });
    set阶("准备");
    // 选录法：补段沿用第一段的；新的一条：按住说话在飞书里先原生（这一页原生录坏过的直接网页录），不行退网页录；点按录音一律网页录
    const 要飞书 = 定的来源 ? 定的来源 === "飞书原生录" : 式 === "按住" && 在飞书里();
    const fs = 要飞书 ? await 准备飞书录音() : null;
    if (关了.current) return;
    if (定的来源 === "飞书原生录" && !fs) { set阶("空"); return set提示({ 话: "这条前面是飞书录的，补的也得飞书录，可飞书录音这会儿用不了：先提交这条，要补的另录一条", 坏: true }); }
    let 流: MediaStream | null = null;
    if (!fs) {
      if (!能网页录()) { set阶("空"); return set提示({ 话: "这里录不了音：可以改用「传录音文件」，或者复制链接到浏览器里打开", 坏: true }); }
      const 权限 = 式 === "按住" ? await 麦克风权限() : "不知道";
      if (关了.current) return;
      try {
        流 = await 开麦();
      } catch (e) {
        if (关了.current) return;
        set阶("空");
        return set提示({ 话: 开麦错话(e).话, 坏: true });
      }
      if (关了.current) { for (const t of 流.getTracks()) t.stop(); return; }
      // 第一次用（刚弹过授权）或者授权时已经松手了：这一次只拿授权，不录
      if (式 === "按住" && (权限 === "prompt" || !按着.current)) {
        for (const t of 流.getTracks()) t.stop();
        set阶("空");
        return set提示({ 话: "已允许使用麦克风，请重新按住说话" });
      }
    }
    if (式 === "按住" && !按着.current) { for (const t of 流?.getTracks() ?? []) t.stop(); set阶("空"); return; }
    const 段 = (录?.段数 ?? 0) + 1;
    const 每秒字节 = fs ? 飞书录每秒字节 : 网页录每秒字节;
    const 队列 = 建片队列({ 每秒字节, 变了: set队 });
    const 编号 = (async () => {
      const r = 录
        ? await 调(`/api/coach-rec/${录.id}/resume`).catch(() => null)
        : await 调("/api/coach-rec/start", { projectId, sourceKind: fs ? "飞书原生录" : "网页录" }).catch(() => null);
      if (!r?.ok) {
        const 这 = 这次.current;
        if (这) 这.失败话 = r ? 话(r, "没开始录，请重试") : "网络断了，没开始录，请重试";
        void 收尾("取消");
        return null;
      }
      const x = r.体.录音 as 录音给界面;
      队列.给编号(x.id);
      return x.id;
    })();
    const x: 一次 = { 录法: fs ? "飞书" : "网页", 队列, 每秒字节, 编号, 段, 起: Date.now(), 结束中: false };
    这次.current = x;
    try {
      if (fs) fs.开始({ 音量: set音量, 断了: (原因) => void 收尾({ 打断: 原因 }) });
      else x.web = 开录(流!, { 每片毫秒: 录音每片毫秒, 片到了: (b, i) => 队列.放(段, i, b), 音量: set音量, 断了: (原因) => void 收尾({ 打断: 原因 }) });
      x.fs = fs ?? undefined;
    } catch {
      for (const t of 流?.getTracks() ?? []) t.stop();
      这次.current = null;
      set阶("空");
      void 编号.then((id) => { if (id) void 调(`/api/coach-rec/${id}/drop`).catch(() => null); });
      return set提示({ 话: "录音开不起来，可以改用「传录音文件」", 坏: true });
    }
    x.起 = Date.now();
    set已(0);
    set阶("录");
    try { navigator.vibrate?.(20); } catch { /* 不支持就不振 */ }
    if (式 === "点按") {
      try {
        常亮.current = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen") ?? null;
      } catch {
        常亮.current = null; // 拿不到不报错
      }
    }
  }, [阶, 还能, 上限, 前面, 录, 式, 定的来源, projectId, 收尾]);

  useEffect(() => { 音量条.current?.style.setProperty("transform", `scaleX(${Math.max(0.05, 音量)})`); });

  // 计时、倒数、到上限自动当松手
  useEffect(() => {
    if (阶 !== "录") return;
    const t = setInterval(() => {
      const x = 这次.current;
      if (!x) return;
      const 过 = Date.now() - x.起;
      set已(过);
      if (过 >= 还能) void 收尾("松手");
    }, 200);
    return () => clearInterval(t);
  }, [阶, 还能, 收尾]);

  // 打断：页面转后台（锁屏、切 App、来电界面盖上来）当作松手；点按录音录着离开页面先问
  useEffect(() => {
    if (阶 !== "录") return;
    const 藏 = () => { if (document.visibilityState === "hidden") void 收尾({ 打断: "锁屏或切到后台" }); };
    const 走 = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    document.addEventListener("visibilitychange", 藏);
    if (式 === "点按") window.addEventListener("beforeunload", 走);
    return () => { document.removeEventListener("visibilitychange", 藏); window.removeEventListener("beforeunload", 走); };
  }, [阶, 式, 收尾]);

  // 按住空格 = 按住按钮：只在焦点在录音按钮上、或者面板本身（面板、弹框框体、没有别的焦点）时；焦点在别的按钮、输入框、选项上不拦（PR3 审查）。
  // 按住说话录着按 Esc = 取消；点按录音 Esc 不管用（取消要点「取消」再确认）
  useEffect(() => {
    const 控件 = "button, a[href], input, select, textarea, [contenteditable], [role=button], [role=radio], [role=tab], [role=menuitem], [role=option], [role=checkbox], [role=switch]";
    const 归面板 = (t: EventTarget | null) => {
      const 板 = 面板.current;
      if (!板 || !(t instanceof Element)) return false;
      if (t === 按钮.current) return true;
      if (t.closest(控件)) return false;
      return t === 板 || t.contains(板) || 板.contains(t) || !!t.closest(".ptt-modal, .ptt-sheet");
    };
    const 下 = (e: KeyboardEvent) => {
      if (e.key === "Escape" && 这次.current && 式 === "按住") { e.preventDefault(); e.stopPropagation(); void 收尾("取消"); return; }
      if (式 !== "按住" || e.code !== "Space" || e.repeat || !归面板(e.target)) return;
      e.preventDefault();
      空格按着.current = true;
      按着.current = true;
      void 开始();
    };
    const 上 = (e: KeyboardEvent) => {
      if (式 !== "按住" || e.code !== "Space" || !空格按着.current) return;
      e.preventDefault();
      空格按着.current = false;
      按着.current = false;
      if (这次.current) void 收尾("松手");
    };
    window.addEventListener("keydown", 下, true);
    window.addEventListener("keyup", 上, true);
    return () => { window.removeEventListener("keydown", 下, true); window.removeEventListener("keyup", 上, true); };
  }, [式, 开始, 收尾]);

  // 面板关了（换页、点 ×）还在录：当作松手存下（用最新的收尾，只在真关掉时跑）
  const 收尾钩 = useRef(收尾);
  useEffect(() => { 收尾钩.current = 收尾; }, [收尾]);
  useEffect(() => {
    关了.current = false;
    return () => {
      关了.current = true;
      if (这次.current) void 收尾钩.current("松手");
    };
  }, []);
  // 打开时焦点放到面板上（按空格就能录）
  useEffect(() => { const t = setTimeout(() => { if (!面板.current?.contains(document.activeElement)) 面板.current?.focus({ preventScroll: true }); }, 0); return () => clearTimeout(t); }, []);

  const 按下 = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (式 !== "按住" || e.button !== 0) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 拿不到捕获也照样能用 */ }
    按着.current = true;
    void 开始();
  };
  const 移 = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (式 !== "按住" || !这次.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const 出去 = e.pointerType === "mouse" ? e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom : r.top - e.clientY >= 上滑取消距离;
    set取消中(出去);
  };
  const 抬 = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (式 !== "按住") return;
    按着.current = false;
    if (!这次.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const 出去 = e.pointerType === "mouse" ? e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom : r.top - e.clientY >= 上滑取消距离;
    void 收尾(出去 || 取消中 ? "取消" : "松手");
  };
  const 被收走 = () => {
    if (式 !== "按住") return;
    按着.current = false;
    if (这次.current) void 收尾({ 打断: "锁屏或切到后台" });
  };
  const 点 = () => {
    if (式 !== "点按") return;
    if (阶 === "录") void 收尾("松手");
    else if (阶 === "空") void 开始();
  };

  const 删 = async () => {
    if (!录) return;
    set忙(true);
    const r = await 调(`/api/coach-rec/${录.id}/abandon`).catch(() => null);
    set忙(false);
    if (!r?.ok) return set提示({ 话: r ? 话(r, "没删掉，请重试") : "网络断了，请重试", 坏: true });
    set录(null);
    set问删(false);
    set提示({ 话: "已删掉" });
    router.refresh();
  };
  const 交 = async () => {
    if (!录) return;
    set忙(true);
    const r = await 调(`/api/coach-rec/${录.id}/submit`).catch(() => null);
    set忙(false);
    if (!r?.ok) return set提示({ 话: r ? 话(r, "没交上，请重试") : "网络断了，请重试", 坏: true });
    router.refresh();
    关();
  };

  const 录着 = 阶 === "录";
  const 补 = !!录 && 录.能补;
  const 按钮字 = 式 === "按住"
    ? 录着 ? (取消中 ? "松手 取消" : "松开 结束") : 阶 === "准备" ? "准备中…" : 阶 === "收" ? "正在保存…" : 补 ? "按住 再补一段" : "按住 说话"
    : 录着 ? "点击 停止" : 阶 === "准备" ? "准备中…" : 阶 === "收" ? "正在保存…" : 补 ? "点击 接着录一段" : "点击 开始录音";
  const 剩 = 还能 - 已;
  const 慢 = 队 ? 慢话(队, 这次.current?.每秒字节 ?? 网页录每秒字节) : null;
  const 体 = (
    <div className="ptt-panel" data-testid="ptt-panel" ref={面板} tabIndex={-1}>
      <div className="crec-notice">请先告知在场的人正在录音。录音挂在项目「{项目名}」上；原声只有你和项目负责人能听。</div>
      <Segmented block value={式} disabled={阶 !== "空" || 锁式} onChange={(v) => { set式(v as 录法式); 记式(v as 录法式); set提示(null); }}
        options={[{ label: "按住说话", value: "按住" }, { label: "点按录音", value: "点按" }]} data-testid="ptt-mode" />
      <div className="crec-hint">{式 === "按住" ? `按住说话，松手结束；往上滑（或按 Esc）取消。一条最长 ${按住上限毫秒 / 60_000} 分钟，适合短点评。` : `点一下开始、再点一下停，适合陪练这类长录音，一条最长 ${点按上限毫秒 / 3_600_000} 小时。`}</div>
      {/* 按着的时候按钮上面的东西不能变高变矮（按钮一挪，指针就「出了按钮」= 取消）：待提交块录着也留着（只收起按钮），计时条占一格固定高的位置，提示写在按钮下面 */}
      {录 && (
        <div className="crec-pending" data-testid="ptt-pending" data-status={录.status}>
          <div className="crec-pending-h">
            <span className="crec-file-name">已录 {录.段数} 段{录.时长毫秒 ? ` · ${读秒(录.时长毫秒)}` : ""}</span>
            <span className="crec-hint">{录.status === "待提交" ? "待提交" : 录.status}</span>
          </div>
          {(录.打断们 ?? []).map((d, i) => <div key={i} className="crec-hint" data-testid="ptt-interrupted">录音在 {读秒(d.秒 * 1000)} 被打断（{d.原因}），已录部分已保存</div>)}
          {录.能听 && Array.from({ length: Math.max(1, 录.段数) }, (_, i) => (
            <div key={i} className="crec-seg">{录.段数 > 1 && <span className="crec-hint">第 {i + 1} 段</span>}<audio className="crec-audio" controls preload="none" src={`/api/coach-rec/${录.id}/audio${录.段数 > 1 ? `?seg=${i + 1}` : ""}`} aria-label={录.段数 > 1 ? `回放第 ${i + 1} 段` : "回放录音"} /></div>
          ))}
          {录.status === "待提交" && 阶 === "空" && (
            <div className="crec-acts">
              <Button size="small" type="primary" loading={忙} onClick={() => void 交()} data-testid="ptt-submit">提交整理</Button>
              <Button size="small" danger type="text" disabled={忙} onClick={() => set问删(true)} data-testid="ptt-delete">删掉</Button>
            </div>
          )}
          {问删 && 阶 === "空" && (
            <div className="pd-del-band" role="group" aria-label="放弃这段录音？">
              <span className="pd-del-band-t">放弃这段录音？{录.时长毫秒 ? `已录 ${读秒(录.时长毫秒)}，` : ""}删了不能恢复</span>
              <span className="pd-del-band-a">
                <Button size="small" onClick={() => set问删(false)} disabled={忙}>取消</Button>
                <Button size="small" type="primary" danger loading={忙} onClick={() => void 删()} data-testid="ptt-delete-ok">放弃</Button>
              </span>
            </div>
          )}
        </div>
      )}
      {能录 && (
        <div className="ptt-slot">
          {录着 && (
            <div className={`ptt-float${取消中 ? " ptt-cancel" : ""}`} role="status" aria-live="polite" data-testid="ptt-float">
              <span className="ptt-dot" aria-hidden />
              <span className="ptt-time" data-testid="ptt-time">{读秒(前面 + 已)}</span>
              <span className="ptt-level" aria-hidden><span ref={音量条} /></span>
              <span className="ptt-float-t">{取消中 ? "松手取消" : 剩 <= 倒数毫秒 ? `还能说 ${Math.max(0, Math.ceil(剩 / 1000))} 秒` : 式 === "按住" ? "上滑取消" : `已录 ${Math.floor((前面 + 已) / 1000)} 秒`}</span>
            </div>
          )}
        </div>
      )}
      {!能录 ? (
        <div className="ptt-fallback" data-testid="ptt-fallback">
          <div className="crec-warn">这里录不了音：可以改用「传录音文件」，或者复制链接到手机浏览器里打开再录。</div>
          <span className="crec-acts">
            {改传文件 && <Button onClick={改传文件}>传录音文件</Button>}
            <Button onClick={() => { void 复制文字(location.href).then((成) => set提示(成 ? { 话: "链接已复制" } : { 话: "复制不了，请长按地址栏复制", 坏: true })); }}>复制链接</Button>
          </span>
        </div>
      ) : (
        <div className="ptt-row">
          <button ref={按钮} type="button" className={`ptt-btn${录着 ? " ptt-on" : ""}${取消中 ? " ptt-cancel" : ""}`} data-testid="ptt-btn"
            disabled={阶 === "收" || (阶 === "准备" && 式 === "点按")}
            aria-label={式 === "点按" ? (录着 ? "停止录音" : "开始录音") : 按钮字} aria-pressed={录着}
            onPointerDown={按下} onPointerMove={移} onPointerUp={抬} onPointerCancel={被收走} onLostPointerCapture={() => { if (式 === "按住" && 按着.current && 这次.current) 被收走(); }}
            onClick={点} onContextMenu={(e) => e.preventDefault()}>
            {按钮字}
          </button>
          {式 === "点按" && 录着 && <Button className="ptt-cancel-btn" onClick={() => set问丢段(true)} disabled={问丢段} data-testid="ptt-cancel">取消</Button>}
        </div>
      )}
      {式 === "点按" && 录着 && 问丢段 && (
        <div className="pd-del-band" role="group" aria-label="丢掉正在录的这段？" data-testid="ptt-cancel-ask">
          <span className="pd-del-band-t">丢掉正在录的这段？已录 {读秒(已)}，丢了不能恢复{录?.段数 ? "（前面录好的段留着）" : ""}</span>
          <span className="pd-del-band-a">
            <Button size="small" onClick={() => set问丢段(false)} data-testid="ptt-cancel-no">接着录</Button>
            <Button size="small" type="primary" danger onClick={() => void 收尾("取消")} data-testid="ptt-cancel-ok">丢掉</Button>
          </span>
        </div>
      )}
      {提示 && <div role={提示.坏 ? "alert" : "status"} className={提示.坏 ? "crec-warn" : "crec-hint"} data-testid="ptt-tip">{提示.话}</div>}
      {慢 && <div role="status" className="crec-warn" data-testid="ptt-slow">{慢}</div>}
      {式 === "点按" && 手机 && <div className="crec-hint" data-testid="ptt-keep-awake">录音时请保持屏幕亮着、不要切到别的 App；来电会打断录音</div>}
    </div>
  );
  const 关面板 = () => { 关了.current = true; if (阶 === "录" && 式 === "点按") void 收尾("松手"); 关(); };
  return 手机 ? (
    <Drawer open placement="bottom" height="auto" title="录音点评" onClose={关面板} rootClassName="ptt-sheet" keyboard={!录着} destroyOnHidden>{体}</Drawer>
  ) : (
    <Modal open title="录音点评" onCancel={关面板} footer={null} width={480} keyboard={!录着} maskClosable={false} destroyOnHidden className="ptt-modal">{体}</Modal>
  );
}
