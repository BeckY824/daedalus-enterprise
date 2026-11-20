/**
 * 飞书发消息的进程内队列（11-21 批次 33 批 1 · B01）。
 *
 * c2 上 16% 的飞书提醒发失败，全是限流：09:00 跟进到期扫描、超时转首扫一下子几十上百条同时发。改成排队发：
 * - 本进程每秒最多 每秒 条：两条开始发送之间至少隔 1000/每秒 毫秒（任何一个 1 秒窗口里最多 每秒 条）
 * - 同一收件人两条之间至少隔 同人间隔毫秒（默认 1 秒）
 * - 按先后出队（notice-kinds.ts 推送先后）：数小的先出，同先后按入队顺序；收件人还没到间隔的先跳过、让给下一条
 * - 积压上限：排了超过 积压上限毫秒 还没轮到的不发了，交给 过期()（记失败）。上限 < 「收拾卡住的推送」的 10 分钟，
 *   不然还排着的行会被收拾记成失败、之后又发出去
 * - 仍旧不重试、不补发（M-公海-33）：每条只调一次 跑()，跑() 自己吞错
 *
 * 发送本身并发（不等上一条回来再排下一条），只卡「开始发送」的时刻。纯调度，不碰库、不碰飞书；时钟和睡眠可换（测试用虚拟时钟）。
 */

export type 排队条 = {
  /** 收件人（open_id），同人间隔按它算 */
  收件人: string;
  /** 数小的先出 */
  先后: number;
  /** 轮到了：发这一条。从不抛（抛了也只当它做完了） */
  跑: () => Promise<void>;
  /** 排太久没轮到：不发，记一笔。从不抛 */
  过期: () => Promise<void>;
};

export type 队列设置 = {
  每秒: number;
  同人间隔毫秒: number;
  积压上限毫秒: number;
  现在: () => number;
  睡: (毫秒: number) => Promise<void>;
  /** 测试用：每条开始发送 / 过期时记一笔 */
  记?: (x: { 收件人: string; 先后: number; 时刻: number; 过期: boolean; 入队: number }) => void;
};

type 内部条 = 排队条 & { 序: number; 入队: number; 完: () => void };

const 真睡 = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class 推送队列 {
  private 排: 内部条[] = [];
  private 序 = 0;
  private 在泵 = false;
  private 下次全局 = -Infinity;
  private 上次发给 = new Map<string, number>();
  private 在发 = new Set<Promise<void>>();
  readonly 设置: 队列设置;

  constructor(设置: Partial<队列设置> & Pick<队列设置, "每秒">) {
    this.设置 = { 同人间隔毫秒: 1000, 积压上限毫秒: 8 * 60_000, 现在: Date.now, 睡: 真睡, ...设置 };
  }

  get 排着(): number {
    return this.排.length;
  }

  /** 一次入队一批（先全放进去再开始挑，这一批里先后高的先出）。返回的 Promise 在这一批每条都发完或过期后落定，从不 reject */
  入队(们: readonly 排队条[]): Promise<void> {
    if (!们.length) return Promise.resolve();
    const 入队 = this.设置.现在();
    const 等们 = 们.map((x) => new Promise<void>((完) => this.排.push({ ...x, 序: this.序++, 入队, 完 })));
    void this.泵();
    return Promise.all(等们).then(() => {});
  }

  /** 等队列排空、在发的都回来（测试用） */
  async 等空(): Promise<void> {
    while (this.排.length || this.在发.size || this.在泵) {
      if (this.在发.size) await Promise.all([...this.在发]);
      else await new Promise((r) => setTimeout(r, 5));
    }
  }

  /** 测试用：模拟进程退出，排着的全扔掉（不发、不记、等它的 Promise 永远不落定） */
  扔掉(): number {
    const n = this.排.length;
    this.排 = [];
    return n;
  }

  private 间隔() {
    return Math.ceil(1000 / Math.max(1, this.设置.每秒));
  }

  private async 泵(): Promise<void> {
    if (this.在泵) return;
    this.在泵 = true;
    try {
      while (this.排.length) {
        const 现 = this.设置.现在();
        // 排太久的先清掉：不发，记失败
        const 过了 = this.排.filter((x) => 现 - x.入队 > this.设置.积压上限毫秒);
        if (过了.length) {
          this.排 = this.排.filter((x) => !过了.includes(x));
          for (const x of 过了) {
            this.设置.记?.({ 收件人: x.收件人, 先后: x.先后, 时刻: 现, 过期: true, 入队: x.入队 });
            this.后台(x.过期, x.完);
          }
          continue;
        }
        const 全局等 = this.下次全局 - 现;
        if (全局等 > 0) {
          await this.设置.睡(全局等);
          continue;
        }
        let 挑: 内部条 | null = null;
        let 最早可发 = Infinity;
        for (const x of this.排) {
          const 可发 = (this.上次发给.get(x.收件人) ?? -Infinity) + this.设置.同人间隔毫秒;
          if (可发 > 现) {
            最早可发 = Math.min(最早可发, 可发);
            continue;
          }
          if (!挑 || x.先后 < 挑.先后 || (x.先后 === 挑.先后 && x.序 < 挑.序)) 挑 = x;
        }
        if (!挑) {
          await this.设置.睡(Math.max(1, 最早可发 - 现));
          continue;
        }
        this.排.splice(this.排.indexOf(挑), 1);
        this.上次发给.set(挑.收件人, 现);
        this.下次全局 = 现 + this.间隔();
        this.设置.记?.({ 收件人: 挑.收件人, 先后: 挑.先后, 时刻: 现, 过期: false, 入队: 挑.入队 });
        this.后台(挑.跑, 挑.完);
        // 同人间隔的表只留还在间隔里的，别越攒越多
        if (this.上次发给.size > 2000) for (const [k, t] of this.上次发给) if (现 - t >= this.设置.同人间隔毫秒) this.上次发给.delete(k);
      }
    } finally {
      this.在泵 = false;
    }
  }

  private 后台(做: () => Promise<void>, 完: () => void) {
    const p: Promise<void> = Promise.resolve()
      .then(做)
      .catch((e) => console.warn("[飞书推送] 队列里一条出错：", e instanceof Error ? e.message : e))
      .finally(() => {
        this.在发.delete(p);
        完();
      });
    this.在发.add(p);
  }
}

/* ───────────────────────── 每进程的速率 ───────────────────────── */

/**
 * 每个进程每秒最多发几条的默认值。不按进程数折算：09:00 到期扫描、超时扫描这些成批的只在跑钟的那一个进程，
 * 折成 1 条 / 秒太慢；4 个进程同时满载极少，就算满载 4×4 = 16 条 / 秒 ≈ 960 条 / 分钟，
 * 仍在飞书开放平台发消息接口频控以内（按飞书开放平台发消息接口频控：1000 次 / 分钟、50 次 / 秒，
 * 11-20 核过开放平台「发送消息」文档的接口频率限制一栏）
 */
export const 默认每秒 = 4;

const 正整数 = (v: string | undefined): number | null => {
  const n = Number((v ?? "").trim());
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** 本进程每秒最多发几条：ENT_FEISHU_RATE（正整数），没写或写错 = 4 */
export function 本进程每秒(env: Record<string, string | undefined> = process.env): number {
  return 正整数(env.ENT_FEISHU_RATE) ?? 默认每秒;
}
