"use client";
/**
 * 企业版首页对话框里的「名片」键（2026-10-27）：选一张名片照片，认完摆成一张「新建线索」卡（lib/card-scan/lead-card.ts）。
 *
 * 认字和手机扫名片同一套（lib/card-scan/ocr.ts）：先交给服务器认，带登录 cookie（cloud.ts 走网页登录）；
 * 服务器上的模型整理一下格子，没配模型 / 超时就用规则拆的，和手机上没 AI 时一样。
 * 不调对话模型、不扣问答次数。照片只在这台电脑上缩一下传给自己的服务器认字，不存
 */
import { useRef, useState } from "react";
import { App } from "antd";
import { IdcardOutlined, LoadingOutlined } from "@ant-design/icons";
import { useBusiness } from "@/lib/business-client";
import { 字段是公司, 字段是行业 } from "@/lib/lead-convert";
import { 名片转表单 } from "@/lib/card-scan/form";
import { 错的话 } from "@/lib/card-scan/download";
import { 走网页登录, 服务器预热 } from "@/lib/card-scan/cloud";
import { 名片成新线索卡 } from "@/lib/card-scan/lead-card";
import type { Proposal } from "@/lib/agent/proposals";

const 预热 = () => {
  走网页登录();
  void 服务器预热();
  void import("@/lib/card-scan/ocr");
};

export default function CardScanKey({ 宽, 在跑, 渠道名们, on出卡 }: {
  宽: boolean;
  在跑: boolean;
  渠道名们: readonly string[];
  /** 认好了：摆这张卡（Composer 里新开一轮） */
  on出卡: (p: Proposal, 摘要: string) => void;
}) {
  const b = useBusiness();
  const { message } = App.useApp();
  const 选 = useRef<HTMLInputElement>(null);
  const [认着, set认着] = useState(false);

  async function 认(f: File) {
    set认着(true);
    const 键 = "home-card-scan";
    const 说 = (话: string) => message.open({ key: 键, type: "loading", content: 话, duration: 0 });
    try {
      预热();
      const { 认名片, AI整理 } = await import("@/lib/card-scan/ocr");
      let r = await 认名片(f, (话, 百分) => 说(百分 != null ? `${话} ${Math.round(百分)}%` : 话));
      说("正在整理…");
      const 整 = await AI整理(r, 字段是行业(b.fields.major) ? b.industries : []);
      if (整) r = { ...r, 字段: 整.字段 };
      const { 填 } = 名片转表单(r.字段, b.template === "trade", 整?.附加, 字段是公司(b.fields.school));
      if (!r.框数 || (!填.name && !填.school && !填.phone && !填.email)) {
        message.open({ key: 键, type: "warning", content: "没认出字。名片横着放、靠近一点、别反光，再拍一张试试" });
        return;
      }
      const 卡 = 名片成新线索卡(填, b, 渠道名们, `card-${Date.now().toString(36)}`);
      if (!卡.ok) {
        message.open({ key: 键, type: "warning", content: 卡.error });
        return;
      }
      message.destroy(键);
      on出卡(卡.proposal, [卡.proposal.name, 卡.proposal.contact, 卡.proposal.phone].filter(Boolean).join(" · "));
    } catch (e) {
      message.open({ key: 键, type: "error", content: 错的话(e).话 });
    } finally {
      set认着(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={`cli-tool${宽 ? " cli-tool-t" : ""}`}
        onClick={() => 选.current?.click()}
        onPointerEnter={预热}
        onFocus={预热}
        disabled={在跑 || 认着}
        title="选一张名片照片，认出来摆成一张新建线索卡，核对后确认"
        aria-label="认名片建线索"
      >
        {认着 ? <LoadingOutlined /> : <IdcardOutlined />}
        {宽 && <span>名片</span>}
      </button>
      <input
        ref={选}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void 认(f);
        }}
      />
    </>
  );
}
