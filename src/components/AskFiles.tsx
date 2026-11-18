"use client";

import { useImperativeHandle, useRef, useState } from "react";
import { PaperClipOutlined, CloseOutlined, LoadingOutlined } from "@ant-design/icons";
import { 图片后缀, 图片类型, 是图片文件, 认图成文本 } from "@/lib/ask-image";

/**
 * 问一句的时候带上一个文件。
 *
 * **文件不离开这台机器，除了被发给你选的那个模型。** 在浏览器里读成文本，
 * 跟着这一问发出去，不落库、不写磁盘、不进操作日志——所以「我的数据在我自己机器上」
 * 这句话在带文件提问时仍然成立。关掉这一问，内容就没了。
 *
 * 收**文本**：txt / md / csv / tsv / json / log。Excel 和 PDF 不收——
 * 它们要在客户端拖一个解析库进来，而解析出来的东西未必是人以为的那份
 * （合并单元格、多工作表、扫描件），不如让人自己另存成 csv，至少他知道发出去的是什么。
 *
 * 也收**图**（png / jpg / webp / bmp，2026-11-17 员工反馈「附件不支持截图」）：模型只收文字，
 * 所以图先过名片识别那套 OCR（lib/ask-image.ts），认出的字当这份附件的文本。图只在识别时传到自己的服务器，服务器认完就丢；
 * 原件留在这台电脑的内存里（附件.原件），这一问建新线索时人可以勾选存成附件（11-18）
 */
export type 附件 = {
  name: string; text: string; size: number; 图?: boolean;
  /**
   * 图的原件（11-18 员工反馈「录入的时候添加不了截图」）：只在这台电脑的内存里，不发给模型、不进对话记录。
   * 这一问出了新线索卡、人在卡上勾了「存成这条线索的附件」，确认时才传成新线索首条沟通的附件（lib/card-scan/originals.ts 对话截图）
   */
  原件?: File;
};

/** 单个文件的文本上限。再大就不是「带一份名单问一句」，而是拿模型当数据库用 */
const 单文件上限 = 100 * 1024;
const 可读后缀 = [".txt", ".md", ".csv", ".tsv", ".json", ".log"];

export const 不认的话 = `只认文本文件（${可读后缀.join(" ")}）和图片（${图片后缀.join(" ")}）。Excel 请另存成 csv 再来`;

/** 读一个文件：文本照读；图先认出里面的字（进 = 识别中的进度话）。名 = 给它起的名字（粘的截图），不给用文件自己的 */
export async function 读一个(f: File, 设: { 进?: (话: string) => void; 名?: string } = {}): Promise<{ 附件: 附件; 提示?: string } | { 错: string }> {
  const name = 设.名 ?? f.name;
  if (是图片文件(f)) {
    const r = await 认图成文本(f, 设.进 ?? (() => undefined));
    return "错" in r ? r : { 附件: { name, text: r.text, size: f.size, 图: true, 原件: name === f.name ? f : new File([f], name, { type: f.type }) }, ...(r.提示 ? { 提示: r.提示 } : {}) };
  }
  const 后缀 = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
  if (!可读后缀.includes(后缀)) return { 错: 不认的话 };
  if (f.size > 单文件上限) return { 错: `文件太大（${Math.round(f.size / 1024)} KB），上限 ${单文件上限 / 1024} KB` };
  try {
    return { 附件: { name, text: await f.text(), size: f.size } };
  } catch {
    return { 错: "这个文件读不出来" };
  }
}

/** 「image.jpg」已经带着了：叫「image-2.jpg」，再有就 -3… */
export function 不重名(名: string, files: 附件[]): string {
  if (!files.some((x) => x.name === 名)) return 名;
  const 点 = 名.lastIndexOf(".");
  const [头, 尾] = 点 > 0 ? [名.slice(0, 点), 名.slice(点)] : [名, ""];
  for (let i = 2; ; i++) if (!files.some((x) => x.name === `${头}-${i}${尾}`)) return `${头}-${i}${尾}`;
}

/** 并进已带的那几个里（同名的换掉，不叠加：重选一次多半是因为选错了） */
export const 并进 = (files: 附件[], a: 附件): 附件[] => [...files.filter((x) => x.name !== a.name), a];

/**
 * 把一个文件读成附件、并进已带的那几个里。
 * 回形针选文件、拖进输入框（首页 home.ask）、框里粘截图走的是这同一个，后缀、大小的规矩只写一份
 */
export async function 读成附件(f: File, files: 附件[], 设: { 进?: (话: string) => void; 名?: string } = {}): Promise<{ files: 附件[]; 提示?: string } | { 错: string }> {
  const r = await 读一个(f, 设);
  return "错" in r ? r : { files: 并进(files, r.附件), ...(r.提示 ? { 提示: r.提示 } : {}) };
}

