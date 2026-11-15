"use client";

import { useEffect, useState, useTransition } from "react";
import { Button, Modal } from "antd";
import Rise from "./Rise";
import HoldConfirm from "./HoldConfirm";
import { PlusOutlined, ExperimentOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { 查演示数据状态, 灌一套演示数据, 清除演示数据, type 演示数据状态 } from "@/app/(app)/demo-data";
import { useBusiness } from "@/lib/business-client";

/**
 * 空状态。
 *
 * 原来每个空列表都是 antd 默认的「暂无数据」盒子——它说的是「没有」，
 * 而第一次打开的人需要知道的是「接下来做什么」。所以每个空状态说三件事：
 * 这是什么、第一步（一个主按钮）、还有什么别的路（导入 / 演示数据）。
 *
 * 演示数据那颗键由它自己判断要不要出现（托管版不给、桌面端不给、非管理员不给、库非空不给），
 * 调用方不用管——它在每个空状态上都该是同一套规则。
 */
export default function EmptyState({
  title,
  hint,
  primary,
  secondary,
  /** 这一页的空状态要不要带演示数据那颗键。列表页都带，子页面（比如管道）不带 */
  demo = true,
}: {
  title: string;
  hint: string;
  primary?: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void }[];
  demo?: boolean;
}) {
  return (
    /* 和 StatePage 同一张脸、同一个进场：空、404、出错在人眼里是一件事。
       标题、说明、按钮三拍依次进来（原型 g.empty：每拍上浮 6px，间隔一档 --stagger） */
    <div className="empty-state">
      <Rise 第几个={0} className="empty-state-t">{title}</Rise>
      <Rise 第几个={1} className="empty-state-h">{hint}</Rise>
      <Rise 第几个={2} className="empty-state-a">
        {primary && (
          <Button type="primary" icon={<PlusOutlined />} onClick={primary.onClick}>
            {primary.label}
          </Button>
        )}
        {secondary?.map((s) => (
          <Button key={s.label} onClick={s.onClick}>
            {s.label}
          </Button>
        ))}
        {demo && <DemoDataButton />}
      </Rise>
    </div>
  );
}

/**
 * 演示数据的状态。问服务端要（部署形态、角色、库空不空）——这几条判断只能在服务端做：
 * 客户端拿不到 MULTI_TENANT / DESKTOP_LOCAL，也不该信客户端说自己是管理员。
 */
function useDemoState() {
  const [状态, set状态] = useState<演示数据状态 | null>(null);
  useEffect(() => {
    查演示数据状态().then(set状态).catch(() => {});
  }, []);
  return [状态, set状态] as const;
}

/**
 * 演示数据这件事在这个界面上有没有入口。**规则只写这一处**，
 * 按钮和设置里那一栏都照它判断，不然会出现「有标题没按钮」的空栏位。
 *
 * 桌面端只剩「清除」：那边不再给灌（见 demo-data.ts），但 0.36.1 之前灌过的人
 * 还得有一条路把它清掉。
 */
function 有演示数据入口(s: 演示数据状态 | null): boolean {
  if (!s?.可用 || !s.有权限) return false;
  return s.已灌 || (s.可灌 && s.空库);
}

/** 「灌一套演示数据」/「清除演示数据」。条件不满足就什么都不画 */
export function DemoDataButton() {
  const [状态, set状态] = useDemoState();
  if (!有演示数据入口(状态)) return null;
  return <DemoDataControls 状态={状态!} set状态={set状态} />;
}

/**
 * 设置 · 业务配置底下那一栏。整栏由同一条规则决定出不出现——
 * 桌面端（没灌过的）连标题都不该看到。
 */
export function DemoDataSection() {
  const b = useBusiness();
  const [状态, set状态] = useDemoState();
  if (!有演示数据入口(状态)) return null;
  return (
    <div className="biz-demo">
      <h4>演示数据</h4>
      {/* 原来这里写的是 **全部**：JSX 里不是 Markdown，界面上原样显示两对星号 */}
      <p>一套虚构的{b.customer}、跟进和签约，用来看这套系统装满之后长什么样。清除会删掉库里<b>全部</b>业务数据。</p>
      <DemoDataControls 状态={状态!} set状态={set状态} />
    </div>
  );
}

function DemoDataControls({ 状态, set状态 }: { 状态: 演示数据状态; set状态: (s: 演示数据状态) => void }) {
  const b = useBusiness();
  /** 清除前那一问。它自己是个 Modal，因为要在框里放长按确认 */
  const [问, set问] = useState(false);
  const [pending, startTransition] = useTransition();
  /** g.save：灌入 / 清除没成的原因就地写（框里、键旁），不弹顶部提示；成了的那一下由界面本身说（键变了、列表有数了） */
  const [错, set错] = useState<string | null>(null);
  const router = useRouter();

  if (状态.已灌) {
    return (
      <>
        <Button danger loading={pending} onClick={() => set问(true)}>
          清除演示数据
        </Button>
        {/*
          **全站唯一一处长按确认**（components/HoldConfirm.tsx，原来是滑动确认）。
          这一下删掉的是库里全部业务数据，而「确定」那颗键和「保存」长得一模一样——
          手比脑子快的时候它挡不住任何人。解释仍然要写：闸门防的是误触，说清楚防的是误解。
        */}
        <Modal open={问} onCancel={() => { set问(false); set错(null); }} title="清除演示数据？" footer={null} width={460}>
          {/* 列全、用这个工作区的叫法（排查 D7）：原来写死「学员」，也没提联系人、签约、计划、导入记录 */}
          <p style={{ marginTop: 0, color: "var(--ink-soft)", lineHeight: 1.7 }}>
            会删掉这个库里<b>全部</b>业务数据：{b.customer}和他们的联系人、线索、渠道、商机、签约、跟进记录、计划和待办、导入记录、操作日志。
            灌完演示数据之后你自己录的也一起没。设置和账号不动。
          </p>
          {错 && <p className="empty-demo-err" role="alert">{错}</p>}
          <HoldConfirm
            话="清除演示数据"
            忙={pending}
            做={() =>
              new Promise<{ ok: boolean; error?: string }>((resolve) =>
                startTransition(async () => {
                  const r = await 清除演示数据();
                  if (r.ok) {
                    set错(null);
                    set状态({ ...状态, 空库: true, 已灌: false });
                    set问(false);
                    router.refresh();
                    resolve({ ok: true });
                  } else {
                    set错(r.error);
                    resolve({ ok: false, error: r.error });
                  }
                }),
              )
            }
          />
        </Modal>
      </>
    );
  }

  return (
    <>
      <Button
        icon={<ExperimentOutlined />}
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await 灌一套演示数据();
            if (r.ok) {
              set错(null);
              set状态({ ...状态, 空库: false, 已灌: true });
              router.refresh();
            } else set错(r.error);
          })
        }
      >
        灌一套演示数据看看
      </Button>
      {错 && <span className="empty-demo-err" role="alert">{错}</span>}
    </>
  );
}

/** antd Table 的 locale.emptyText 要的是一个节点，包一层免得每个调用处都写 */
export function 表格空态(props: Parameters<typeof EmptyState>[0]) {
  return { emptyText: <EmptyState {...props} /> };
}
