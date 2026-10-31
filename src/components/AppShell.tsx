"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { 要跟Context } from "./FollowDue";
import { 我Provider } from "@/lib/me-client";
import Link from "next/link";
import { Layout, Avatar, Dropdown, Button, Badge } from "antd";
import {
  SearchOutlined,
  HomeOutlined,
  DashboardOutlined,
  MessageOutlined,
  ShareAltOutlined,
  TeamOutlined,
  ContactsOutlined,
  DollarOutlined,
  ProjectOutlined,
  InteractionOutlined,
  SettingOutlined,
  DeploymentUnitOutlined,
  BellOutlined,
  MenuOutlined,
  LogoutOutlined,
  DownOutlined,
  SwapOutlined,
  CheckOutlined,
  InboxOutlined,
} from "@ant-design/icons";
import type { SessionUser } from "@/lib/auth";
import type { 演示组 } from "@/lib/enterprise/demo-switch";
import type { LoginResult } from "@/app/login/actions";
import { avatarColor, initial, AVATAR_TEXT } from "@/lib/utils";
import Logo from "./Logo";
import UpdateRow from "./UpdateRow";
import WhatsNew from "./WhatsNew";
import AiTasks from "./AiTasks";
import AiDock from "./AiDock";
import AiFab from "./AiFab";
import { 浮标显示 } from "@/lib/enterprise/ai-fab";
import { usePageUnderOverlay } from "@/lib/page-under-overlay";
import { 整页预取, 省流量 } from "@/lib/prefetch-full";
import type { ModelOption } from "@/lib/llm";
import FeedbackButton from "./FeedbackButton";
import FeedbackReplyToast from "./feedback/FeedbackReplyToast";
import { AiMeterBar } from "./AiCost";
import RailResizer from "./RailResizer";
import CommandBar from "./CommandBar";
import Shortcut, { useModifierKey } from "./Shortcut";
import { useBusiness } from "@/lib/business-client";
import { DockOpenContext, useNarrow, usePageOwnsCmdK } from "@/lib/roster";
import { useMotionTheme } from "@/components/MotionTheme";
import { 企业版根目录, 企业版亮项, 企业版页名, type 根目录图 } from "@/lib/enterprise/nav";

const { Header, Content } = Layout;

declare global {
  interface Window {
    /** 壳→页面的一条单向指令：菜单里点了「设置」，由页面自己 push 过去（见 desktop/preload-app.js） */
    desktopNav?: { onGo(cb: (路径: string) => void): () => void; setCustomerLabel?(name: string): Promise<boolean> };
    desktopTeam?: { onChanged(cb: () => void): () => void };
  }
}

