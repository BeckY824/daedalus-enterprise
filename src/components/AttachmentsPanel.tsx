"use client";

import { useCallback, useEffect, useState } from "react";
import { App, Button, Image, Popconfirm, Spin, Upload } from "antd";
import { DeleteOutlined, FileOutlined, InboxOutlined } from "@ant-design/icons";
import { 附件上限字节, 图片长边, 是图片, 每条最多, 读大小, 只收图片, 收的类型, type 附件, type 归属 } from "@/lib/attachment-rules";
import { 传附件, 归属查询 } from "@/lib/attachment-upload";

declare global {
  interface Window {
    /** 桌面端 preload-app.js：拷到临时目录用系统程序打开 */
    desktopAttachments?: { open(id: string, 名: string): Promise<{ ok: boolean; 只显示?: boolean; error?: string }> };
  }
}

/**
 * 商机 / 订单上的「图片」区（2026-10-22 D-24）：拖进来或点选；出缩略图、点开看大图；能删。
 * 图片先在这台电脑上压到长边 2000 像素再传，超了上限当场说超了多少，不等传完。
 * 这一版只收图片（只收图片）；别的文件那套（写名字大小、点开交给系统程序）留着，放开时不用重写。
 *
 * 企业版联系人附件（10-28）也用这一块：归属 = 线索 / 联系人，说明 换成名片那句；只读 = 只看不传不删（只读的客户）。
 * on个数：张数变了告诉外面（联系人卡上的「附件 N」跟着变）
 */
export default function AttachmentsPanel({ 归属: 挂在, 只读 = false, 说明, on个数 }: { 归属: 归属; 只读?: boolean; 说明?: string; on个数?: (n: number) => void }) {
  const { message } = App.useApp();
  const [列表, set列表] = useState<附件[] | null>(null);
  const [传着, set传着] = useState(0);
  const 查询 = 归属查询(挂在);
  useEffect(() => { if (列表) on个数?.(列表.length); }, [列表, on个数]);

  const 读 = useCallback(async (): Promise<附件[]> => {
    const r = await fetch(`/api/attachments?${查询}`, { cache: "no-store" });
    const j = (await r.json().catch(() => ({}))) as { 附件?: 附件[]; error?: string };
    if (!r.ok) throw new Error(j.error ?? `读图片没成（${r.status}）`);
    return j.附件 ?? [];
  }, [查询]);

  const 刷新 = useCallback(
    () =>
      读().then(set列表, (e: unknown) => {
        set列表((x) => x ?? []);
        message.error(e instanceof Error ? e.message : "读图片没成");
      }),
    [读, message],
  );

  useEffect(() => {
    let 走了 = false;
    读().then(
      (x) => { if (!走了) set列表(x); },
      (e: unknown) => {
        if (走了) return;
        set列表([]);
        message.error(e instanceof Error ? e.message : "读图片没成");
      },
    );
    return () => { 走了 = true; };
  }, [读, message]);

  async function 传一个(f: File) {
    set传着((n) => n + 1);
    try {
      const r = await 传附件(挂在, f);
      if (!r.ok) return void message.error(r.error);
      await 刷新();
    } finally {
      set传着((n) => n - 1);
    }
  }

  async function 删(a: 附件) {
    const r = await fetch(`/api/attachments/${a.id}`, { method: "DELETE" });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) return void message.error(j.error ?? "没删掉");
    set列表((x) => x?.filter((y) => y.id !== a.id) ?? null);
  }

  async function 打开(a: 附件) {
    if (!a.有文件) {
      // 团队版：别人刚传的可能还在路上，问一句服务器那边到了没有
      const r = await fetch(`/api/attachments/${a.id}`, { method: "HEAD" }).catch(() => null);
      if (r?.status === 409) return void message.info("对方还在上传，稍后再看");
      if (!r?.ok) return void message.warning("文件不在这台电脑上");
      await 刷新();
    }
    const 桥 = typeof window !== "undefined" ? window.desktopAttachments : undefined;
    if (桥) {
      const r = await 桥.open(a.id, a.name);
      if (!r.ok) message.error(r.error ?? "没打开");
      else if (r.只显示) message.info("这类文件不直接运行，已在文件夹里选中它");
      return;
    }
    // 网页 / 连着服务器：当下载
    const 链 = document.createElement("a");
    链.href = `/api/attachments/${a.id}`;
    链.download = a.name;
    链.click();
  }

  const 图们 = (列表 ?? []).filter((a) => 是图片(a.mime));
  const 别的 = (列表 ?? []).filter((a) => !是图片(a.mime));
  const 满了 = (列表?.length ?? 0) >= 每条最多;

  return (
    <div className="att-panel" data-testid="attachments-panel">
      {!只读 && <div data-testid="attachment-upload">
      <Upload.Dragger
        multiple
        showUploadList={false}
        disabled={满了}
        accept={只收图片 ? 收的类型 : undefined}
        beforeUpload={(f) => {
          void 传一个(f);
          return false;
        }}
      >
        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
        <p className="ant-upload-text">{满了 ? `已经 ${每条最多} 张了，先删掉几张不要的` : 说明 ?? (只收图片 ? "把产品图片拖到这里，或点一下选图片" : "把文件拖到这里，或点一下选文件")}</p>
        <p className="ant-upload-hint">JPG、PNG、GIF、WebP、BMP 都行；单张最多 {读大小(附件上限字节)}，会先压到长边 {图片长边} 像素再存</p>
      </Upload.Dragger>
      </div>}

      {列表 === null ? (
        <div style={{ padding: 16, textAlign: "center" }}><Spin /></div>
      ) : (
        <>
          {传着 > 0 && <div className="muted" style={{ marginTop: 10 }}><Spin size="small" /> 正在传 {传着} 个…</div>}
          {列表.length === 0 && 传着 === 0 && <div className="muted" style={{ marginTop: 只读 ? 0 : 10 }}>{只收图片 ? "还没有图片。" : "还没有附件。"}</div>}
          {图们.length > 0 && (
            <Image.PreviewGroup>
              <div className="att-pics">
                {图们.map((a) => (
                  <div key={a.id} className="att-pic" data-testid="attachment-item" data-id={a.id} title={`${a.name} · ${读大小(a.size)}`}>
                    {a.有文件 ? (
                      <Image src={`/api/attachments/${a.id}`} alt={a.name} width={96} height={96} style={{ objectFit: "cover" }} />
                    ) : (
                      <div className="att-missing" data-testid="attachment-missing">文件不在这台电脑上</div>
                    )}
                    <div className="att-pic-name">{a.name}</div>
                    {!只读 && <删按钮 a={a} 删={删} />}
                  </div>
                ))}
              </div>
            </Image.PreviewGroup>
          )}
          {别的.length > 0 && (
            <ul className="att-files">
              {别的.map((a) => (
                <li key={a.id} data-testid="attachment-item" data-id={a.id}>
                  <FileOutlined />
                  <a onClick={() => void 打开(a)} title="用这台电脑上的程序打开">{a.name}</a>
                  {a.有文件 ? <span className="muted">{读大小(a.size)}</span> : <span className="muted" data-testid="attachment-missing">文件不在这台电脑上</span>}
                  {!只读 && <删按钮 a={a} 删={删} />}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function 删按钮({ a, 删 }: { a: 附件; 删: (a: 附件) => Promise<void> }) {
  return (
    <Popconfirm title={`删掉「${a.name}」？`} okText="删掉" okButtonProps={{ danger: true }} cancelText="不删" onConfirm={() => 删(a)}>
      <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label={`删掉 ${a.name}`} data-testid="attachment-delete" />
    </Popconfirm>
  );
}
