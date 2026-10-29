"use client";

import { useBusiness } from "@/lib/business-client";
import { 签约叫 } from "@/lib/business-config";
import { useOptimistic, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Segmented, Select, Tabs } from "antd";
import { PageHead } from "@/components/ui";
import { 视图们, type 视图 } from "./views";
import { 读页签, type 复盘页签 } from "@/lib/project/board-todos";

/**
 * 「数据」页的壳：标题 + 三视图切换；企业版按项目时是「复盘」页：人员选择 + 「待办 | 数据」两个页签（P15）。
 *
 * **这儿原来还有一个「问一个数」的输入框**（reports/AskData），2026-09-19 撤掉。
 * 0.38 之后右边那条 AI 面板在每一页都常驻着，这一页于是同屏摆了两个长得一样的框：
 * 正文那个只问数字、出图表，面板那个是完整的 agent。
 * 两件事确实不同，但**人分不出来**——只会以为这一页坏了一个，或者不知道该用哪个。
 * 少一个框不丢任何能力：数字类问题面板照样答（走的是同一条 query_metric）。
 *
 * 连带 AskData.tsx / AskDataResult.tsx 一起删了。服务端那半（`mode: "home"` / `mode: "quick"`
 * 两条分支、dashboard/ask.ts 的 askHome 与 quickBrief、reports/ask.ts 的 askData）
 * 2026-09-19 一并扫掉——首页的 /prep 和 /recap 早就改成给 agent 的一句话了。
 */
export default function DataShell({
  view,
  项目 = false,
  选人,
  页签,
  children,
}: {
  view: 视图;
  /** 企业版只用项目：数的是项目的三大阶段，不是签约 */
  项目?: boolean;
  /** 企业版管理层看谁（P15，lib/project/board-member.ts）：当前 "" = 全部成员；不给 = 不摆下拉（业务员只看自己） */
  选人?: { 选项: { value: string; label: string }[]; 当前: string };
  /**
   * 企业版复盘页的两个页签（P15，10-29 用户定）：「待办」（默认）｜「数据」，记在地址栏 tab=。
   * 不给 = 没有页签（不按项目的老「数据」页），三视图切换照旧摆在最上面
   */
  页签?: 复盘页签;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const b = useBusiness();
  // 页签、人点了先亮起来（乐观），服务端那一屏回来之前旧内容淡一点，不挪位置
  const [切着, start] = useTransition();
  const [显签, set显签] = useOptimistic(页签);
  const [显人, set显人] = useOptimistic(选人?.当前 ?? "");

  /** 在当前地址上改几个参数：页签、人、视图都保留另外几样（看着某个人切到「数据」还是那个人，回到「待办」筛选还在） */
  const 改 = (k: Record<string, string | undefined>, 换 = false) => {
    const q = new URLSearchParams(sp.toString());
    for (const [key, v] of Object.entries(k)) {
      if (v) q.set(key, v);
      else q.delete(key);
    }
    const t = q.toString();
    const url = `/overview${t ? `?${t}` : ""}`;
    start(() => {
      if (k.tab) set显签(读页签(k.tab));
      if ("ownerId" in k) set显人(k.ownerId ?? "");
      if (换) router.replace(url, { scroll: false });
      else router.push(url, { scroll: false });
    });
  };
  const 视图条 = (
    <div className="data-shell-bar">
      <Segmented value={view} onChange={(v) => 改({ view: String(v) })} options={[...视图们]} />
      {/* 没页签时（不按项目），选人还跟在视图后面 */}
      {!页签 && 选人 && 人下拉()}
    </div>
  );
  function 人下拉() {
    return (
      <Select
        className="data-shell-who"
        aria-label="看谁的"
        value={显人}
        // 换了人，待办从第一页看起
        onChange={(v: string) => 改({ ownerId: v || undefined, p: undefined })}
        showSearch
        optionFilterProp="label"
        popupMatchSelectWidth={false}
        options={[{ value: "", label: "全部成员" }, ...(选人?.选项 ?? [])]}
      />
    );
  }

  return (
    <>
      <PageHead title={项目 ? "复盘" : "数据"} subtitle={项目 ? "项目现状与复盘" : `业务现状与${签约叫(b)}复盘`} />
      {页签 ? (
        <>
          {/* 人员选择器在页签上面：两个页签共用，切页签不丢 */}
          {选人 && <div className="data-shell-bar data-shell-bar-who">{人下拉()}</div>}
          <Tabs
            className="data-shell-tabs"
            activeKey={显签}
            // 「待办」也明写 tab=todo：地址栏里留着 view= 时，不写会被当成要看数（读页签）
            onChange={(k) => 改({ tab: k === "data" ? "data" : "todo" })}
            // 内容在下面由服务端给，Tabs 只当导航；面板不滑（crm-motion-rules：减弱动态不许位移），下划线的移动在 globals.css 里按减弱动态关掉
            animated={{ inkBar: true, tabPane: false }}
            items={[
              { key: "todo", label: "待办" },
              { key: "data", label: "数据" },
            ]}
          />
          <div className={`data-shell-body${切着 ? " data-shell-pending" : ""}`} aria-busy={切着 || undefined}>
            {/* 乐观切过去、服务端那一屏还没回来时，旧内容留在原地淡一点（不清空，下面不塌一截再撑开） */}
            {页签 === "data" && 视图条}
            {children}
          </div>
        </>
      ) : (
        <>
          {/* 三视图切换在页头下面、内容上面，靠左（设计稿 08/DATA·NOW）。
              它不是页头上的一个动作，它是「下面这一屏说的是哪一段时间」——
              放在右上角时，人看完标题往下走，会先撞上数字再回头找它 */}
          {视图条}
          {children}
        </>
      )}
    </>
  );
}
