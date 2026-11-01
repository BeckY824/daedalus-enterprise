"use client";

/**
 * 「存到「X」名下」卡（2026-11-01，后发的客户照片）：先发名片建好客户，再单发一张客户照片，
 * 图里没认出人就摆这张卡（CardScanKey → Composer 问存照片 → TurnView）。点了才传，传成联系人附件（相册）；
 * 不存就丢掉内存里那几张。图只在内存里：刷新过页面图就没了，卡上直说去哪补传
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckOutlined, CloseOutlined } from "@ant-design/icons";
import { 取走名片原图, 逐张存 } from "@/lib/card-scan/originals";
import { 传附件 } from "@/lib/attachment-upload";
import type { Turn } from "@/lib/home-thread";

type 存法 = NonNullable<Turn["存照片"]>;

/** 存完 / 不存 记在模块里：切页再回来卡不会又变回「要不要存」（那时图已经取走了） */
const 结果们 = new Map<string, { 存了: number; 错: string[] } | "不存">();

export default function PhotoSaveCard({ 存照片 }: { 存照片: 存法 }) {
  const router = useRouter();
  const { 卡id, 张数, 名, 去处 } = 存照片;
  const [结果, set结果] = useState(() => 结果们.get(卡id));
  const [存着, set存着] = useState(false);
  const 到哪补 = "contactId" in 去处 ? "到客户的联系人上点「附件」补传" : "到线索页编辑这条线索补传";

  function 记(r: { 存了: number; 错: string[] } | "不存") {
    结果们.set(卡id, r);
    set结果(r);
  }

  async function 存() {
    set存着(true);
    const 图们 = 取走名片原图(卡id);
    if (!图们.length) {
      set存着(false);
      记({ 存了: 0, 错: ["图已经不在了（页面刷新过）"] });
      return;
    }
    const 挂在 = "contactId" in 去处 ? { contactId: 去处.contactId } : { leadId: 去处.leadId };
    const r = await 逐张存(图们, (f) => 传附件(挂在, f, "contactId" in 去处 ? "相册" : null));
    set存着(false);
    记(r);
    if (r.存了) router.refresh();
  }

  if (结果 === "不存") {
    return <div className="prop prop-done"><span className="prop-done-t">没存，这 {张数} 张照片已丢掉</span></div>;
  }
  if (结果) {
    const 全错 = 结果.存了 === 0;
    return (
      <div className="prop prop-done">
        {!全错 && <span className="prop-seal"><CheckOutlined /> 已存</span>}
        <span className="prop-done-t">
          {全错
            ? `照片没存上：${结果.错[0]}。${到哪补}`
            : 结果.错.length
              ? `${结果.存了 + 结果.错.length} 张存了 ${结果.存了} 张到「${名}」名下，${结果.错.length} 张没存上（${结果.错[0]}）。${到哪补}`
              : `${结果.存了} 张照片存到「${名}」名下`}
        </span>
      </div>
    );
  }
  return (
    <div className="prop">
      <div className="prop-h">
        <span className="prop-tag">照片</span>
        <span className="prop-t">存到「{名}」名下？</span>
      </div>
      <div className="prop-why">这页刚建的是「{名}」。{张数} 张图存成「{名}」的附件；不是这位就点「不存」，到对应的客户上传附件</div>
      <div className="prop-foot">
        <button type="button" className="prop-ok" onClick={存} disabled={存着}>
          <CheckOutlined /> {存着 ? "存着…" : `存到「${名}」名下`}
        </button>
        <button
          type="button"
          className="prop-no"
          disabled={存着}
          onClick={() => {
            取走名片原图(卡id);
            记("不存");
          }}
        >
          <CloseOutlined /> 不存
        </button>
      </div>
    </div>
  );
}
