"use client";

/**
 * 企业版客户页联系人小卡上的「附件」一行（2026-10-28 联系人附件）：名片原图、和这位联系人有关的图片。
 * 一行只写几张，点开是一个弹窗，里面就是商机 / 订单用的那个附件区（缩略图、看原图、上传、删除）。
 * 只读的客户（同事的、虚线下属的）只能看：没有就写「无」不给点；服务端也会拒（api/attachments/access.ts）
 */
import { useState } from "react";
import { Button, Modal } from "antd";
import AttachmentsPanel from "@/components/AttachmentsPanel";
import type { 附件分类 } from "@/lib/enterprise/customer-v2";

/** 分类：企业版联系人附件的一格（名片 / 相册，2026-10-29）；不给 = 不分格（项目详情页那边照旧） */
type 入口参数 = { contactId: string; 名字: string; 起始个数: number; 只读: boolean; 分类?: 附件分类 };

/**
 * 只是「N 张 / 添加名片或图片」那个入口和弹窗，不带外面那一行（2026-10-28）：项目详情页联系人那一行下面也用它，
 * 那边的行样式是项目卡自己的
 */
export function ContactAttachmentsButton({ contactId, 名字, 起始个数, 只读, 分类 }: 入口参数) {
  const [开, set开] = useState(false);
  const [个数, set个数] = useState(起始个数);
  if (只读 && 个数 === 0) return <span className="rec-field-empty">无</span>;
  return (
    <>
      <Button type="link" size="small" style={{ padding: 0, height: "auto", fontSize: "inherit" }} onClick={() => set开(true)} aria-label={`${名字} 的附件`}>
        {个数 ? `${个数} 张` : 分类 === "名片" ? "添加名片" : 分类 === "相册" ? "添加图片" : "添加名片或图片"}
      </Button>
      <Modal
        open={开}
        onCancel={() => set开(false)}
        footer={null}
        // 弹窗标题里的名字可能很长：截断，悬停看全名
        title={<span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 24 }} title={名字}>{`${分类 ?? "联系人附件"} · ${名字}`}</span>}
        width={640}
        destroyOnHidden
      >
        <AttachmentsPanel
          归属={{ contactId }}
          只读={只读}
          分类={分类}
          说明={分类 === "名片" ? "把名片拖到这里，或点一下选图片" : 分类 === "相册" ? "把这位联系人相关的图片拖到这里，或点一下选图片" : "把名片或这位联系人相关的图片拖到这里，或点一下选图片"}
          on个数={set个数}
        />
      </Modal>
    </>
  );
}

export default function ContactAttachments(p: 入口参数) {
  return (
    <div className="rec-contact-line">
      <span className="rec-contact-k">{p.分类 ?? "附件"}</span>
      <ContactAttachmentsButton {...p} />
    </div>
  );
}
