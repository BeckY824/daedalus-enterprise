"use client";

import { useState } from "react";
import { App, Button, Image, Popconfirm, Spin, Upload } from "antd";
import { AudioOutlined, DeleteOutlined, DownloadOutlined, PaperClipOutlined } from "@ant-design/icons";
import { 是图片, 是音频, 收的沟通类型, 读大小, type 附件 } from "@/lib/attachment-rules";
import { 传附件 } from "@/lib/attachment-upload";

/**
 * 企业版沟通记录上的截图、录音（F-跟进-07）：挂在一条沟通上（Attachment.followUpId），上传、存放、下载、上限和项目附件同一套。
 * 图片出缩略图、点开看大图；录音就地播放，旁边给下载。不做 AI 纪要。
 * 能传 = 记这条的人、总管理员、经理（服务端 api/attachments/access.ts 认沟通 同一个判断）；能删 = 只有总管理员、经理
 */
export default function FollowAttachments({ followUpId, 附件: 起始, 能传, 能删 }: { followUpId: string; 附件: 附件[]; 能传: boolean; 能删: boolean }) {
  const { message } = App.useApp();
  const [列表, set列表] = useState(起始);
  const [传着, set传着] = useState(0);

  async function 传一个(f: File) {
    set传着((n) => n + 1);
    try {
      const r = await 传附件({ followUpId }, f);
      if (!r.ok) return void message.error(r.error);
      const 新 = r.附件;
      if (新) set列表((x) => [...x, 新]);
    } finally {
      set传着((n) => n - 1);
    }
  }

  async function 删(a: 附件) {
    const r = await fetch(`/api/attachments/${a.id}`, { method: "DELETE" });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) return void message.error(j.error ?? "没删掉");
    set列表((x) => x.filter((y) => y.id !== a.id));
  }

  if (!列表.length && !能传) return null;
  const 图们 = 列表.filter((a) => 是图片(a.mime));
  const 别的 = 列表.filter((a) => !是图片(a.mime));
  const 删钮 = (a: 附件) => 能删 && (
    <Popconfirm title={`删掉「${a.name}」？`} okText="删掉" okButtonProps={{ danger: true }} cancelText="不删" onConfirm={() => 删(a)}>
      <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label={`删掉 ${a.name}`} />
    </Popconfirm>
  );

  return (
    <div className="follow-att" data-testid="follow-attachments">
      {图们.length > 0 && (
        <Image.PreviewGroup>
          <div className="follow-att-pics">
            {图们.map((a) => (
              <div key={a.id} className="follow-att-pic" title={`${a.name} · ${读大小(a.size)}`}>
                <Image src={`/api/attachments/${a.id}`} alt={a.name} width={64} height={64} style={{ objectFit: "cover" }} />
                {删钮(a)}
              </div>
            ))}
          </div>
        </Image.PreviewGroup>
      )}
      {别的.map((a) => (
        <div key={a.id} className="follow-att-file">
          {是音频(a.mime) ? <AudioOutlined /> : <PaperClipOutlined />}
          <span className="follow-att-name" title={a.name}>{a.name}</span>
          {是音频(a.mime) && <audio controls preload="none" src={`/api/attachments/${a.id}`} aria-label={`播放 ${a.name}`} />}
          <a href={`/api/attachments/${a.id}?download`} download={a.name} aria-label={`下载 ${a.name}`}><DownloadOutlined /></a>
          {删钮(a)}
        </div>
      ))}
      {能传 && (
        <div className="follow-att-add">
          <Upload multiple showUploadList={false} accept={收的沟通类型} beforeUpload={(f) => { void 传一个(f); return false; }}>
            <Button size="small" type="link" icon={<PaperClipOutlined />} style={{ paddingInline: 0 }}>加截图 / 录音</Button>
          </Upload>
          {传着 > 0 && <span className="muted"><Spin size="small" /> 正在传 {传着} 个…</span>}
        </div>
      )}
    </div>
  );
}

/** 记沟通时先挑好的截图、录音：记下之后拿到 followUpId 再一个个传（传不上的逐条报，沟通照样记下了） */
export function 选沟通附件({ 文件们, on改 }: { 文件们: File[]; on改: (x: File[]) => void }) {
  return (
    <div>
      <Upload multiple showUploadList={false} accept={收的沟通类型} beforeUpload={(f) => { on改([...文件们, f]); return false; }}>
        <Button size="small" icon={<PaperClipOutlined />}>加截图 / 录音</Button>
      </Upload>
      {文件们.length > 0 && (
        <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
          {文件们.map((f, i) => (
            <div key={`${f.name}-${i}`} className="follow-att-file">
              {是图片(f.type) ? <PaperClipOutlined /> : <AudioOutlined />}
              <span className="follow-att-name" title={f.name}>{f.name}</span>
              <span className="muted">{读大小(f.size)}</span>
              <Button size="small" type="text" icon={<DeleteOutlined />} aria-label={`不传 ${f.name}`} onClick={() => on改(文件们.filter((_, j) => j !== i))} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 记下之后传：返回没传上的那几句 */
export async function 传沟通附件(followUpId: string, 文件们: File[]): Promise<string[]> {
  const 错: string[] = [];
  for (const f of 文件们) {
    const r = await 传附件({ followUpId }, f);
    if (!r.ok) 错.push(r.error);
  }
  return 错;
}
