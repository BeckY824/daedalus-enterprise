"use client";

/**
 * 客户详情「上一条 / 下一条」（E-332）：「← 回到客户列表」那一行右端两颗箭头，顺序和进来前那张客户列表一样（筛选、排序、页签、范围、跨页）。
 *   - 只认从客户列表点进来的（和按箭头换过来的、刷新 / 后退回来的），判定在 lib/list-return.ts 定详情来源；别处进来不摆
 *   - 相邻两位由服务端按列表同一份查询算（GET /api/customers/adjacent → adjacent.ts，可见范围走限定层），这里只拿 id；
 *     用 GET 不用服务端动作：动作排队串行，相邻没回来之前详情页的保存、记一笔都得排在它后面；换人 / 离开时 abort 上一次
 *   - 到头那颗灰着；进来第一次算出来之前不摆（这一行固定 24 高，箭头冒出来不推版面）
 *   - 连点不丢（E-332 实操）：游标（目标客户 + 它的相邻）放在模块里、不随详情页换人重挂而丢；两颗箭头始终在原位（同一个元素，
 *     相邻没回来时不灰、点了排队），点一下游标就往目标那位走一步、地址立刻换过去（router.replace，后一次顶掉前一次），
 *     相邻没回来的先排队，回来了按序继续——连点 5 次就到第 6 位。取相邻的 AbortController 只在被新的取代时取消旧的，只认最后一次结果；
 *     反方向那颗立刻可点：从 A 按「下一条」过来，「上一条」就是 A。旧内容仍留到新内容就绪（Next 过渡，不出空白 / 骨架 / 转圈）
 *   - 只有确定这一位没有列表上下文（直接开链接等）才收起
 *   - 地址上 page=999 这类越界页：接口回这一位所在的钳过的页，来源地址和记的列表地址一起改成它，「回到客户列表（第 N 页）」的字和链接都用钳过的页
 *   - 服务端出错：收起，console.warn 一行（客户 id + 状态码，不带客户名）；abort 的不报
 *   - 换人用 replace：浏览器后退 / 手机返回手势直接回列表，列表照旧还原筛选、排序和滚动位置（components/ListReturn.tsx）
 *   - 游标的收尾（审查 A1 / A2）：目标那位到站，路径收成只剩它——之后不是按箭头进来的（直接链接、搜索、所属客户）一律按当前这位重算；
 *     排着的点击只在游标属于当前这位（路径里有它、来源列表地址和记的对得上、还是同一个登录人）时才接着走；
 *     最后一个详情卸掉（离开详情、退出登录）就整个收起（abort 在途请求、排队作废）；换了登录人，游标作废
 *   - 跳转用壳里那份 useShellNavGo：详情换人这个组件会重挂，连点途中有一位到站时顶上的等待条不提前灭
 * 由客户详情页（page.tsx）画好当 换人箭头 递给 RecordView，RecordView 不直接引服务端动作
 */
import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DownOutlined, UpOutlined } from "@ant-design/icons";
import { LinkPending } from "@/components/NavProgress";
import { useShellNavGo } from "@/lib/nav-pending";
import { 地址快照, 定详情来源, 解析地址们, 记地址, 记详情来源, 读详情来源, 清详情来源, 进来的前一页, 列表主人, 页码of, type 详情来源 } from "@/lib/list-return";
import type { 相邻, 相邻一位 } from "./adjacent";

type 方向 = "上" | "下";
/**
 * 游标：目标 = 点到哪位了（地址已换过去、内容可能还在路上）；邻 的某一边 undefined = 还没算出来，null = 到头；
 * 路径 = 上次到站那位 + 之后按箭头发出去、还没到站的那几位（目标到站就收成只剩它）；主人 = 开这个游标时登录的是谁
 */
type 游标 = { 目标: string; 来源: 详情来源; 邻: { 上?: 相邻一位 | null; 下?: 相邻一位 | null }; 待: 方向[]; 路径: Set<string>; 主人: string };

