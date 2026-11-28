/**
 * 录音点评 · 边录边传的片队列（11-22，录音点评 PR3，方案 §4.6）：一片一片按顺序 PUT /api/coach-rec/<id>/chunk/<段>/<片>。
 *
 * - 录音编号可以晚到（按下就开录，开始接口在路上）：编号没到之前片先攒着
 * - 一片失败按 2 / 5 / 15 秒退着重试，一直重试到传上去（片攒在内存里）；服务器明说不行的（4xx，除了 408 / 429）停下、报错
 * - 上行速度：按最近几片算（字节 / 秒）；攒着没传的超过 慢线秒 的录音量、或者速度跟不上录音的码率 = 慢，界面提示「网络较慢」
 *   （PR4 审查：上行太慢给前端提示）
 * 只在浏览器里用；网络用 fetch（测试里换成假的）
 */
import { 登记忙 } from "@/lib/swap-guard";

export type 队列状态 = {
  /** 还没传上去的字节 */
  待传字节: number;
  /** 最近的上行速度（字节 / 秒）；还没传过 = null */
  速度: number | null;
  /** 网络跟不上：攒的太多或者速度低于录音码率 */
  慢: boolean;
  /** 正在重试（上一片没传上去） */
  重试中: boolean;
  /** 服务器明说不行（没权限、开关关了……）：停了 */
  错: string | null;
  /** 调用方叫停了（取消、放弃） */
  停了: boolean;
};

export type 片队列 = {
  /** 录音编号到了（开始 / 接着录接口回来） */
  给编号: (id: string) => void;
  放: (段: number, 片: number, 数据: Blob) => void;
  /** 等全部传上去：传完 true；超时（还在重试）false；出错 false */
  等传完: (最多毫秒: number) => Promise<boolean>;
  /** 不传了（取消、放弃）：没传的扔掉 */
  停: () => void;
  状态: () => 队列状态;
};

const 退避 = [2_000, 5_000, 15_000];
const 等 = (毫秒: number) => new Promise((r) => setTimeout(r, 毫秒));

/**
 * 每秒字节：录音大约的码率（网页录 24kbps ≈ 3KB/秒；飞书安卓 wav 约 32KB/秒），用来判慢。
 * 慢线秒：攒着没传的超过这么多秒的录音 = 慢
 */
