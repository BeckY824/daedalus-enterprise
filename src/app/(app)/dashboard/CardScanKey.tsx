"use client";
/**
 * 企业版首页对话框里的「名片」键（2026-10-27）：选名片照片，认完摆成一张「新建线索」卡（lib/card-scan/lead-card.ts）。
 * 能一次选几张（正反面、同一张拍了几次）：按顺序认，第一张认出字的拿来填卡；选的几张全记下（lib/card-scan/originals.ts），
 * 卡确认、线索或联系人建出来以后全存成它的附件（2026-10-28 联系人附件）
 *
 * 认字和手机扫名片同一套（lib/card-scan/ocr.ts）：先交给服务器认，带登录 cookie（cloud.ts 走网页登录）；
 * 服务器上的模型整理一下格子，没配模型 / 超时就用规则拆的，和手机上没 AI 时一样。
 * 认出来的卡交给对话 Agent（2026-10-28，Composer 出名片卡）：固定提示词，先查公司、联系人撞没撞库，说清还差哪几格，
 * 算一次提问（认字本身不扣）。认字时照片只在这台电脑上缩一下传给自己的服务器，认字那头不存；
 * 原图另走附件接口存到建出来的线索 / 联系人上，卡被忽略或页面刷新就不存
 *
 * 2026-11-01 起一次选的几张图按人分：微信资料页截图（有「微信号」那行）一人一张卡，不过 AI 整理；
 * 有联系方式的名片一人一张卡，同名或同公司的另一面并进去；没认出联系方式的（客户照片、背面标志）挂到前一个人名下，
 * 前面没人就挂给下一个。几张卡一起交给 Agent，查重、问还差什么一次说完
 *
 * 一个人都没认出、这页刚建过一位（先发名片建好，再单发客户照片）：不出卡，问一句存不存到他名下（PhotoSaveCard），点了才传
 *
 * 拍照（10-29 首页改版 待 1）：手机上这颗键叫「附件」，点了直接调后置相机（capture="environment"），
 * 拍到的照片照样走上面这一套认名片；桌面上还是选文件、叫「名片」
 */
import { useImperativeHandle, useRef, useState } from "react";
import { App } from "antd";
import { CameraOutlined, IdcardOutlined, LoadingOutlined } from "@ant-design/icons";
import { useBusiness } from "@/lib/business-client";
import { 字段是公司, 字段是行业 } from "@/lib/lead-convert";
import { 名片转表单, type 名片填法, type 名片表单 } from "@/lib/card-scan/form";
import { 认微信截图, type 微信资料 } from "@/lib/card-scan/wechat";
import { 错的话 } from "@/lib/card-scan/download";
import { 走网页登录, 服务器预热 } from "@/lib/card-scan/cloud";
import { 名片成新线索卡, 微信成新线索卡 } from "@/lib/card-scan/lead-card";
import { 记下名片原图, 名片最多张, 刚建的, 这几张图, type 刚建的人 } from "@/lib/card-scan/originals";
import type { Proposal } from "@/lib/agent/proposals";

/** 一次选的几张图里认出的一个人：一张名片（可带背面）或一张微信资料页截图，加上挂在他名下的照片 */
type 一个人 = { 类: "名片"; 法: 名片填法; 图们: File[] } | { 类: "微信"; 资料: 微信资料; 图们: File[] };

/** 有联系方式，或姓名、公司都有，才算一张名片；只认出几个字的（照片上的挂绳、背面标志）当照片 */
function 像名片(填: 名片表单): boolean {
  return Boolean(填.phone || 填.email || 填.wechat || 填.whatsapp || 填.website || (填.name && 填.school));
}

function 同一人(甲: 名片表单, 乙: 名片表单): boolean {
  const 同 = (x: string, y: string) => Boolean(x.trim()) && x.trim().toLowerCase() === y.trim().toLowerCase();
  return 同(甲.name, 乙.name) || 同(甲.school, 乙.school) || 同(甲.phone, 乙.phone) || 同(甲.email, 乙.email);
}

const 预热 = () => {
  走网页登录();
  void 服务器预热();
  void import("@/lib/card-scan/ocr");
};

