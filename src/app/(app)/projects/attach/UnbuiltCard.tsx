"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Empty, Input, Modal, Popconfirm, Select, Space, Table, Tag, type PopoverProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import { RowLink } from "@/components/ui";
import { dayjs } from "@/lib/utils";
import type { 待补建栏, 待补建行, 我交的待补建, 处理结果 } from "@/lib/enterprise/repeat-unbuilt";
import type { 未建状态 } from "@/lib/enterprise/unbuilt-record";
import { 补建待补建, 不补建待补建 } from "./unbuilt-actions";

/** 同 repeat-unbuilt.ts 待补建栏id（那个文件连库，客户端不引） */
const 栏id = "repeat-unbuilt";
const 原因上限 = 200;
const 时刻 = (d: string | null | undefined) => (d ? dayjs(d).format("YYYY-MM-DD HH:mm") : "");
const 省略 = { ellipsis: true } as const;
/** 一行 + 省略号 + 悬停看全文（企业版全站一行） */
const 一行 = (字: string) => <span className="ls-ub-one" title={字}>{字}</span>;
const 状态签 = (v: 未建状态) => <Tag color={v === "已补建" ? "green" : v === "已关闭" ? "default" : "orange"}>{v}</Tag>;
const 结果字 = (r: 处理结果 | null) => (r ? [r.话, [r.谁, 时刻(r.时间)].filter(Boolean).join(" ")].filter(Boolean).join("；") : "");
/**
 * 处理结果那一格：一行 + 省略号 + 悬停看全文；已补建、看的人进得了那条线索（服务端判了才给 链接）时，「补成线索「名」」里的名字链过去（最终地址）。
 * 没给链接 = 只有字，和原来一样
 */
function 结果格({ r, 空话 }: { r: 处理结果 | null; 空话: string }) {
  const 全 = 结果字(r) || 空话;
  const 头 = r?.线索 ? `补成线索「${r.线索.名}」` : "";
  if (!r?.线索?.链接 || !全.startsWith(头)) return 一行(全);
  return (
    <span className="ls-ub-one" title={全}>
      补成线索「<RowLink href={r.线索.链接} className="ls-ub-lead">{r.线索.名}</RowLink>」{全.slice(头.length)}
    </span>
  );
}
/** 操作列宽：「补建」「不补建」两颗小键 + 格子内边距。钉在右边（1280 宽表格要横滑，键不能藏在可视区外；手机宽也钉，横滑的列更多、键更该在眼前） */
const 操作宽 = 140;
/** 确认浮层放不下：能翻就翻，左右放不下整块挪进屏（同首页查重小框；放外面，每次渲染同一个对象）；挪过去离屏边的那截见 globals.css .ls-ub-pop */
const 挪进屏 = { adjustX: 1, adjustY: 1, shiftX: true } as Exclude<PopoverProps["autoAdjustOverflow"], boolean | undefined>;

/**
 * 「补建」键 + 锚在它上面的确认浮层。原来用就地确认（键自己变成问句 + 两颗键，约 458px 宽），
 * 操作列钉右收到 140 之后被卡内表格容器截掉、要横滑才点得到（3703 实操）；浮层挂在 body 上，不受表格可视区截，列宽平时不变。
 *   - 点外面、点取消、Esc 收起；确认发出去在等结果时确认键转圈，回来收起（没办成的原因照旧写在这一行）
 *   - 键盘点开的（:focus-visible）焦点挪到「取消」（回车再按一下是退出）；焦点在浮层里收起时还给「补建」，不掉回 <body>
 */
