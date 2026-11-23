"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Image, Spin, Upload } from "antd";
import InlineConfirm from "@/components/InlineConfirm";
import { DeleteOutlined, FileOutlined, InboxOutlined, UploadOutlined } from "@ant-design/icons";
import { 附件上限字节, 图片长边, 是图片, 每条最多, 读大小, 只收图片, 收的类型, 收所有文件, type 附件, type 归属 } from "@/lib/attachment-rules";
import { 传附件, 归属查询 } from "@/lib/attachment-upload";
import { usePasteUpload, 粘贴标记 } from "@/lib/paste-upload";
import { useViewAs } from "@/components/ViewAsContext";
import { 视图外部话 } from "@/lib/enterprise/view-as-words";

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
 * on变了（11-02）：一批传完（有传成的）或删掉一个后叫一次，外面 router.refresh（项目节点必填跟着变）；不在这里 useRouter，别的地方用这块不用管
 *
 * 企业版项目附件（P11，10-29）：归属 = 项目，什么文件都收（收所有文件），说法从「图片」换成「附件」
 * 紧凑（F-项目-18，项目附件合成一块后每格用）：大拖放框换成一颗小「上传」按钮，上限、提示一样
 * 粘贴截图（11-17）：焦点在这块或它所在的弹窗 / 格里时 Ctrl+V / ⌘V，走和点选同一个 传一个（lib/paste-upload.ts）
 * 小标题（设计语言 D5 · M11-b，项目附件）：这一格自己画小标题，「上传」挪到小标题右边；「单个最多 20 MB」由外面整卡写一次，
 *   这里不再每格写；整格能拖进来（和点选同一个 传一个）；空态「还没有附件」不带句号
 * 提示（F-042）：小标题下面一行灰字说这一格放什么（项目方案、合同附件两格），一行放不下省略、悬停看全文
 */