export default function AskFiles({
  files,
  onChange,
  disabled,
  字,
  藏键 = false,
  开,
  只收图 = false,
}: {
  files: 附件[];
  onChange: (f: 附件[]) => void;
  disabled?: boolean;
  /** 键上带的字（企业版项目模式首页叫「附件」，和背调、查重并排）；不给 = 只有图标 */
  字?: string;
  /** 不摆自己的键（企业版首页收进「+」菜单，P15）：只留选好的文件小签，由 开 去打开选文件框 */
  藏键?: boolean;
  开?: React.Ref<{ 打开: () => void }>;
  /**
   * 只收图、可多选（手机「+」里的「截图 / 图片」，11-18）：从相册选，不加 capture，不强制调相机。
   * 写明具体图片类型（不写 image/*）：iPhone 相册里的 HEIC 照片会被系统转成 JPEG 再交过来，认图那边认得
   */
  只收图?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [读取中, set读取中] = useState(false);
  /** 认图里的字时的进度话（role=status，摆在文件签那一排）；读文本文件一下就好，不出 */
  const [进度, set进度] = useState<string | null>(null);
  /** 认成了但要说一句的（长图只认了前一部分）：一枚普通小签，✕ 收 */
  const [提示, set提示] = useState("");
  /** 选的文件读不了（太大、不是文本）：原因作为一枚红色小签摆在文件签那一排，点 ✕ 收；不弹顶部提示（原型 g.notice） */
  const [错, set错] = useState("");
  useImperativeHandle(开, () => ({ 打开: () => { if (!disabled && !读取中) input.current?.click(); } }), [disabled, 读取中]);

  async function 选好了(list: FileList | null) {
    if (!list?.length) return;
    set读取中(true);
    try {
      set错("");
      set提示("");
      // 只收图时一次可选几张：一张张认、并进同一份（认字慢，并发几张会卡手机）；电脑上照旧一次一个
      let 现有 = files;
      for (const f of 只收图 ? [...list] : [list[0]]) {
        // 手机相册一次选几张，名字常常一样（image.jpg）：同名的后面补个序号，别互相顶掉
        const r = await 读成附件(f, 现有, { 进: set进度, ...(只收图 ? { 名: 不重名(f.name, 现有) } : {}) });
        if ("错" in r) { set错(r.错); continue; }
        现有 = r.files;
        onChange(现有);
        if (r.提示) set提示(r.提示);
      }
    } finally {
      set进度(null);
      set读取中(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept={(只收图 ? [...图片后缀, ...图片类型] : [...可读后缀, ...图片后缀]).join(",")}
        multiple={只收图}
        style={{ display: "none" }}
        onChange={(e) => 选好了(e.target.files)}
      />
      {!藏键 && <button
        type="button"
        className={`cli-tool${字 ? " cli-tool-t" : ""}`}
        disabled={disabled || 读取中}
        onClick={() => input.current?.click()}
        title="带一个文本文件（txt / md / csv / tsv / json / log）或一张截图问。图里的字认出来随这一问发给模型，内容不会存下来"
        aria-label="添加文件"
      >
        <PaperClipOutlined />
        {字 && <span>{字}</span>}
      </button>}
      {进度 && (
        <span className="cli-file" role="status">
          <LoadingOutlined aria-hidden />
          <span className="cli-file-n" title={进度}>{进度}</span>
        </span>
      )}
      {提示 && (
        <span className="cli-file" role="note">
          <span className="cli-file-n" title={提示}>{提示}</span>
          <button type="button" aria-label="知道了" onClick={() => set提示("")}>
            <CloseOutlined />
          </button>
        </span>
      )}
      {错 && (
        <span className="cli-file cli-file-bad" role="alert">
          <span className="cli-file-n" title={错}>{错}</span>
          <button type="button" aria-label="知道了" onClick={() => set错("")}>
            <CloseOutlined />
          </button>
        </span>
      )}
      {files.map((f) => (
        <span key={f.name} className="cli-file" title={`${f.name} · ${Math.round(f.size / 1024) || 1} KB · ${f.图 ? "图里认出的字只随这一问发给模型；这一问建了新线索的，可以在卡上把原图存成它的附件" : "只随这一问发出，不会存下来"}`}>
          <span className="cli-file-n">{f.name}</span>
          <button type="button" aria-label={`移除 ${f.name}`} onClick={() => onChange(files.filter((x) => x.name !== f.name))}>
            <CloseOutlined />
          </button>
        </span>
      ))}
    </>
  );
}
