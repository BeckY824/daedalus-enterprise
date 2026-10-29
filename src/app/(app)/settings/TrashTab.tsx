"use client";

import { useEffect, useState } from "react";
import { App, Button, Table, Tag, Typography } from "antd";
import { smartTime } from "@/lib/utils";
import { useBusiness } from "@/lib/business-client";
import { 回收站列表动作, 恢复回收站, 彻底删除回收站 } from "./trash-actions";
import type { 回收站条目 } from "@/lib/enterprise/soft-delete";

/**
 * 设置 → 回收站（企业版，P9 2026-10-29）：近 30 天删的客户、项目、联系人、沟通记录。
 * 随客户一起删的不单列，算在客户那一行的「连带」里，恢复客户时一起回来。
 * 老板、主管、管理员能恢复；彻底删除只有老板和总管理员，点了还要再确认一次。
 * 宽度：设置正文 1024 宽时 494、开着 AI 栏时 370 上下，只给时间、按钮两列定宽（合计 196），名称列分剩下的
 */
export default function TrashTab() {
  const { message, modal } = App.useApp();
  const b = useBusiness();
  const [行, set行] = useState<回收站条目[] | null>(null);
  const [能真删, set能真删] = useState(false);
  const [读不到, set读不到] = useState<string | null>(null);
  const [忙, set忙] = useState<string | null>(null);

  const 叫 = (t: 回收站条目["表"]) => ({ Customer: b.customer, Project: "项目", Contact: "联系人", FollowUp: "沟通记录" })[t];
  const 连带话 = (c: NonNullable<回收站条目["连带"]>) =>
    [c.联系人 && `${c.联系人} 位联系人`, c.项目 && `${c.项目} 个项目`, c.沟通记录 && `${c.沟通记录} 条沟通记录`].filter(Boolean).join("、");

  const 拉 = () =>
    回收站列表动作()
      .then((r) => {
        if (!r.ok) { set读不到(r.error); set行([]); return; }
        set读不到(null);
        set能真删(r.能彻底删除);
        set行(r.条目);
      })
      .catch(() => { set读不到("回收站没读出来。"); set行([]); });
  useEffect(() => { void 拉(); }, []);

  async function 恢(r: 回收站条目) {
    set忙(r.id);
    try {
      const x = await 恢复回收站(r.表, r.id).catch(() => ({ ok: false as const, error: "恢复没能完成，请重试" }));
      if (!x.ok) return message.error(x.error);
      message.success(`已恢复${叫(r.表)}「${r.名称}」${x.连带 ? `，连同 ${x.连带} 条一起` : ""}`);
      await 拉();
    } finally {
      set忙(null);
    }
  }

  function 真删(r: 回收站条目) {
    const 连 = r.连带 ? 连带话(r.连带) : "";
    modal.confirm({
      title: `彻底删除${叫(r.表)}「${r.名称}」？`,
      content: (
        <>
          <div>删了就找不回来了{连 ? `，${连}一起删掉` : ""}。</div>
          <div style={{ color: "var(--text-muted)" }}>不急的话放着就好，30 天到了会自动清掉。</div>
        </>
      ),
      okText: "彻底删除",
      okButtonProps: { danger: true },
      cancelText: "不了",
      onOk: async () => {
        set忙(r.id);
        try {
          const x = await 彻底删除回收站(r.表, r.id).catch(() => ({ ok: false as const, error: "没能删掉，请重试" }));
          if (!x.ok) { message.error(x.error); return; }
          message.success("已彻底删除");
          await 拉();
        } finally {
          set忙(null);
        }
      },
    });
  }

  return (
    <>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 14 }}>
        删了的{b.customer}、项目、联系人、沟通记录先放这里，30 天内能恢复，过了自动清掉。删{b.customer}时连带的那些跟着{b.customer}一起回来。
      </Typography.Paragraph>
      <Table<回收站条目>
        rowKey={(r) => `${r.表}:${r.id}`}
        size="middle"
        loading={行 === null}
        dataSource={行 ?? []}
        pagination={(行?.length ?? 0) > 50 ? { pageSize: 50, showSizeChanger: false } : false}
        locale={{
          emptyText: 读不到 ? (
            <span>
              {读不到}
              <Button type="link" size="small" onClick={() => { set行(null); void 拉(); }}>再读一次</Button>
            </span>
          ) : "回收站是空的",
        }}
        columns={[
          {
            title: "删了什么",
            render: (_, r) => (
              <>
                <span style={{ display: "flex", gap: 6, alignItems: "baseline", minWidth: 0 }}>
                  <Tag style={{ marginInlineEnd: 0, flex: "none" }}>{叫(r.表)}</Tag>
                  <Typography.Text ellipsis={{ tooltip: r.名称 }} style={{ minWidth: 0 }}>{r.名称 || "（没写内容）"}</Typography.Text>
                </span>
                {r.客户 && (
                  <Typography.Text type="secondary" ellipsis={{ tooltip: r.客户.name }} style={{ display: "block", fontSize: 12 }}>
                    {b.customer}：{r.客户.name}{r.客户.也删了 ? "（也在回收站里）" : ""}
                  </Typography.Text>
                )}
                {r.连带 && 连带话(r.连带) && (
                  <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>连带 {连带话(r.连带)}</Typography.Text>
                )}
              </>
            ),
          },
          {
            title: "什么时候删的",
            dataIndex: "deletedAt",
            width: 100,
            render: (v: string, r) => (
              <>
                {smartTime(new Date(v))}
                <Typography.Text type={r.剩几天 <= 3 ? "danger" : "secondary"} style={{ display: "block", fontSize: 12 }}>
                  还剩 {r.剩几天} 天
                </Typography.Text>
              </>
            ),
          },
          {
            title: "",
            width: 96,
            align: "right",
            render: (_, r) => (
              <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                <Button
                  size="small"
                  loading={忙 === r.id}
                  disabled={!!r.客户?.也删了}
                  title={r.客户?.也删了 ? `先恢复${b.customer}「${r.客户.name}」` : undefined}
                  onClick={() => 恢(r)}
                >
                  恢复
                </Button>
                {能真删 && (
                  <Button size="small" type="link" danger disabled={忙 === r.id} onClick={() => 真删(r)} style={{ paddingInline: 0 }}>
                    彻底删除
                  </Button>
                )}
              </span>
            ),
          },
        ]}
      />
    </>
  );
}
