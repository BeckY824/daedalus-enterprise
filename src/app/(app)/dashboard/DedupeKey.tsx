"use client";
/**
 * 企业版项目模式首页对话框里的「查重」键（10-29 首页改版 待 1：背调、查重、附件分开放）：
 * 点开一个小框，选号码类型、填号码，全公司查一遍，回一句和建档向导同一套的提示。
 * 只查不写：和向导第一步那颗「查重」同一个服务端动作（customers/number-actions.ts 查号码），
 * 格式规矩在 lib/enterprise/contact-format.ts，撞到谁照向导那样点得进去
 */
import { useImperativeHandle, useState } from "react";
import Link from "next/link";
import { LinkPending } from "@/components/NavProgress";
import { Alert, Button, Input, Popover, Select, Space, type PopoverProps } from "antd";
import { FileSearchOutlined } from "@ant-design/icons";
import { 查号码, type 查号码结果 } from "../customers/number-actions";
import RescueKey from "../customers/RescueKey";
import DedupeClaimKey from "../customers/DedupeClaimKey";
import RepeatInquiryKey from "../customers/RepeatInquiryKey";
import { 向导能选类型, 号码类型叫法, 查重提示, type 号码类型 } from "@/lib/enterprise/contact-format";
import { 自己退回公海提示 } from "@/lib/enterprise/pool-rules";
import { 动作出错话 } from "@/lib/stale-deploy";

/** 小框放不下：能翻就翻，左右放不下就整块挪进屏（放外面，每次渲染同一个对象） */
const 挪进屏 = { adjustX: 1, adjustY: 1, shiftX: true } as Exclude<PopoverProps["autoAdjustOverflow"], boolean | undefined>;

/** 不跟着「正在回答」变灰：查号码不碰这一轮对话，边等回答边查是常事 */
export default function DedupeKey({ 宽, 藏键 = false, 开: 开ref }: {
  宽: boolean;
  /** 不摆自己的键（收进「+」菜单，P15）：小框挂在一个看不见的锚上（紧挨着「+」），由 开 打开 */
  藏键?: boolean;
  开?: React.Ref<{ 打开: () => void }>;
}) {
  const [开, set开] = useState(false);
  const [类型, set类型] = useState<号码类型>("手机号");
  const [号, set号] = useState("");
  const [查中, set查中] = useState(false);
  /** 查回来的那句；改了类型或号码就清掉，免得旧结论挂在新号码底下 */
  const [结果, set结果] = useState<查号码结果 | null>(null);
  useImperativeHandle(开ref, () => ({ 打开: () => set开(true) }), []);

  async function 查() {
    const 值 = 号.trim();
    if (!值 || 查中) return;
    set查中(true);
    try {
      set结果(await 查号码(类型, 值));
    } catch (出错) {
      // g.save：没查成就写在框里结果那一格，不弹顶部提示
      set结果({ ok: false, 状态: "没查成", 提示: 动作出错话(出错, "查重没查成，请稍后再试") });
    } finally {
      set查中(false);
    }
  }

  const 框 = (
    <div className="home-dedupe">
      <Space.Compact style={{ width: "100%" }}>
        <Select
          style={{ width: 130, flexShrink: 0 }}
          value={类型}
          aria-label="号码类型"
          options={向导能选类型.map((t) => ({ value: t, label: 号码类型叫法(t) }))}
          onChange={(v) => {
            set类型(v);
            set结果(null);
          }}
        />
        <Input
          value={号}
          autoFocus
          placeholder="填号码，看有没有人录过"
          aria-label="要查的号码"
          onChange={(e) => {
            set号(e.target.value);
            set结果(null);
          }}
          onPressEnter={() => void 查()}
        />
        <Button type="primary" loading={查中} disabled={!号.trim()} onClick={() => void 查()}>查</Button>
      </Space.Compact>
      {结果 && (
        结果.ok && 结果.状态 === "首次录入" ? <Alert type="success" showIcon title={结果.提示} description={结果.归属地 ? `归属地：${结果.归属地}` : undefined} />
        : !结果.ok ? <Alert type="warning" showIcon title={结果.提示} />
        : (
          <Alert
            type="error"
            showIcon
            title={结果.原负责人是我 ? "在公海" : 结果.提示}
            description={结果.状态 === "回收站里有" ? <RescueKey 类型={类型} 值={结果.值} 捞回了={set结果} />
              // 市场成员撞上公海（F-016）：就地领取并记沟通，领了自动分给销售
              : 结果.市场可领 ? <>{结果.在推个数 != null && <div>{查重提示.在推个数(结果.在推个数)}</div>}<DedupeClaimKey 类型={类型} 值={结果.值} 客户id={结果.撞?.id} /></>
              : 结果.撞?.id || 结果.归属地 || 结果.出口C || 结果.在推个数 != null ? (
              <span>
                {/* 自己退回公海的（11-03 B7-3，和向导同一口径）：点进去是「没有找到」，不给链接，名字只摆文字，后面说原因 */}
                {结果.撞?.id && 结果.原负责人是我 && <><span>{结果.撞.name}</span>{结果.撞.school ? ` · ${结果.撞.school}` : ""} · 在公海 · <span className="home-dedupe-note">{自己退回公海提示}</span></>}
                {结果.撞?.id && !结果.原负责人是我 && <><Link href={`/customers/${结果.撞.id}`} onClick={() => set开(false)}>{结果.撞.name}<LinkPending /></Link>{结果.撞.school ? ` · ${结果.撞.school}` : ""} · 在 {结果.撞.salesOwnerName} 名下</>}
                {/* 市场成员撞上客户：这位客户在推的项目个数（含 0，只给个数；看不到的同事客户也给这一句） */}
                {结果.在推个数 != null && <>{结果.撞?.id ? " · " : ""}{查重提示.在推个数(结果.在推个数)}</>}
                {(结果.撞?.id || 结果.在推个数 != null) && 结果.归属地 ? " · " : ""}
                {结果.归属地 ? `归属地：${结果.归属地}` : ""}
                {/* 重复咨询第一步（出口 C）：市场成员撞上同事名下的客户，在负责人名下新建线索 */}
                {结果.出口C && <span className="home-dedupe-act"><RepeatInquiryKey 类型={类型} 值={结果.值} 负责人名={结果.出口C.负责人名} 交销售={!!结果.出口C.交销售} /></span>}
              </span>
            ) : undefined}
          />
        )
      )}
    </div>
  );

  return (
    // 手机宽（11-22 实操 390 宽右边伸出视口约 26px）：放不下就整块往左挪进屏（shiftX），外框右边留一点页边见 globals.css .home-dedupe-pop
    <Popover content={框} trigger="click" placement="topLeft" open={开} onOpenChange={set开} autoAdjustOverflow={挪进屏} classNames={{ root: "home-dedupe-pop" }}>
      {藏键 ? <span className="cli-anchor" aria-hidden="true" /> : <button
        type="button"
        className={`cli-tool${宽 ? " cli-tool-t" : ""}${开 ? " cli-tool-on" : ""}`}
        aria-label="查重"
        aria-expanded={开}
        title="查一个号码全公司有没有人录过（手机号、邮箱、微信、阿里国际站ID），只查不写"
      >
        <FileSearchOutlined />
        {宽 && <span>查重</span>}
      </button>}
    </Popover>
  );
}