// 游标放模块里：详情页换人时这个组件会重挂，放 state 里按钮会消失到新结果回来
let 游: 游标 | null = null;
let 停: AbortController | null = null;
let 导航: ((id: string) => void) | null = null;
/** 挂着几个 CustomerStep：换人重挂时旧的卸、新的挂在同一次提交里，落到 0 才是真离开了详情 */
let 挂着 = 0;
const 听 = new Set<() => void>();
const 通知 = () => 听.forEach((f) => f());
const 订阅 = (f: () => void) => (听.add(f), () => void 听.delete(f));
const 快照 = () => 游;
const 服务端快照 = () => null;

function 收起() {
  停?.abort();
  停 = null;
  游 = null;
  通知();
}

/** 游标属于 id 这位：路径里有它、来源列表地址和记的对得上、还是开游标的那个登录人 */
function 属于(id: string): boolean {
  return !!游 && 游.路径.has(id) && 游.主人 === 列表主人() && 游.来源.href === 读详情来源()?.href;
}

/** 取目标那位的相邻；新的取代旧的（旧的 abort），只认最后一次结果 */
function 取(id: string, 来源: 详情来源) {
  停?.abort();
  const c = (停 = new AbortController());
  const 参 = new URLSearchParams({ id, href: 来源.href, page: String(来源.位[id] ?? 1) });
  const 报错 = (status: number | string) => {
    console.warn(`[客户上一条/下一条] 取相邻客户失败 customerId=${id} status=${status}`);
    收起();
  };
  fetch(`/api/customers/adjacent?${参}`, { signal: c.signal, cache: "no-store" })
    .then(async (r) => {
      if (c.signal.aborted) return;
      if (!r.ok) return 报错(r.status);
      const 邻 = (await r.json()) as (相邻 & { 页?: number }) | null;
      if (c.signal.aborted || !游 || 游.目标 !== id) return;
      // 这一位不在那一页里（数据变了）：当不是从列表进来的，不摆
      if (!邻) return 收起();
      let 新来源 = 游.来源;
      // 地址上的页码越界（page=999）：列表摆的是末页，来源地址和记的列表地址一起钳过去，返回列表的字和链接才对得上
      if (邻.页 && 新来源.位[id] === 页码of(新来源.href) && 邻.页 < 页码of(新来源.href)) {
        const [路, 串 = ""] = 新来源.href.split("?");
        const q = new URLSearchParams(串);
        if (邻.页 > 1) q.set("page", String(邻.页));
        else q.delete("page");
        新来源 = { href: q.size ? `${路}?${q}` : 路, 位: { ...新来源.位, [id]: 邻.页 } };
        记详情来源(新来源);
        记地址("客户", 新来源.href);
      }
      游 = { ...游, 来源: 新来源, 邻: { 上: 邻.上, 下: 邻.下 } };
      通知();
      消化();
    })
    .catch((e: unknown) => {
      if (c.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
      报错("网络");
    });
}

/** 往 方向 走一步：游标移到那位、地址换过去（后一次顶掉前一次）、取那位的相邻；反方向那边现成就是来的那位 */
function 进(d: 方向) {
  if (!游) return;
  const 到 = 游.邻[d];
  if (!到) return;
  const 回: 相邻一位 = { id: 游.目标, page: 游.来源.位[游.目标] ?? 1 };
  const 来源: 详情来源 = { href: 游.来源.href, 位: { ...游.来源.位, [到.id]: 到.page } };
  记详情来源(来源);
  游 = { ...游, 目标: 到.id, 来源, 邻: d === "下" ? { 上: 回 } : { 下: 回 }, 路径: new Set(游.路径).add(到.id) };
  通知();
  导航?.(到.id);
  取(到.id, 来源);
}

/** 排着的点击按序走：这一步要的那边还没算出来就等下一次结果 */
function 消化() {
  // 换了登录人：上一个人排着的不替下一个人走
  if (游 && 游.主人 !== 列表主人()) return 收起();
  while (游 && 导航 && 游.待.length) {
    const d = 游.待[0];
    if (游.邻[d] === undefined) return;
    游.待.shift();
    进(d);
  }
}

function 点(d: 方向) {
  if (!游 || 游.邻[d] === null) return;
  // 前面有排着的、或这一边还没算出来：排在后面，别插队
  if (游.待.length || 游.邻[d] === undefined) 游.待.push(d);
  else 进(d);
  通知();
}

export default function CustomerStep({ customerId }: { customerId: string }) {
  const pathname = usePathname() ?? "";
  const 去页 = useShellNavGo();
  const 态 = useSyncExternalStore(订阅, 快照, 服务端快照);

  useEffect(() => {
    挂着 += 1;
    return () => {
      挂着 -= 1;
      // 换人重挂时新的那个在同一次提交里接上；微任务里还是 0 = 离开了详情（回列表、左栏、退出登录）：在途请求和排着的点击都作废
      queueMicrotask(() => {
        if (挂着 === 0) 收起();
      });
    };
  }, []);

  useEffect(() => {
    const f = (id: string) => 去页.replace(`/customers/${encodeURIComponent(id)}`);
    导航 = f;
    return () => {
      if (导航 === f) 导航 = null;
    };
  }, [去页]);

  useEffect(() => {
    const 前 = 进来的前一页(pathname);
    // 按箭头发出去的那几位到站（前一页是详情、不是后退刷新、游标属于这位）：游标已经在这位或更前面，别重置，排着的接着走
    if (游 && 属于(customerId) && !!前.从 && /^\/customers\/[^/]+$/.test(前.从) && !前.刷新或后退) {
      // 目标到站：路径收成只剩它，之后从这里点普通链接回到路过的某位，就按那位重算（A1）
      if (游.目标 === customerId) 游.路径 = new Set([customerId]);
      消化();
      return;
    }
    const 来源 = 定详情来源(customerId, 前, 读详情来源(), 解析地址们(地址快照()));
    if (!来源) {
      // 确定这一位没有列表上下文：收起（上一位留下的也不留）
      清详情来源();
      收起();
      return;
    }
    记详情来源(来源);
    游 = { 目标: customerId, 来源, 邻: {}, 待: [], 路径: new Set([customerId]), 主人: 列表主人() };
    通知();
    取(customerId, 来源);
  }, [customerId, pathname]);

  if (!态) return null;
  const 一颗 = (d: 方向) => {
    const 到 = 态.邻[d];
    const 名 = d === "上" ? "上一条" : "下一条";
    const testid = d === "上" ? "rec-step-prev" : "rec-step-next";
    const 图 = d === "上" ? <UpOutlined aria-hidden /> : <DownOutlined aria-hidden />;
    if (到 === null) {
      const 话 = d === "上" ? "已是第一条" : "已是最后一条";
      return <button type="button" className="rec-step-b" disabled aria-label={话} title={话} data-testid={testid}>{图}</button>;
    }
    return (
      <Link
        href={`/customers/${encodeURIComponent((到 ?? { id: 态.目标 }).id)}`}
        replace
        className="rec-step-b"
        aria-label={到 ? `${名}客户` : `正在找${名}`}
        aria-busy={到 ? undefined : "true"}
        title={到 ? 名 : `正在找${名}`}
        data-testid={testid}
        onClick={(e) => {
          // 带修饰键（新窗口打开等）走浏览器默认——相邻还没回来时 href 是当前这位，不开（A4）；普通点击自己走游标，连点才按目标往后算
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return void (!到 && e.preventDefault());
          e.preventDefault();
          点(d);
        }}
        // 中键新开一页：相邻还没回来时同上，不开当前这位
        onAuxClick={(e) => void (!到 && e.preventDefault())}
      >
        {图}
        <LinkPending />
      </Link>
    );
  };
  return (
    <nav className="rec-step" aria-label="按列表顺序换客户" data-testid="rec-step">
      {一颗("上")}
      {一颗("下")}
    </nav>
  );
}