export default function CardScanKey({ 宽, 在跑, 渠道名们, on出卡, on存照片, 拍照 = false, 藏键 = false, 开 }: {
  宽: boolean;
  /** 手机上：键叫「附件」，点了调相机，一次拍一张 */
  拍照?: boolean;
  在跑: boolean;
  渠道名们: readonly string[];
  /** 认好了：摆这几张卡（Composer 里新开一轮） */
  on出卡: (ps: Proposal[], 摘要: string) => void;
  /** 图里没认出人、这页刚建过一位：问存不存到他名下（图已按 卡id 记下） */
  on存照片: (卡id: string, 张数: number, 给: 刚建的人) => void;
  /** 不摆自己的键（收进「+」菜单，P15），由 开 去打开选图 / 相机 */
  藏键?: boolean;
  开?: React.Ref<{ 打开: () => void }>;
}) {
  const b = useBusiness();
  const { message } = App.useApp();
  const 选 = useRef<HTMLInputElement>(null);
  const [认着, set认着] = useState(false);
  useImperativeHandle(开, () => ({ 打开: () => { if (!在跑 && !认着) 选.current?.click(); } }), [在跑, 认着]);

  async function 认(图们: File[]) {
    set认着(true);
    const 键 = "home-card-scan";
    const 说 = (话: string) => message.open({ key: 键, type: "loading", content: 话, duration: 0 });
    try {
      预热();
      const { 认名片, AI整理 } = await import("@/lib/card-scan/ocr");
      const 人们: 一个人[] = [];
      let 待挂: File[] = [];
      let 备用: 一个人 | null = null;
      for (const [i, f] of 图们.entries()) {
        const 第几 = 图们.length > 1 ? `第 ${i + 1}/${图们.length} 张 ` : "";
        let r = await 认名片(f, (话, 百分) => 说(`${第几}${百分 != null ? `${话} ${Math.round(百分)}%` : 话}`));
        const 微信 = r.框数 ? 认微信截图(r.框们) : null;
        if (微信) {
          人们.push({ 类: "微信", 资料: 微信, 图们: [...待挂, f] });
          待挂 = [];
          continue;
        }
        let 附加: Parameters<typeof 名片转表单>[2];
        if (r.框数) {
          说(`${第几}正在整理…`);
          const 整 = await AI整理(r, 字段是行业(b.fields.major) ? b.industries : []);
          if (整) { r = { ...r, 字段: 整.字段 }; 附加 = 整.附加; }
        }
        const 法 = 名片转表单(r.字段, b.template === "trade", 附加, 字段是公司(b.fields.school));
        const 填 = 法.填;
        const 上一个 = 人们.at(-1);
        if (r.框数 && 像名片(填)) {
          // 同一张名片的另一面（同名或同公司）并进上一张，不另出卡
          if (上一个?.类 === "名片" && 同一人(上一个.法.填, 填)) { 上一个.图们.push(...待挂, f); 待挂 = []; continue; }
          人们.push({ 类: "名片", 法, 图们: [...待挂, f] });
          待挂 = [];
          continue;
        }
        // 没认出联系方式的（客户照片、名片背面的标志）：挂到前一个人名下，前面没人就等下一个
        if (!备用 && r.框数 && (填.name || 填.school)) 备用 = { 类: "名片", 法, 图们: [] };
        if (上一个) 上一个.图们.push(f);
        else 待挂.push(f);
      }
      // 一张像样的名片都没有：这页刚建过人，问存不存到他名下（后发的客户照片）；
      // 没建过，照旧拿第一张认出姓名或公司的凑一张卡，人在卡上核对
      const 刚建 = 刚建的();
      const 怎么办 = 这几张图(人们.length, Boolean(备用), 刚建);
      if (怎么办 === "存到刚建的" && 刚建) {
        const id = `photo-${Date.now().toString(36)}`;
        记下名片原图(id, 图们);
        message.destroy(键);
        on存照片(id, Math.min(图们.length, 名片最多张), 刚建);
        return;
      }
      if (怎么办 === "备用出卡" && 备用) 人们.push({ ...备用, 图们: 待挂 });
      if (!人们.length) {
        message.open({ key: 键, type: "warning", content: "没认出名片或微信资料。名片横着放、靠近一点、别反光，再拍一张试试；客户照片要和他的名片或微信截图一起选" });
        return;
      }
      const 起 = Date.now().toString(36);
      const 卡们: Proposal[] = [];
      for (const [i, 人] of 人们.entries()) {
        const id = `card-${起}${人们.length > 1 ? i.toString(36) : ""}`;
        const 卡 = 人.类 === "微信" ? 微信成新线索卡(人.资料, b, 渠道名们, id) : 名片成新线索卡(人.法.填, b, 渠道名们, id, new Date(), 人.法.黄);
        if (!卡.ok) continue;
        记下名片原图(id, 人.图们);
        卡们.push(卡.proposal);
      }
      if (!卡们.length) {
        message.open({ key: 键, type: "warning", content: "没认出姓名或公司，换一张清楚点的照片再试" });
        return;
      }
      message.destroy(键);
      on出卡(卡们, 卡们.map((p) => (p.kind === "add_lead" ? [p.name, p.contact].filter(Boolean).join(" · ") : "")).filter(Boolean).join("、"));
    } catch (e) {
      message.open({ key: 键, type: "error", content: 错的话(e).话 });
    } finally {
      set认着(false);
    }
  }

  return (
    <>
      {!藏键 && <button
        type="button"
        className={`cli-tool${宽 ? " cli-tool-t" : ""}`}
        onClick={() => 选.current?.click()}
        onPointerEnter={预热}
        onFocus={预热}
        disabled={在跑 || 认着}
        title={拍照 ? "拍一张名片，认出来摆成一张新建线索卡，核对后确认；照片会存成新线索的附件" : "选名片、微信资料页截图（可以一次选几张，客户照片放在他的名片后面），一个人一张新建线索卡，核对后确认；图会存成附件。框里先打一句「广交会的客户」会一起带上"}
        aria-label={拍照 ? "拍照建线索" : "认名片建线索"}
      >
        {认着 ? <LoadingOutlined /> : 拍照 ? <CameraOutlined /> : <IdcardOutlined />}
        {宽 && <span>{拍照 ? "附件" : "名片"}</span>}
      </button>}
      <input
        ref={选}
        type="file"
        accept="image/*"
        multiple={!拍照}
        capture={拍照 ? "environment" : undefined}
        hidden
        onChange={(e) => {
          const 图们 = [...(e.target.files ?? [])].filter((f) => f.type.startsWith("image/"));
          e.target.value = "";
          if (图们.length > 名片最多张) message.warning(`一次最多 ${名片最多张} 张，只用前 ${名片最多张} 张`);
          if (图们.length) void 认(图们.slice(0, 名片最多张));
        }}
      />
    </>
  );
}