export default function AttachmentsPanel({ 归属: 挂在, 只读: 只读参 = false, 能删: 能删参 = false, 说明, on个数, 分类, 紧凑 = false, on变了, 小标题, 提示 }: { 归属: 归属; 只读?: boolean; 能删?: boolean; 说明?: string; on个数?: (n: number) => void; 分类?: string | null; 紧凑?: boolean; on变了?: () => void; 小标题?: ReactNode; 提示?: ReactNode }) {
  /**
   * 就地反馈（dt.upload / g.save，不弹顶部提示）：在传的每个文件一行（进度环 → ✓ / 没传上的原因），
   * 读没成、删没成、打不开、自动推进了写在块里一行；几秒后自己收。错 = 红字（role=alert）；常 = 灰字（role=status）
   */
  const [在传们, set在传们] = useState<{ key: number; 名: string; 态: "传" | "成" | "错"; 错?: string }[]>([]);
  const 传号 = useRef(0);
  const [块话, set块话] = useState<{ 话: string; 错?: boolean } | null>(null);
  const 块话计时 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const 说 = useCallback((话: string, 错 = true) => {
    if (块话计时.current) clearTimeout(块话计时.current);
    set块话({ 话, 错 });
    块话计时.current = setTimeout(() => set块话(null), 错 ? 6000 : 4000);
  }, []);
  useEffect(() => () => { if (块话计时.current) clearTimeout(块话计时.current); }, []);
  // 切换视图（只读预览）：看得到列表和图，不能传、删、下载（服务端同样拒）
  const 视图中 = useViewAs();
  const 只读 = 只读参 || 视图中;
  // 只读时也给删（公海里系统管理员删联系人附件，服务端按删除挡另判，#403 审查）；切换视图照旧不给
  const 可删 = !只读 || (能删参 && !视图中);
  const [列表, set列表] = useState<附件[] | null>(null);
  const [传着, set传着] = useState(0);
  // 分类（企业版联系人的 名片 / 相册，10-29）：只列这一格、传上去记成这一格
  const 查询 = 归属查询(挂在) + (分类 ? `&tag=${encodeURIComponent(分类)}` : "");
  const 只图 = 只收图片 && !收所有文件(挂在);
  const 叫 = 只图 ? "图片" : "附件";
  useEffect(() => { if (列表) on个数?.(列表.length); }, [列表, on个数]);

  const 读 = useCallback(async (): Promise<附件[]> => {
    const r = await fetch(`/api/attachments?${查询}`, { cache: "no-store" });
    const j = (await r.json().catch(() => ({}))) as { 附件?: 附件[]; error?: string };
    if (!r.ok) throw new Error(j.error ?? `读${叫}没成（${r.status}）`);
    return j.附件 ?? [];
  }, [查询, 叫]);

  // 读的序号（11-02）：只认最后一次读的结果，先发后到的旧列表不盖新的（传了两个时第二个不会闪没；删掉的不会被回来的旧列表带回来）
  const 读序 = useRef(0);
  const 这批 = useRef({ 在传: 0, 传成: 0 });

  const 刷新 = useCallback(
    () => {
      const 序 = ++读序.current;
      return 读().then(
        (x) => { if (序 === 读序.current) set列表(x); },
        (e: unknown) => {
          if (序 !== 读序.current) return;
          set列表((x) => x ?? []);
          说(e instanceof Error ? e.message : `读${叫}没成`);
        },
      );
    },
    [读, 说, 叫],
  );

  useEffect(() => {
    let 走了 = false;
    const 序 = ++读序.current;
    读().then(
      (x) => { if (!走了 && 序 === 读序.current) set列表(x); },
      (e: unknown) => {
        if (走了 || 序 !== 读序.current) return;
        set列表([]);
        说(e instanceof Error ? e.message : `读${叫}没成`);
      },
    );
    return () => { 走了 = true; };
  }, [读, 说, 叫]);

  async function 传一个(f: File) {
    这批.current.在传++;
    set传着((n) => n + 1);
    const key = ++传号.current;
    set在传们((x) => [...x, { key, 名: f.name, 态: "传" }]);
    const 改行 = (改: { 态: "成" | "错"; 错?: string }) => set在传们((x) => x.map((y) => (y.key === key ? { ...y, ...改 } : y)));
    // ✓ 停一会儿再收；没传上的那行留着（点 × 收），原因写在行上
    const 收 = () => set在传们((x) => x.filter((y) => y.key !== key));
    try {
      const r = await 传附件(挂在, f, 分类).catch(() => ({ ok: false as const, error: "没传上，请检查网络后再试" }));
      if (!r.ok) return void 改行({ 态: "错", 错: r.error });
      改行({ 态: "成" });
      setTimeout(收, 1500);
      这批.current.传成++;
      // 传上去的先摆上（列表还没读回来时 x 是 null，等这批传完读一遍），这批传完再读一遍对齐
      const 新 = r.附件;
      if (新) set列表((x) => (x && !x.some((y) => y.id === 新.id) ? [...x, 新] : x));
      // 企业版节点必填：传了合同 / 方案把必填填齐，项目自动往前推了
      if (r.自动推到?.length) 说(`必填齐了，自动推进到 ${r.自动推到.join(" → ")}`, false);
    } finally {
      set传着((n) => n - 1);
      if (--这批.current.在传 === 0) {
        const 有传成 = 这批.current.传成 > 0;
        这批.current.传成 = 0;
        if (有传成) {
          await 刷新();
          on变了?.();
        }
      }
    }
  }

  /** 删：就地问过（InlineConfirm），没删掉问句留着、原因写在块里；删掉了这一项消失 */
  async function 删(a: 附件): Promise<{ ok: boolean; error?: string }> {
    try {
      const r = await fetch(`/api/attachments/${a.id}`, { method: "DELETE" });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) { 说(j.error ?? "没删掉"); return { ok: false, error: j.error ?? "没删掉" }; }
      读序.current++;
      set列表((x) => x?.filter((y) => y.id !== a.id) ?? null);
      on变了?.();
      return { ok: true };
    } catch {
      说("没删掉，请检查网络后再试");
      return { ok: false, error: "没删掉，请检查网络后再试" };
    }
  }

  async function 打开(a: 附件) {
    if (!a.有文件) {
      // 团队版：别人刚传的可能还在路上，问一句服务器那边到了没有
      const r = await fetch(`/api/attachments/${a.id}`, { method: "HEAD" }).catch(() => null);
      if (r?.status === 409) return void 说("对方还在上传，稍后再看", false);
      if (!r?.ok) return void 说("文件不在这台电脑上");
      await 刷新();
    }
    const 桥 = typeof window !== "undefined" ? window.desktopAttachments : undefined;
    if (桥) {
      const r = await 桥.open(a.id, a.name);
      if (!r.ok) 说(r.error ?? "没打开");
      else if (r.只显示) 说("这类文件不直接运行，已在文件夹里选中它", false);
      return;
    }
    if (视图中) return void 说(视图外部话, false);
    // 网页 / 连着服务器：当下载
    const 链 = document.createElement("a");
    链.href = `/api/attachments/${a.id}`;
    链.download = a.name;
    链.click();
  }

  const 图们 = (列表 ?? []).filter((a) => 是图片(a.mime));
  const 别的 = (列表 ?? []).filter((a) => !是图片(a.mime));
  const 满了 = (列表?.length ?? 0) >= 每条最多;
  // 传着时灰掉：重复点不会多传一遍；同一次选的多个文件照样都传
  const 灰 = 满了 || 传着 > 0;
  // 粘贴截图：能传、没灰的时候才接（和上传按钮同一个条件），交给同一个 传一个
  const 根 = useRef<HTMLDivElement>(null);
  usePasteUpload(根, !只读 && !灰, (们) => { for (const f of 们) void 传一个(f); });
  const 粘贴话 = "也可以直接粘贴截图";
  // 小标题那种（D5 · M11-b）：整格接拖放；拖着文件悬在上面时描一圈主色（.is-drop）
  const [拖着, set拖着] = useState(false);
  const 能拖 = 小标题 !== undefined && !只读 && !灰;
  const 带文件 = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  const 拖放 = 能拖 ? {
    onDragOver: (e: React.DragEvent) => { if (!带文件(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; if (!拖着) set拖着(true); },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) set拖着(false); },
    onDrop: (e: React.DragEvent) => { if (!带文件(e)) return; e.preventDefault(); set拖着(false); for (const f of Array.from(e.dataTransfer.files)) void 传一个(f); },
  } : {};

  return (
    <div className={`att-panel${小标题 !== undefined && 拖着 && 能拖 ? " is-drop" : ""}`} data-testid="attachments-panel" ref={根} {...(只读 ? {} : { [粘贴标记]: "" })} {...拖放}>
      {小标题 !== undefined && (
        <div className="proj-att-h att-h-row">
          <span className="att-h-t">{小标题}</span>
          {!只读 && (
            <span data-testid="attachment-upload" className="att-h-up-w">
            <Upload
              multiple
              showUploadList={false}
              disabled={灰}
              accept={只图 ? 收的类型 : undefined}
              beforeUpload={(f) => {
                void 传一个(f);
                return false;
              }}
            >
              <Button type="text" size="small" className="att-h-up" icon={<UploadOutlined />} disabled={灰} title={满了 ? `已经 ${每条最多} 个了，先删掉几个不要的` : undefined}>上传</Button>
            </Upload>
            </span>
          )}
        </div>
      )}
      {小标题 !== undefined && 提示 && <div className="proj-att-tip">{提示}</div>}
      {小标题 === undefined && !只读 && 紧凑 && <div data-testid="attachment-upload" className="att-compact">
        <Upload
          multiple
          showUploadList={false}
          disabled={灰}
          accept={只图 ? 收的类型 : undefined}
          beforeUpload={(f) => {
            void 传一个(f);
            return false;
          }}
        >
          <Button size="small" icon={<UploadOutlined />} disabled={灰}>上传</Button>
        </Upload>
        <span className="muted">{满了 ? `已经 ${每条最多} 个了，先删掉几个不要的` : `单个最多 ${读大小(附件上限字节)}；${粘贴话}`}</span>
      </div>}
      {小标题 === undefined && !只读 && !紧凑 && <div data-testid="attachment-upload">
      <Upload.Dragger
        multiple
        showUploadList={false}
        disabled={灰}
        accept={只图 ? 收的类型 : undefined}
        beforeUpload={(f) => {
          void 传一个(f);
          return false;
        }}
      >
        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
        <p className="ant-upload-text">{满了 ? (只图 ? `已经 ${每条最多} 张了，先删掉几张不要的` : `已经 ${每条最多} 个了，先删掉几个不要的`) : 说明 ?? (只图 ? "把产品图片拖到这里，或点一下选图片" : "把文件拖到这里，或点一下选文件")}</p>
        <p className="ant-upload-hint">{只图
          ? <>JPG、PNG、GIF、WebP、BMP 都行；单张最多 {读大小(附件上限字节)}，会先压到长边 {图片长边} 像素再存；{粘贴话}</>
          : <>合同、方案、表格、图片都行；单个最多 {读大小(附件上限字节)}，图片会先压到长边 {图片长边} 像素再存；{粘贴话}</>}</p>
      </Upload.Dragger>
      </div>}

      {列表 === null ? (
        <div style={{ padding: 16, textAlign: "center" }}><Spin /></div>
      ) : (
        <>
          {在传们.length > 0 && (
            <ul className="att-up" aria-label="上传进度">
              {在传们.map((x) => (
                <li key={x.key} className="att-up-row" data-state={x.态}>
                  <span className="att-ring" aria-hidden>
                    <svg viewBox="0 0 20 20"><circle className="att-ring-bg" cx="10" cy="10" r="8" /><circle className="att-ring-fg" cx="10" cy="10" r="8" /></svg>
                    <span className="att-ring-ok">✓</span>
                  </span>
                  <span className="att-up-name" title={x.名}>{x.名}</span>
                  {x.态 === "传" && <span className="muted" role="status">正在传</span>}
                  {x.态 === "成" && <span className="att-up-ok" role="status">传好了</span>}
                  {x.态 === "错" && <span role="alert" className="att-up-err">{x.错}</span>}
                  {x.态 === "错" && <Button size="small" type="text" aria-label="收起这一行" onClick={() => set在传们((y) => y.filter((z) => z.key !== x.key))}>×</Button>}
                </li>
              ))}
            </ul>
          )}
          {块话 && <div role={块话.错 ? "alert" : "status"} className={块话.错 ? "att-said is-err" : "att-said"}>{块话.话}</div>}
          {列表.length === 0 && 传着 === 0 && (小标题 !== undefined
            ? <div className="att-empty-t">还没有附件</div>
            : <div className="muted" style={{ marginTop: 只读 ? 0 : 10 }}>{只图 ? "还没有图片。" : "还没有附件。"}</div>)}
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
                    {可删 && <删按钮 a={a} 删={删} />}
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
                  {可删 && <删按钮 a={a} 删={删} />}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** 删一个附件：就地问一句（InlineConfirm），不弹气泡框 */
function 删按钮({ a, 删 }: { a: 附件; 删: (a: 附件) => Promise<{ ok: boolean; error?: string }> }) {
  return (
    <span className="att-del">
      <InlineConfirm 问="删掉这个？" 是="删掉" 做={() => 删(a)}>
        <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label={`删掉 ${a.name}`} data-testid="attachment-delete" />
      </InlineConfirm>
    </span>
  );
}