type Props = {
  user: SessionUser;
  workspace?: { name: string; multiple: boolean; billing?: boolean };
  /** 左栏「收藏的客户」（lib/favorites.ts）。没收藏过就整栏不出现 */
  收藏?: { id: string; name: string }[];
  /** 导航项右边的数（2026-10-02 照毛玻璃原型）：客户总数、在谈的商机。只给有意义的那几项 */
  计数?: Partial<Record<string, number>>;
  /**
   * 要跟的：我名下逾期 + 今天到期、还没做的计划和待办（lib/reminders-db.ts）。
   * 和桌面端 Dock 上的数是同一个——左栏「跟进」、手机顶栏铃铛都挂它，人在 Dock 上看见 1，打开应用能顺着找到那个 1
   */
  要跟: { 逾期: number; 今天: number };
  /** 跑在桌面端（Electron）里：红黄绿钮嵌在图标栏顶上，系统标题栏不再画 */
  desktop: boolean;
  /**
   * 反馈发到哪儿。托管版和桌面端发到我们云端；自部署的开源版不发请求，
   * 点了直接开 GitHub issues——他的实例不该认识我们的云。
   * 企业版（客户自己服务器上的网页版）两处都不去：none = 不画反馈键和回复提示。
   */
  反馈去向: "cloud" | "github" | "none";
  /** 企业版只用项目（10-26，lib/enterprise/project-only.ts）：没有「商机」入口，「线索」叫「新线索」 */
  企业版项目?: boolean;
  /** 企业版开关（服务端读了传下来）：右侧 AI 面板的回答里不摆「起草转介绍邀请」 */
  企业版?: boolean;
  /** 标签页标题里的产品名。企业版可换成客户自己的（lib/enterprise/brand.ts） */
  产品名?: string;
  /**
   * 中栏，由并行路由槽位 @pane/[[...slug]] 渲染好传进来，连 <aside class="pane"> 一起。
   * 没有中栏的路由那边返回 null，这里什么都不画——壳不该知道哪个模块有中栏。
   */
  pane: React.ReactNode;
  /**
   * 全局 AI 面板要的东西。没配 AI 时是 null——那时整个面板和那枚按钮都不该存在，
   * 而不是点开一个说"先去设置里配 AI"的空壳。
   */
  ai: { models: ModelOption[] } | null;
  /** 演示部署（CRM_DEMO_SWITCH=1）才有：账号菜单里按业务角色列出所有人，点谁就换成谁（lib/enterprise/demo-switch.ts） */
  演示名单?: 演示组[] | null;
  /** 和演示名单一起给：服务端 action（login/demo-actions.ts）从 layout 传进来，客户端组件不直接 import 服务端模块 */
  演示换人?: (userId: string) => Promise<LoginResult>;
  /** 企业版切换视图（M-权限-08）：只有总管理员拿得到，按业务角色分组列人（lib/enterprise/view-as-menu.ts） */
  视图名单?: 演示组[] | null;
  /** 和视图名单一起给：服务端 action（app/(app)/view-as-actions.ts） */
  视图换人?: (userId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  视图退出?: () => Promise<{ ok: true } | { ok: false; error: string }>;
  /** 正在以别人的视图查看：名 = 被看的人；null = 票还在但已失效。有它顶上就挂一条只读提示 */
  正在视图?: { 名: string | null } | null;
  children: React.ReactNode;
};

/**
 * 壳：
 *   左栏 164px —— 全局导航，八个模块 + 底部 AI 任务 / 设置 / 账号。**永远在，永远这八个**
 *   中栏 312px —— **不是默认栏位**。只有「要在同类记录之间连着切」的场景才出现，
 *                 眼下只有学员记录页的窄名单一个。首页、数据、六张列表、设置都没有中栏
 *   右栏       —— 各页正文
 *
 * 「全局导航稳定，局部结构服从任务」是全站唯一那条布局规则（设计稿 03/LAYOUT）：
 *   首页 / 数据 = 导航 + 单一工作画布
 *   列表页      = 导航 + 全宽表格
 *   记录页      = 导航 + 窄名单 + 记录
 *   设置        = 导航 + 设置目录 + 内容（目录在页内，不占中栏）
 *
 * 导航文案就是模块名，不带「管理」二字：那两个字每一项都有，等于每一项都没有。
 * 每个入口都带 aria-label，屏幕阅读器和 e2e 都按这个名字找。
 */
/** 面板常驻要的最小窗口宽度，见 AppShell 里 窄窗 那段 */
const 面板放不下 = "(max-width: 1599px)";

/** 企业版六个根目录的图标（lib/enterprise/nav.ts 只管名字和去处，不碰界面） */
const 根目录图标: Record<根目录图, React.ReactNode> = {
  首页: <HomeOutlined />,
  复盘: <DashboardOutlined />,
  渠道: <DeploymentUnitOutlined />,
  公海: <InboxOutlined />,
  客户: <TeamOutlined />,
  项目: <ProjectOutlined />,
};

export default function AppShell({ user, workspace, 收藏 = [], 计数 = {}, 要跟, desktop, 反馈去向, 企业版项目 = false, 企业版 = false, 产品名 = "Daedalus CRM", pane, ai, 演示名单, 演示换人, 视图名单, 视图换人, 视图退出, 正在视图, children }: Props) {
  const { 曲线, 时长 } = useMotionTheme();
  const b = useBusiness();
  const modifier = useModifierKey();
  const router = useRouter();
  const pathname = usePathname();
  const 页内占着CmdK = usePageOwnsCmdK();
  /** 设置浮层开着时，底下那页（不是地址栏的 /settings）。见 lib/page-under-overlay.ts */
  const 底下那页 = usePageUnderOverlay();
  /**
   * 手机上没有图标栏和中栏：390px 宽的屏幕摆不下三栏。
   * 顶部一条栏 + 一个菜单按钮，正文占满。
   */
  const 小屏 = useNarrow("(max-width: 767px)");
  /**
   * AI 面板开着没有。壳要知道，因为 antd 的响应式断点看的是**视口**，
   * 而面板一开正文就只剩 1440 - 220 - 380 ≈ 840——断点还以为自己有 1440，
   * 于是 xl 的两栏照摆，表格被挤到「推荐人」三个字竖着排。见 globals.css 的 .shell-dock-open。
   *
   * **默认开着**（用户定的：「保持常驻吧，不要点击或者 command J 才能开启」）。
   * 关掉之后记住——那是他这台机器上的选择，不必每次开窗口重来。
   */
  const 存的面板 = useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return localStorage.getItem("dock-open") !== "0";
      } catch {
        return true; // 隐私模式下读不到就用默认（开着）
      }
    },
    // 服务端快照：先按默认（开着）渲染，水合之后再换成这台机器上存的那个。
    // 不能在 effect 里 setState——那是「effect 里同步 setState」，会级联渲染
    () => true,
  );
  /**
   * **放得下才常驻**：窗口不到 1600 宽时面板默认收着，⌘J 照样打得开，手动开合过就听手动的。
   *
   * 2026-09-28 拿 11 段教程的录制脚本对着当前代码重跑查出来的。教程录的时候没登录 AI，画面里没有面板；
   * 登录了的真实用户面板默认常驻，正文只剩「窗口 - 左栏 220 - 面板 380」：
   *   - 1120 宽剩 520：客户表只剩「客户」「公司」两列，档案页塌成一栏
   *   - 1440（应用的默认窗口）剩 840：商机看板只露两列半，拖卡片拖不到右边那几列
   * 常驻是用户定的，所以不是去掉，而是放得下才常驻：1600 起正文还有 1000，看板和表格都摆得开
   * （16 寸 MacBook、外接屏）；13、14 寸笔记本的 1440–1512 默认收着，和教程里的样子一致。
   */
  // 服务端不知道窗口多宽，按多数（笔记本）当窄的、先收着：宽屏水合后展开一次，
  // 好过笔记本上每次先渲染出 380 的面板、再在水合后收回去
  const 窄窗 = useNarrow(面板放不下, true);
  /** 这一次会话里手动开合过。null = 还没动过，听存档的 */
  const [手动, set手动] = useState<boolean | null>(null);
  const 面板开着 = 手动 ?? (窄窗 ? false : 存的面板);
  /** 名单和记录页的断点要知道右边这条面板占了地方（见 lib/roster.ts 的 DockOpenContext） */
  const 面板占着地方 = Boolean(ai) && !小屏 && 面板开着 && 底下那页 !== "/dashboard";
  const 记住面板 = (开: boolean) => {
    set手动(开);
    try {
      localStorage.setItem("dock-open", 开 ? "1" : "0");
    } catch {
      // 存不下就只在这一次会话里生效
    }
  };
  /**
   * 壳里按 ⌘, 或点菜单里的「设置」：**由这边 push**，不是壳去 loadURL。
   * 软导航才命中拦截路由（@modal/(.)settings），设置才是盖在当前页上的那一层——
   * 否则同一个「设置」从菜单进是整页、从账号菜单进是浮层，同一个标签两种样子。
   * 网页版没有这座桥，这个 effect 什么都不做。
   */
  useEffect(() => window.desktopNav?.onGo((路径) => router.push(路径)), [router]);
  useEffect(() => { void window.desktopNav?.setCustomerLabel?.(b.customer).catch(() => {}); }, [b.customer]);
  // 团队同步收到同事的改动（壳 8 秒一轮）：刷新当前页。正在填的表单是客户端状态，refresh 不会冲掉
  useEffect(() => window.desktopTeam?.onChanged(() => router.refresh()), [router]);

  const 要跟数 = 要跟.逾期 + 要跟.今天;
  const 要跟说法 = 要跟数 > 0 ? `要跟 ${要跟数} 条${要跟.逾期 > 0 ? `（逾期 ${要跟.逾期}）` : ""}` : "";
  /*
    这个数一变（在哪儿完成了计划、勾了待办、改了时间——各处都会 router.refresh()，layout 重算），
    就叫桌面端的壳马上再问一次，Dock 上的数跟着变。原来只有计划页会叫，别处处理完 Dock 要等下一分钟。
    首次挂载不叫：壳自己启动后就在问
  */
  const 上次要跟 = useRef<number | null>(null);
  useEffect(() => {
    if (上次要跟.current !== null && 上次要跟.current !== 要跟数) void window.desktopReminders?.刷新();
    上次要跟.current = 要跟数;
  }, [要跟数]);

  type 导航项 = { key: string; icon: React.ReactNode; label: string; 组: "主" | "更多"; 挂要跟?: true };
  const nav = useMemo<导航项[]>(
    () =>
      企业版项目
        ? /*
            企业版项目模式（10-29 客户定稿）：六个根目录，没有「更多」。跟进、新线索、联系人不进左栏，
            路由都留着、⌘K 搜得到；新线索和跟进的入口在项目页页头，红数跟着挂到「项目」上（lib/enterprise/nav.ts）
          */
          企业版根目录(b.customer).map((n) => ({ key: n.key, icon: 根目录图标[n.图], label: n.label, 组: "主" as const, ...(n.挂要跟 ? { 挂要跟: true as const } : {}) }))
        : [
            /*
              2026-10-02 照毛玻璃原型分成两组：上面是每天都点的（首页、客户、商机、跟进、数据，原型的顺序），
              下面「更多」是偶尔去一趟的（线索、联系人、渠道）。一个入口都没少，只是不再八项平铺、一样重。
              沟通、找客做好以后插在商机后面。
            */
            { key: "/dashboard", icon: <HomeOutlined />, label: "首页", 组: "主" },
            { key: "/customers", icon: <TeamOutlined />, label: b.customer, 组: "主" },
            // 企业版只用项目一条线，没有商机（10-26）；/opportunities 一律转到 /projects，左栏这一项 10-28 删了
            // 团队版项目模式开着才有（2026-10-23，D-31）；关着时 /projects 是 404
            ...(b.projectMode ? [{ key: "/projects", icon: <ProjectOutlined />, label: "项目", 组: "主" as const }] : []),
            { key: "/follow-ups", icon: <InteractionOutlined />, label: "跟进", 组: "主", 挂要跟: true },
            { key: "/overview", icon: <DashboardOutlined />, label: "数据", 组: "主" },
            { key: "/leads", icon: <ShareAltOutlined />, label: "线索", 组: "更多" },
            { key: "/contacts", icon: <ContactsOutlined />, label: "联系人", 组: "更多" },
            { key: "/channels", icon: <DeploymentUnitOutlined />, label: "渠道", 组: "更多" },
            ...(workspace?.billing ? [{ key: "/billing", icon: <DollarOutlined />, label: "开通订阅", 组: "更多" as const }] : []),
          ],
    [b.customer, b.projectMode, workspace?.billing, 企业版项目],
  );

  // 选中项取最长匹配前缀，/customers/xxx 也算在客户管理下
  const 少动 = useReducedMotion();
  // 公海是客户页带 pool=1（P7 之前），只看路径分不出来；企业版项目模式才读
  const pool = useSearchParams()?.get("pool") ?? null;
  /**
   * 企业版项目模式右下角的 AI 浮标（定稿 #13 / #14，见 AiFab、lib/enterprise/ai-fab.ts）。
   * 看的是地址栏：设置浮层开着时地址是 /settings，浮标让开，不压在设置上面。
   * 手机上原来没有 AI 面板，浮标点开的就是同一块 AiDock 铺满屏。记的是「在哪一页开的」：
   * 换一页自然就收起，不用「pathname 变了就 setState」的 effect（和 AiDock 里不带上下文的页同一个做法）。
   */
  const [手机开在, set手机开在] = useState<string | null>(null);
  const 手机开着 = 手机开在 === 底下那页;
  /** 这一次是从浮标点开的：面板从右下角长出来，接上刚才点的那个位置；关掉就清 */
  const [从浮标开, set从浮标开] = useState(false);
  const 显示浮标 = 浮标显示(pathname, pool, { 企业版项目, 有AI: Boolean(ai), 面板开着: 小屏 ? 手机开着 : 面板开着 });
  const 开合面板 = (开: boolean) => {
    if (!开) set从浮标开(false);
    记住面板(开);
  };
  const selectedKey = useMemo(() => {
    // 企业版项目模式：不在左栏的新线索、跟进、联系人挂到入口那一项上（lib/enterprise/nav.ts）
    const 企 = 企业版项目 ? 企业版亮项(pathname, pool) : null;
    if (企) return 企;
    const flat = ["/dashboard", "/overview", "/leads", "/customers", "/channels", "/reports", "/contacts", "/opportunities", "/projects", "/pool", "/follow-ups", "/settings", "/billing"];
    // 「我的反馈」不在导航里：哪一项都不亮，亮的是左下角的反馈键（FeedbackButton）
    if (pathname === "/feedback" || pathname.startsWith("/feedback/")) return "";
    return flat.find((k) => pathname === k || pathname.startsWith(k + "/")) ?? "/dashboard";
  }, [pathname, pool, 企业版项目]);
  /*
    网页版点左栏那一下就亮到新的一项上（10-27）：放到云服务器上，新页的数据要等一趟网络，
    地址栏还没换之前 selectedKey 不动，人会以为没点上又点一次。记下点的是哪一项，
    页一换（pathname 变了）就清掉，回到按地址算（渲染时比上一次的地址，React 文档推荐的做法，不走 effect）。
    桌面端在本机，换页本来就是即时的，不动
  */
  const [去向, set去向] = useState<string | null>(null);
  // 企业版的「公海」和「客户」是同一个路径（P7 之前公海 = /customers?pool=1），只比路径的话在两项之间点，去向永远清不掉
  const 地址 = 企业版项目 && pool ? `${pathname}?pool=${pool}` : pathname;
  const [上次地址, set上次地址] = useState(地址);
  if (上次地址 !== 地址) {
    set上次地址(地址);
    set去向(null);
  }
  const 亮项 = 去向 ?? selectedKey;

  /*
    网页版左栏主组几项空闲时整页预热（10-27，lib/prefetch-full）：首页、客户、项目、跟进、数据每天来回切，
    预热过的点下去直接从本地出页，不等服务器。只在页面空下来以后取，不和当前页抢；省流量不取；
    60 秒后过期（staleTimes.static），过期了悬停（unstable_dynamicOnHover）还会再取一次。
    企业版的新线索不在左栏（入口在项目页页头），却是每天的入口，一起预热（10-27 第二轮：没预热时第一次点要 0.6 秒）。
    详情页（客户、项目）没法整页预热——不知道人要点哪一行，行也不许一进视口就取（e2e/row-prefetch）。
    第一次点慢在页面自己的脚本：悬停预取回来才知道要哪几个脚本，再去下一趟，+200ms 往返时要 0.65 秒。
    所以空闲时先把这两页的界面组件 import 进来：打包出来就是同几个脚本文件（Turbopack 按模块分块，
    10-27 对过 client-reference-manifest），点下去只等数据。只下脚本，不碰服务器上的数据
  */
  const 预热页 = useMemo(
    () => [...nav.filter((n) => n.组 === "主").map((n) => n.key), ...(企业版项目 ? ["/leads"] : [])].join(" "),
    [nav, 企业版项目],
  );
  useEffect(() => {
    if (desktop || 省流量()) return;
    const 要 = 预热页.split(" ").filter(Boolean);
    // 当前这页已经在眼前，不用再取
    const 取 = () => {
      要.filter((k) => location.pathname !== k).forEach((k) => 整页预取(router, k));
      void import("@/app/(app)/customers/[id]/RecordView").catch(() => {});
      if (要.includes("/projects")) void import("@/app/(app)/projects/[id]/ProjectDetail").catch(() => {});
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(取, { timeout: 3000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = setTimeout(取, 1200);
    return () => clearTimeout(t);
  }, [desktop, 预热页, router]);

  /*
    网页版的标签页标题跟着当前页走（「客户 · Daedalus CRM」）：浏览器里常开着好几个标签，只写产品名分不出哪个是哪个，
    左栏顶上也不再有标志。桌面端不动：窗口标题跟着 document.title，Windows 任务栏、切窗口时还是产品名。
    不用 selectedKey：它认不出的路径都算首页，/admin 之类会被写成「首页」；认不出的页不碰标题，留给页面自己（如「没有找到这个页面」）
  */
  const 当前页名 = useMemo(() => {
    if (pathname === "/feedback" || pathname.startsWith("/feedback/")) return "我的反馈";
    if (企业版项目) return 企业版页名(pathname, pool, b.customer);
    const 全部 = [...nav, { key: "/settings", label: "设置" }];
    const 中 = 全部.filter((n) => pathname === n.key || pathname.startsWith(n.key + "/")).sort((a, b) => b.key.length - a.key.length)[0];
    return typeof 中?.label === "string" ? 中.label : "";
  }, [nav, pathname, pool, 企业版项目, b.customer]);
  useEffect(() => {
    if (desktop || !当前页名) return;
    const 要 = `${当前页名} · ${产品名}`;
    const 设 = () => {
      if (document.title !== 要) document.title = 要;
    };
    设();
    // Next 的元数据是流式补进 <head> 的，首屏和换页后都会把 <title> 写回根布局的「Daedalus CRM」，只设一次会被盖掉
    const 盯 = new MutationObserver(设);
    盯.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => 盯.disconnect();
  }, [desktop, 当前页名, 产品名]);

  /** 左栏的一项（主导航和「更多」共用）。选中那块底色仍是同一块在各项之间滑（layoutId） */
  const 一项 = (n: (typeof nav)[number]) => (
    <Link
      key={n.key}
      /* 桌面端的「客户」直接进「名单 + 详情」，打开最近看过的那位（照毛玻璃原型）；表格在名单右上角。
         网页团队版照旧进表格：那边要按人分配、批量改，表格是主场。手机菜单也照旧进表格 */
      href={desktop && n.key === "/customers" ? "/customers/recent" : n.key}
      prefetch={desktop && n.key === "/customers" ? false : undefined}
      /* 网页版悬停就整页预取（默认只取到骨架，点进去还要再等一趟数据）。桌面端在本机，照旧。
         next/link 的类型取的是老路由那份，没有这一项；运行时用的是 app 路由的 Link，认这一项 */
      {...(desktop ? {} : { unstable_dynamicOnHover: true })}
      /* 跳转页的结果会被客户端路由缓存住（staleTimes 60 秒）：第二次点会回到上一次跳去的那位，
         不是刚看过的那位。每次带一个新参数，确保回到服务端读 cookie */
      onClick={
        desktop && n.key === "/customers"
          ? (e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey) return;
              e.preventDefault();
              router.push(`/customers/recent?t=${Date.now()}`);
            }
          : desktop
            ? undefined
            : (e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                if (n.key !== selectedKey) set去向(n.key);
              }
      }
      aria-label={n.挂要跟 && 要跟说法 ? `${n.label}，${要跟说法}` : n.label}
      className={`rail-item${亮项 === n.key ? " on" : ""}`}
    >
      {/* 选中那块底色是**同一块**在两项之间滑过去的（layoutId），不是这边灭那边亮。
          切页时眼睛跟着它走，不用重新找自己在哪一项上。
          系统开了「减弱动态效果」就按 0 秒，等于原来的瞬切。 */}
      {亮项 === n.key && (
        <motion.span layoutId="rail-on" className="rail-on-bg" transition={{ duration: 少动 ? 0 : 时长.base, ease: 曲线.ease }} />
      )}
      {n.icon}
      <b>{n.label}</b>
      {/* 和 Dock 上那个红数字同一个数、同一种红：人从 Dock 看见 1，打开应用第一眼就能对上它在哪。
          点进去是记录页，页头「计划」按钮上还挂着同一个数，再点就是逾期和今天那两组 */}
      {n.挂要跟 && 要跟数 > 0 && (
        <span className="rail-count" title={`${要跟说法}${desktop ? "，和应用图标提示一致" : n.key === "/projects" ? "，项目页「跟进」里看逾期和今天" : "，查看跟进计划中的逾期和今天"}`}>{要跟数 > 99 ? "99+" : 要跟数}</span>
      )}
      {/* 灰的数只是「有多少」，不是「要处理」：和上面那个红的分开，红的才催人。企业版不摆（10-30：几千个客户的总数没人看，只占地方） */}
      {!企业版 && (计数[n.key] ?? 0) > 0 && <span className="rail-num">{计数[n.key]}</span>}
    </Link>
  );

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const 我的演示角色 = 演示名单?.find((g) => g.人.some((p) => p.id === user.id))?.名;
  /**
   * 演示换人：换会话 cookie 后整页重载到同一个模块的首页——权限变了，详情页（别人的客户）多半看不了，
   * 软导航也不会重新跑服务端的权限和左栏。
   */
  async function 换成(id: string) {
    if (id === user.id || !演示换人) return;
    const res = await 演示换人(id).catch(() => ({ ok: false as const, error: "换人失败，请检查网络连接后重试" }));
    if (!res.ok) return void window.alert(res.error);
    // 同 login/after-login.ts：换的是会话，整页重来才干净
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/" + (pathname.split("/")[1] || "dashboard"));
  }
  /** 切换视图 / 退出视图：换的是一张票，整页重来，同 换成() */
  async function 看成(id: string) {
    if (!视图换人) return;
    const res = await 视图换人(id).catch(() => ({ ok: false as const, error: "切换失败，请检查网络连接后重试" }));
    if (!res.ok) return void window.alert(res.error);
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/" + (pathname.split("/")[1] || "dashboard"));
  }
  async function 退出看() {
    if (!视图退出) return;
    const res = await 视图退出().catch(() => ({ ok: false as const, error: "退出失败，请检查网络连接后重试" }));
    if (!res.ok) return void window.alert(res.error);
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/" + (pathname.split("/")[1] || "dashboard"));
  }
  const 视图菜单 = 视图名单?.length
    ? [
        { type: "divider" as const },
        {
          key: "view-as",
          icon: <SwapOutlined />,
          label: 正在视图 ? "换一个人的视图" : "切换视图（只读）",
          popupClassName: "demo-switch-pop",
          children: 视图名单.map((g) => ({
            type: "group" as const,
            key: `view-g:${g.角色}`,
            label: g.名,
            children: g.人.map((p) => ({
              key: `view:${p.id}`,
              icon: p.id === user.id ? <CheckOutlined /> : <span className="demo-switch-gap" />,
              disabled: p.id === user.id,
              label: (
                <span className="demo-switch-person">
                  <b>{p.name}</b>
                  {p.说明 && <span>{p.说明}</span>}
                </span>
              ),
            })),
          })),
        },
      ]
    : [];
  /** 切换视图期间钉在顶上的一条：谁的视图、只读、退出。两种布局都挂 */
  const 视图条 = 正在视图 ? (
    <div className="view-as-bar" role="status">
      <span className="view-as-text">
        {正在视图.名 ? (
          <>
            正在以 <b>{正在视图.名}</b> 的视图查看（只读）
          </>
        ) : (
          "切换视图已失效（只读）"
        )}
      </span>
      <span aria-hidden>·</span>
      <button type="button" className="view-as-exit" onClick={() => void 退出看()}>
        退出
      </button>
    </div>
  ) : null;
  const 演示菜单 = 演示名单?.length
    ? [
        { type: "divider" as const },
        {
          key: "demo-switch",
          icon: <SwapOutlined />,
          label: "切换身份（演示）",
          popupClassName: "demo-switch-pop",
          children: 演示名单.map((g) => ({
            type: "group" as const,
            key: `demo-g:${g.角色}`,
            label: g.名,
            children: g.人.map((p) => ({
              key: `demo:${p.id}`,
              icon: p.id === user.id ? <CheckOutlined /> : <span className="demo-switch-gap" />,
              disabled: p.id === user.id,
              label: (
                <span className="demo-switch-person">
                  <b>{p.name}</b>
                  {p.说明 && <span>{p.说明}</span>}
                </span>
              ),
            })),
          })),
        },
      ]
    : [];

  /**
   * 退出登录。桌面端本地模式下它退的是**云端账号**（api/auth/logout 会顺手吊销这台机器的
   * 设备令牌），退完落到的登录页画的就是云端账号那张表单，注册、找回密码都在。
   * 2026-09-17 上午曾把这一条在本机模式下藏起来——因为那时退出之后落到的是一个要
   * 本机随机密码的框。根子是两套身份，不是这个按钮；两套并成一套之后它就该回来。
   */
  /**
   * 账号菜单。**这里只放两样**：我是谁、出去——中间那条是通往设置的门。
   * 参照 Claude / Codex 桌面端那两个菜单，但没把它们那一长串照抄——
   * 语言只有中文、升级套餐我们不卖、更新有自己的按钮，抄过来每一条都是死链。
   * 顶上那块是身份（名字、职位、登录名），不可点：菜单第一件事是告诉你「现在是谁」，
   * 尤其是一台机器上换过账号的时候。
   *
   * **「个人资料」不在这儿了（2026-09-18）**：它是设置里的第一栏，菜单里再摆一条
   * 等于同一个地方开两个门，而且两条只差一个字——点哪条得先想一下。要改名字、改职位，
   * 打开设置，第一栏就是。
   *
   * **每一条走 onClick，不在 label 里塞 `<Link>`。** 塞进去只有那两个字是可点的：
   * 点在图标上、点在右边那片空白上，菜单关掉、什么也没发生——0.34.1 收到的
   * 「点设置完全没反应」就是这个。antd 的 onClick 认的是整行，行有多宽就能点多宽。
   */
  const userMenu = {
    onClick: ({ key }: { key: string }) => {
      if (key.startsWith("demo:")) void 换成(key.slice(5));
      if (key.startsWith("view:")) void 看成(key.slice(5));
      // 软导航才会命中拦截路由（@modal/(.)settings），设置才是盖在当前页上的一层
      if (key === "settings") router.push("/settings");
      if (key === "logout") void logout();
      if (key === "view-exit") void 退出看();
      if (key === "workspaces") router.push("/workspaces");
    },
    items: [
      {
        type: "group" as const,
        label: (
          <div className="rail-menu-me">
            <Avatar size={32} style={{ background: avatarColor(user.name), color: AVATAR_TEXT, fontSize: 13, fontWeight: 600, flex: "none" }}>
              {initial(user.name)}
            </Avatar>
            <div style={{ minWidth: 0 }}>
              <b>{user.name}</b>
              <span>{[我的演示角色, user.title, user.email].filter(Boolean).join(" · ")}</span>
              {workspace && <span>当前工作区：{workspace.name}</span>}
            </div>
          </div>
        ),
      },
      ...(workspace?.multiple ? [{ key: "workspaces", label: "切换工作区" }] : []),
      ...演示菜单,
      ...视图菜单,
      ...(正在视图 ? [{ key: "view-exit", icon: <LogoutOutlined />, label: "退出切换视图" }] : []),
      { type: "divider" as const },
      {
        key: "settings",
        icon: <SettingOutlined />,
        label: (
          <span className="rail-menu-row">
            设置
            {desktop && <kbd><Shortcut>⌘,</Shortcut></kbd>}
          </span>
        ),
      },
      // 「更新记录」挪到左栏「检查更新」上面了（2026-10-04 用户：账号菜单只留设置和退出登录）
      { type: "divider" as const },
      { key: "logout", icon: <LogoutOutlined />, label: "退出登录", danger: true },
    ],
  };

  if (小屏) {
    // 底色走 --page-bg：外观选白底时地面跟着变白（antd 的 bodyBg 是 JS 里写死的色值，读不到外观）
    return (
      <Layout className={显示浮标 ? "has-ai-fab" : undefined} style={{ minHeight: "100vh", background: "var(--page-bg)" }}>
        {视图条}
        <Header style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 12px", borderBottom: "1px solid var(--line-soft)", position: "sticky", top: 0, zIndex: 10, height: 48 }}>
          <Dropdown
            trigger={["click"]}
            menu={{
              /* 整行可点：label 里塞 <Link> 的话，点在图标或右边空白上只会把菜单关掉 */
              items: [...nav.map(({ key, icon, label }) => ({ key, icon, label })), { key: "/settings", icon: <SettingOutlined />, label: "设置" }],
              selectedKeys: [selectedKey],
              onClick: ({ key }) => router.push(key),
            }}
          >
            <Button type="text" icon={<MenuOutlined />} aria-label="打开导航菜单" />
          </Dropdown>
          <Link href="/dashboard" aria-label={产品名} style={{ display: "inline-flex" }}>
            <Logo size={20} />
          </Link>
          <span style={{ flex: 1 }} />
          {/* 手机上也要能说一句：用得别扭的时刻多半就发生在手机上（在路上翻学员的时候） */}
          {反馈去向 !== "none" && <FeedbackButton 去向={反馈去向} />}
          <Badge count={要跟数} size="small" color={要跟.逾期 > 0 ? "var(--danger)" : "var(--text-muted)"}>
            <Button type="text" icon={<BellOutlined />} aria-label={要跟说法 ? `跟进计划，${要跟说法}` : "跟进计划"} onClick={() => router.push("/follow-ups/plans")} />
          </Badge>
          <Dropdown trigger={["click"]} menu={userMenu}>
            <Button type="text" aria-label={`${user.name}，账号菜单`}>
              <Avatar size={24} style={{ background: avatarColor(user.name), color: AVATAR_TEXT }}>{initial(user.name)}</Avatar>
            </Button>
          </Dropdown>
        </Header>
        <Content className="app-content" style={{ padding: "22px 26px" }}>
          <我Provider value={{ id: user.id, name: user.name }}><要跟Context.Provider value={要跟}>{children}</要跟Context.Provider></我Provider>
        </Content>
        {/* 企业版项目模式：手机上也能问一句。点浮标，面板铺满屏（globals.css 的手机 .dock），× 收起 */}
        {ai && 企业版项目 && (
          <AiDock userName={user.name} models={ai.models} 开着={手机开着} set开着={(开) => set手机开在(开 ? 底下那页 : null)} 企业版={企业版} />
        )}
        {显示浮标 && <AiFab onClick={() => set手机开在(底下那页)} />}
      </Layout>
    );
  }

  return (
    <DockOpenContext.Provider value={面板占着地方}>
    <div className={`shell${desktop ? " shell-desktop" : ""}${面板开着 && 底下那页 !== "/dashboard" ? " shell-dock-open" : ""}${显示浮标 ? " has-ai-fab" : ""}${从浮标开 ? " shell-fab-opened" : ""}`}>
      {视图条}
      {/* 桌面端顶上那条能拖窗口的把手，见 globals.css 的 .drag-strip */}
      {desktop && <div className="drag-strip" aria-hidden="true" />}
      <nav className="rail" aria-label="主导航">
        {/* 桌面端：这块是红黄绿钮的位置，也是拖动窗口的把手 */}
        <div className="rail-top">
          {/*
            顶上是一个搜索框（2026-10-02 照毛玻璃原型，学 MonoCode）：名字已经在登录页和红黄绿钮旁的窗口里了，
            这一格留给最常用的「去哪儿 / 找谁」。点它和按 ⌘K 是同一张跳转单（CommandBar 听 cmdbar:open）。
            网页版原来顶上是标志；2026-10-24 企业版网页要和桌面端一个样子，也换成搜索框——
            产品名改由标签页标题（「客户 · Daedalus CRM」，见下面 当前页名）和图标、登录页来认。
          */}
          <button type="button" className="rail-search" onClick={() => window.dispatchEvent(new Event("cmdbar:open"))} aria-label={页内占着CmdK ? "搜索" : `搜索（${modifier}K）`}>
            <SearchOutlined />
            <span>搜索</span>
            {/* 首页的 ⌘K 是「回问答框」、记录页是「换一位」：那两处不写，免得标签和按下去的对不上（lib/roster.ts） */}
            {!页内占着CmdK && <kbd><Shortcut>⌘K</Shortcut></kbd>}
          </button>
        </div>
        {/* 名字直接写出来，不再靠 tooltip：第一次打开的人不会去悬停，
            他只看到一列认不出的方块。aria-label 保留原样，e2e 和读屏都认它。 */}
        <div className="rail-nav">
          {nav.filter((n) => n.组 === "主").map((n) => 一项(n))}
        </div>
        {/* 企业版项目模式六个根目录都在上面，没有「更多」，空的标题不摆 */}
        {nav.some((n) => n.组 === "更多") && (
          <div className="rail-more" aria-label="更多">
            <div className="rail-fav-h">更多</div>
            {nav.filter((n) => n.组 === "更多").map((n) => 一项(n))}
          </div>
        )}
        {收藏.length > 0 && (
          <div className="rail-fav" aria-label="收藏的客户">
            <div className="rail-fav-h">收藏的{b.customer}</div>
            {收藏.map((c) => (
              <Link key={c.id} href={`/customers/${c.id}`} className={`rail-fav-i${pathname === `/customers/${c.id}` ? " on" : ""}`}>
                <span className="rail-fav-av" style={{ background: avatarColor(c.name), color: AVATAR_TEXT }}>
                  {initial(c.name)}
                </span>
                <span className="rail-fav-n">{c.name}</span>
              </Link>
            ))}
          </div>
        )}
        {/* 侧栏底部按设计稿只留三样：AI 任务、设置、账号。
            原来还挂着一条「⌘K 跳转 / 提问」的说明和一个「待办」铃铛——
            快捷键的说明挪到了首页输入框下面（那儿才是用它的地方），
            逾期待办改由首页第一个信号「逾期跟进 N · 先处理」承担：
            那是一个带数字和去处的信号，比一个只有小红点的铃铛准。 */}
        <div className="rail-foot">
          {/* AI 跑完了没有：跑着一条细进度，答完一行字、3 秒自己走。点一条回原处。
              人切去别的应用了则由桌面端发系统通知（desktop/main.js 的 notify:show） */}
          {/* AI 面板收着时的入口。原来是正文右边一条 44px 的窄边，笔记本上每张表都被它挤掉最右一列，
              挪到这里就哪边都不占（见 AiDock 收起时那段）。首页就是对话本身，不用它 */}
          {ai && !小屏 && !面板开着 && 底下那页 !== "/dashboard" && (
            <button type="button" className="rail-item rail-ask" onClick={() => 记住面板(true)} aria-label={`打开 AI 面板（${modifier}J）`}>
              <MessageOutlined />
              <b>问一句</b>
              <span className="rail-ask-k"><Shortcut>⌘J</Shortcut></span>
            </button>
          )}
          <AiTasks />
          <AiMeterBar />
          {/* 检查更新那一行（学 MonoCode 左下角）：常驻，写着当前版本；有新版变蓝、下载有进度、下好了点它重启 */}
          {/* 更新记录在「检查更新」上面（2026-10-04 用户）：一个看「改了什么」，一个管「有没有更新的」。
              只有桌面端有：网页版一直是最新的，没有「从哪一版升上来」这回事 */}
          {desktop && <WhatsNew />}
          {desktop && <UpdateRow />}
          {/* 「设置」不在左栏里了（2026-09-17）：它在账号菜单里，和 Claude / Codex 一样。
              左栏那一列是**你工作的地方**——学员、商机、跟进；设置是偶尔去一趟的抽屉，
              把它摆成和「学员」同级的一项，等于每天提醒你它存在。 */}
          {/* 账号这一行右端留给更新键：有新版才出现，没有就当它不存在，一行都不占。
              它不能嵌在账号按钮里面（按钮套按钮点不动），所以这一行是个 flex 容器，
              左边账号自己撑开、右边那枚圆键跟着。形状照 Codex：名字在左，圆键在右。 */}
          <div className="rail-account">
            {/* 点开，不是悬停。悬停开的菜单会在你只是路过时糊你一脸，
                而且右边那个小箭头说的就是「点我」——两者得是一回事 */}
            <Dropdown placement="topLeft" trigger={["click"]} menu={userMenu}>
              <button type="button" className="rail-user" aria-label={`${user.name}，账号菜单`}>
                <Avatar size={24} style={{ background: avatarColor(user.name), color: AVATAR_TEXT, fontSize: 11, fontWeight: 600, flex: "none" }}>
                  {initial(user.name)}
                </Avatar>
                {/* 名字长了就省略号收尾，不再把整行吃掉；右边那个小箭头是「这儿能点开」的唯一信号——
                    在它之前，这一行和一条静态的署名长得一模一样 */}
                <b>{user.name}</b>
                <DownOutlined className="rail-user-caret" aria-hidden />
              </button>
            </Dropdown>
            {/* 反馈在更新键的右边，两枚都是这一行的「出口」：一个往外拿新版本，一个往外送一句话。
                网页版没有更新键，那儿就只有它一枚；企业版两枚都没有 */}
            {反馈去向 !== "none" && <FeedbackButton 去向={反馈去向} />}
          </div>
        </div>
        {/* 右边那条能拖的缝。它贴着分隔线，平时看不见，指上去才显出来 */}
        <RailResizer />
      </nav>

      {/* ⌘K：跳页或问一句。挂在壳上，哪一页都在 */}
      <CommandBar 有AI={Boolean(ai)} 企业版项目={企业版项目} />
      {/* 我们回了你的反馈、还没看：左下角一条轻提示（一次一条，可关） */}
      {反馈去向 !== "none" && <FeedbackReplyToast 去向={反馈去向} />}


      {/* 中栏：槽位自己带 <aside class="pane">，没有中栏的路由返回 null */}
      {pane}

      {/* antd 的 Content 自己就渲染成 <main>，外面不能再包一层：
          一个文档只能有一个 main，两个会让读屏和测试都认不出正文是哪块 */}
      <main className="main app-content" style={{ padding: "22px 26px" }}>
        {/*
          换页时正文淡进来、抬 6px。**--t（180ms），而且只有正文**——
          左栏和中栏不动，动的只是"这一页的内容换了"这件事本身。
          在这之前换页是硬切：上一页的表格原地变成下一页的表格，人得自己确认屏幕真的换了。

          key 挂在底下那页上：同一页里改筛选、翻页走的是 query，不会重来一遍；
          开设置浮层也不算换页——挂在 pathname 上的话，一开设置底下整页重挂、状态丢掉。
          超宽屏下限制正文宽度并居中，避免表格被拉得过于稀疏。
        */}
        <motion.div
          key={底下那页}
          initial={{ opacity: 0, y: 少动 ? 0 : 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 少动 ? 0 : 时长.base, ease: 曲线.ease }}
          style={{ maxWidth: 1720, margin: "0 auto" }}
        >
          <我Provider value={{ id: user.id, name: user.name }}><要跟Context.Provider value={要跟}>{children}</要跟Context.Provider></我Provider>
        </motion.div>
      </main>
      {/*
        全局 AI 面板（⌘J）。挂在壳上所以切页不断流——正在跑的那一问跟着你走。
        它自己决定首页不出现（首页就是宽模式的同一块东西）。
        手机上不出现：390 宽摆不下正文 + 380 的面板。
      */}
      {ai && !小屏 && <AiDock userName={user.name} models={ai.models} 开着={面板开着} set开着={开合面板} 企业版={企业版} />}
      {/* 面板收着时右下角的入口（企业版项目模式）。面板一开它就让开：两个入口不同时出现，也不压在面板的输入框上 */}
      {显示浮标 && (
        <AiFab
          onClick={() => {
            set从浮标开(true);
            记住面板(true);
          }}
        />
      )}
    </div>
    </DockOpenContext.Provider>
  );
}