function BuildKey({ 做, 禁 }: { 做: () => Promise<unknown>; 禁: boolean }) {
  const [开, set开] = useState(false);
  const 键 = useRef<HTMLButtonElement>(null);
  const 问 = useRef<HTMLSpanElement>(null);
  const 键盘开 = useRef(false);
  const 浮层 = () => 问.current?.closest<HTMLElement>(".ls-ub-pop") ?? null;
  const 换 = (v: boolean) => {
    if (v) 键盘开.current = !!键.current?.matches(":focus-visible");
    else if (浮层()?.contains(document.activeElement)) requestAnimationFrame(() => 键.current?.focus({ preventScroll: true }));
    set开(v);
  };
  useEffect(() => {
    if (!开 || !键盘开.current) return;
    // 浮层内容开的那一下才画进 body，等一帧再找
    const t = requestAnimationFrame(() => 浮层()?.querySelector<HTMLButtonElement>(".ant-popconfirm-buttons button")?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(t);
  }, [开]);
  return (
    <Popconfirm
      open={开}
      onOpenChange={换}
      placement="bottomRight"
      autoAdjustOverflow={挪进屏}
      classNames={{ root: "ls-ub-pop" }}
      title="补建这条？"
      description={<span ref={问}>按此刻落人：负责人能接给他，否则按区域自动分配</span>}
      okText="补建"
      cancelText="取消"
      onConfirm={async () => { await 做(); }}
    >
      <Button ref={键} size="small" type="primary" disabled={禁} aria-haspopup="dialog" aria-expanded={开}>补建</Button>
    </Popconfirm>
  );
}
const 网断: { ok: false; error: string; 刷新?: true } = { ok: false, error: "没办成，网络可能断了，再点一次" };

/**
 * 「挂靠申请」页「重复咨询待补建」（P-公海-15 后半，lib/enterprise/repeat-unbuilt.ts）：
 *   - 管（这条线的销售管理、总管理、系统管理员）：每条的客户编号、渠道、对接人、沟通、没建原因、通知了谁、交的人和时间、处理结果；
 *     待补建的可点「补建」（锚在键上的确认浮层；落给谁按点的那一刻，挑不到人时弹框从这条线能接的销售里选一位）、「不补建」（弹框写原因，必填）
 *   - 我交的（交的市场同事）：只有客户编号、交的时间、状态、处理结果；没有任何键
 * 没办成的原因就地写在那一行（不弹顶部提示）；办成了刷新，顶上留一句结果。出口 C 没建的通知链到这一栏（锚点）
 */
export default function UnbuiltCard({ 栏 }: { 栏: 待补建栏 }) {
  const router = useRouter();
  const [忙, set忙] = useState<string | null>(null);
  const [行错, set行错] = useState<{ 键: string; 话: string } | null>(null);
  const [成了, set成了] = useState<string | null>(null);
  const [手选, set手选] = useState<{ 键: string; 为什么: string; 候选: { id: string; 名: string }[]; 选: string | null; 错: string | null } | null>(null);
  const [关, set关] = useState<{ 键: string; 客户编号: string; 原因: string; 错: string | null } | null>(null);

  const 收 = (键: string, r: { ok: true; 提示: string } | { ok: false; error: string; 刷新?: true }) => {
    if (r.ok) { set成了(r.提示); router.refresh(); return { ok: true as const }; }
    set行错({ 键, 话: r.error });
    if (r.刷新) router.refresh();
    return r;
  };
  const 补 = async (键: string, 指定?: string) => {
    set忙(键);
    set行错(null);
    set成了(null);
    const r = await 补建待补建(键, 指定 ?? null).catch(() => 网断);
    set忙(null);
    if (!r.ok && "要手选" in r) {
      set手选({ 键, 为什么: r.要手选.为什么, 候选: r.要手选.候选, 选: null, 错: null });
      return { ok: true as const };
    }
    return 收(键, r);
  };
  const 手选交 = async () => {
    if (!手选?.选) return;
    set忙(手选.键);
    const r = await 补建待补建(手选.键, 手选.选).catch(() => 网断);
    set忙(null);
    if (!r.ok && "要手选" in r) { set手选({ ...手选, 候选: r.要手选.候选, 选: null, 错: "刚才选的人现在接不了，换一位" }); return; }
    if (!r.ok) { set手选({ ...手选, 错: r.error }); if (r.刷新) router.refresh(); return; }
    set手选(null);
    收(手选.键, r);
  };
  const 关交 = async () => {
    if (!关) return;
    if (!关.原因.trim()) { set关({ ...关, 错: "请写不补建的原因（会告诉交的同事）" }); return; }
    set忙(关.键);
    const r = await 不补建待补建(关.键, 关.原因).catch(() => 网断);
    set忙(null);
    if (!r.ok) { set关({ ...关, 错: r.error }); if (r.刷新) router.refresh(); return; }
    set关(null);
    set成了(r.提示);
    router.refresh();
  };

  const 管列: ColumnsType<待补建行> = [
    { title: "客户编号", dataIndex: "客户编号", width: 120, ...省略, render: 一行 },
    { title: "渠道", dataIndex: "渠道", width: 130, ...省略, render: 一行 },
    { title: "对接人", dataIndex: "对接人", width: 170, ...省略, render: 一行 },
    { title: "沟通", key: "沟通", width: 280, ...省略, render: (_, r) => 一行(`${r.沟通方式} · ${时刻(r.沟通时间)} · ${r.沟通内容}`) },
    { title: "没建原因", dataIndex: "没建原因", width: 180, ...省略, render: 一行 },
    { title: "通知了", dataIndex: "通知了", width: 170, ...省略, render: 一行 },
    { title: "交的人", key: "交", width: 190, ...省略, render: (_, r) => 一行(`${r.交的人} · ${时刻(r.交的时间)}`) },
    { title: "状态", dataIndex: "状态", width: 90, render: 状态签 },
    { title: "处理结果", key: "结果", width: 220, ...省略, render: (_, r) => <结果格 r={r.结果} 空话="—" /> },
    {
      title: "", key: "op", width: 操作宽, fixed: "right", render: (_, r) => r.状态 === "待补建" && (
        <div className="ls-at-op">
          <Space size={4}>
            <BuildKey 做={() => 补(r.键)} 禁={!!忙 && 忙 !== r.键} />
            <Button size="small" disabled={!!忙} onClick={() => set关({ 键: r.键, 客户编号: r.客户编号, 原因: "", 错: null })}>不补建</Button>
          </Space>
          {行错?.键 === r.键 && <div className="ls-row-err" role="alert" title={行错.话}>{行错.话}</div>}
        </div>
      ),
    },
  ];
  const 我列: ColumnsType<我交的待补建> = [
    { title: "客户编号", dataIndex: "客户编号", width: 120, ...省略, render: 一行 },
    { title: "交的时间", dataIndex: "交的时间", width: 150, render: (v: string) => 时刻(v) },
    { title: "状态", dataIndex: "状态", width: 90, render: 状态签 },
    { title: "处理结果", key: "结果", width: 320, ...省略, render: (_, r) => <结果格 r={r.结果} 空话="等销售管理处理" /> },
  ];
  const 管宽 = 管列.reduce((s, c) => s + Number(c.width ?? 0), 0);
  const 待几条 = 栏.管?.filter((x) => x.状态 === "待补建").length ?? 0;

  return (
    <>
      {栏.管 && (
        <Card id={栏id} title="重复咨询待补建" size="small" extra={待几条 ? <Tag color="orange">{待几条} 条待处理</Tag> : null}>
          <p className="ls-ld-note" title="市场同事查号码撞上同事的客户，这条线挑不到人（或客户负责人到持有上限）时没建线索，留在这里：补建按点的那一刻落人；不补建要写原因；客户进了公海会自动关闭">
            市场同事交了、当时挑不到人没建线索的咨询：补建按点的那一刻落人；不补建要写原因；客户进了公海会自动关闭
          </p>
          {成了 && <Alert className="ls-ld-result" type="success" showIcon closable title={成了} onClose={() => set成了(null)} />}
          {栏.管.length
            ? <Table rowKey="键" size="small" className="ls-ub-tbl" columns={管列} dataSource={栏.管} pagination={false} tableLayout="fixed" scroll={{ x: 管宽 }} />
            : <Empty description="没有待补建的重复咨询" />}
        </Card>
      )}
      {栏.我交的.length > 0 && (
        <Card id={栏.管 ? undefined : 栏id} title="我交的重复咨询" size="small">
          <Table rowKey="键" size="small" columns={我列} dataSource={栏.我交的} pagination={false} tableLayout="fixed" scroll={{ x: 680 }} />
        </Card>
      )}
      <Modal
        open={!!手选} title="补建：选一位接手的销售" okText="补建给他" cancelText="取消" destroyOnHidden
        okButtonProps={{ disabled: !手选?.选 }} confirmLoading={!!忙 && 忙 === 手选?.键}
        onOk={() => void 手选交()} onCancel={() => set手选(null)}
      >
        {手选 && (
          <Space orientation="vertical" size={12} className="ls-ub-full">
            <Alert type="info" showIcon title={`客户负责人接不了，按区域自动分配也挑不到人（${手选.为什么}）：请从这条线能接的销售里选一位`} />
            {手选.候选.length
              ? <Select className="ls-ub-full" placeholder="选接手的销售" value={手选.选 ?? undefined} onChange={(v: string) => set手选({ ...手选, 选: v, 错: null })}
                  options={手选.候选.map((x) => ({ value: x.id, label: x.名 }))} showSearch={{ optionFilterProp: "label" }} />
              : <Alert type="warning" showIcon title="这条线现在没有能接的销售（都暂停、停用或到了持有上限）：先调整，或点「不补建」写原因关掉" />}
            {手选.错 && <div className="ls-row-err" role="alert" title={手选.错}>{手选.错}</div>}
          </Space>
        )}
      </Modal>
      <Modal
        open={!!关} title={关 ? `不补建：${关.客户编号}` : "不补建"} okText="不补建" cancelText="取消" destroyOnHidden
        okButtonProps={{ disabled: !关?.原因.trim() }} confirmLoading={!!忙 && 忙 === 关?.键}
        onOk={() => void 关交()} onCancel={() => set关(null)}
      >
        {关 && (
          <Space orientation="vertical" size={8} className="ls-ub-full">
            <div>原因必填，会通知交的同事；这条标「已关闭」</div>
            <Input autoFocus maxLength={原因上限} showCount placeholder="比如：客户只是问问价，已电话回过" value={关.原因}
              onChange={(e) => set关({ ...关, 原因: e.target.value, 错: null })} onPressEnter={() => void 关交()} />
            {关.错 && <div className="ls-row-err" role="alert" title={关.错}>{关.错}</div>}
          </Space>
        )}
      </Modal>
    </>
  );
}