export function 建片队列(opt: { 每秒字节: number; 变了?: (s: 队列状态) => void; 慢线秒?: number; 取?: typeof fetch }): 片队列 {
  const 取 = opt.取 ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const 慢线 = opt.每秒字节 * (opt.慢线秒 ?? 20);
  let id: string | null = null;
  let 停了 = false;
  let 在跑 = false;
  let 错: string | null = null;
  let 重试中 = false;
  const 排: { 段: number; 片: number; 数据: Blob }[] = [];
  const 样本: { 字节: number; 毫秒: number }[] = [];
  const 等着的: (() => void)[] = [];

  const 速度 = (): number | null => {
    const 字节 = 样本.reduce((a, x) => a + x.字节, 0);
    const 毫秒 = 样本.reduce((a, x) => a + x.毫秒, 0);
    return 毫秒 > 0 ? (字节 / 毫秒) * 1000 : null;
  };
  const 状态 = (): 队列状态 => {
    const 待传字节 = 排.reduce((a, x) => a + x.数据.size, 0);
    const v = 速度();
    // 停了、被服务器拒了（错）就不再算慢：剩下的片不会再传，「网络较慢」那句跟着收掉（11-22 实操：补段被拒后那句一直挂着）
    const 慢 = !错 && !停了 && (待传字节 > 慢线 || (v !== null && v < opt.每秒字节 * 1.2 && 待传字节 > opt.每秒字节 * 5));
    return { 待传字节, 速度: v, 慢, 重试中, 错, 停了 };
  };
  // 队列里还有没传上去的片（含重试间隔里没有请求在路上的时候）算忙，不能静默换版；传完 / 停了 / 服务器拒了就放
  let 放忙: (() => void) | null = null;
  const 对忙 = () => {
    const 该忙 = 排.length > 0 && !停了 && !错;
    if (该忙 && !放忙) 放忙 = 登记忙("录音上传");
    else if (!该忙 && 放忙) { 放忙(); 放忙 = null; }
  };
  const 报 = () => { 对忙(); opt.变了?.(状态()); };
  const 叫醒 = () => { while (等着的.length) 等着的.shift()!(); };

  const 跑 = async () => {
    if (在跑 || 停了 || !id) return;
    在跑 = true;
    try {
      while (排.length && !停了 && !错) {
        const x = 排[0];
        let 次 = 0;
        for (;;) {
          if (停了) return;
          const 起 = performance.now();
          const r = await 取(`/api/coach-rec/${id}/chunk/${x.段}/${x.片}`, { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/octet-stream" }, body: x.数据 }).catch(() => null);
          if (r?.ok) {
            样本.push({ 字节: x.数据.size, 毫秒: Math.max(1, performance.now() - 起) });
            while (样本.length > 5) 样本.shift();
            break;
          }
          if (r && r.status !== 408 && r.status !== 429 && r.status < 500) {
            const 体 = (await r.json().catch(() => ({}))) as { error?: unknown };
            错 = typeof 体.error === "string" ? 体.error : "没传上去";
            重试中 = false;
            报();
            return;
          }
          重试中 = true;
          报();
          const 秒 = r?.status === 429 ? Number(r.headers.get("retry-after") ?? 3) || 3 : 0;
          await 等(秒 ? 秒 * 1000 : 退避[Math.min(次, 退避.length - 1)]);
          次 += 1;
        }
        排.shift();
        重试中 = false;
        报();
      }
    } finally {
      在跑 = false;
      叫醒();
    }
  };

  return {
    给编号(x) { id = x; void 跑(); },
    放(段, 片, 数据) {
      if (停了 || 数据.size === 0) return;
      排.push({ 段, 片, 数据 });
      报();
      void 跑();
    },
    async 等传完(最多毫秒) {
      const 止 = Date.now() + 最多毫秒;
      while (!停了 && !错 && (排.length || 在跑)) {
        if (Date.now() >= 止) return false;
        await Promise.race([new Promise<void>((r) => 等着的.push(r)), 等(Math.min(1_000, Math.max(1, 止 - Date.now())))]);
        void 跑();
      }
      return !错 && !停了;
    },
    停() { 停了 = true; 排.length = 0; 叫醒(); 报(); },
    状态,
  };
}

/** 「网络较慢」那一句：攒着多少秒没传、按现在的速度大概还要多久 */
export function 慢话(s: 队列状态, 每秒字节: number): string | null {
  if (!s.慢 && !s.重试中) return null;
  const 攒秒 = Math.round(s.待传字节 / Math.max(1, 每秒字节));
  if (s.重试中) return `网络断了，还有约 ${攒秒} 秒的录音没传上去，联网后自动补传，先别关页面`;
  const 还要 = s.速度 ? Math.ceil(s.待传字节 / s.速度) : null;
  return `网络较慢：还有约 ${攒秒} 秒的录音没传上去${还要 !== null && 还要 >= 5 ? `（大约还要 ${还要 >= 60 ? `${Math.ceil(还要 / 60)} 分钟` : `${还要} 秒`}）` : ""}，先别关页面`;
}

/** 传文件（PR2 的传录音文件框）按速度估还要多久：超过 3 分钟提示连 Wi-Fi（PR4 审查：上行太慢给前端提示） */
export function 传文件慢话(剩字节: number, 速度: number | null): string | null {
  if (!速度 || 剩字节 <= 0) return null;
  const 秒 = 剩字节 / 速度;
  if (秒 < 180) return null;
  const 速 = 速度 >= 1024 * 1024 ? `${(速度 / 1024 / 1024).toFixed(1)}MB/秒` : `${Math.max(1, Math.round(速度 / 1024))}KB/秒`;
  return `网络较慢（约 ${速}），传完大约还要 ${Math.ceil(秒 / 60)} 分钟，建议连 Wi-Fi；可以先去忙，别关这个页面`;
}
