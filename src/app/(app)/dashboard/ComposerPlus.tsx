"use client";

import { useRef } from "react";
import { Dropdown } from "antd";
import { PlusOutlined, PaperClipOutlined, IdcardOutlined, CameraOutlined, FileSearchOutlined, GlobalOutlined } from "@ant-design/icons";
import AskFiles, { type 附件 } from "@/components/AskFiles";
import type { Proposal } from "@/lib/agent/proposals";
import { 加号菜单项, type 加号项 } from "@/lib/enterprise/composer-plus";
import CardScanKey from "./CardScanKey";
import DedupeKey from "./DedupeKey";

type 开关 = { 打开: () => void };

const 图: Record<加号项, React.ReactNode> = {
  附件: <PaperClipOutlined />,
  名片: <IdcardOutlined />,
  查重: <FileSearchOutlined />,
  背调: <GlobalOutlined />,
};

/**
 * 企业版项目模式首页的「+」（P15，摆哪几项见 lib/enterprise/composer-plus.ts）。
 * 三个带状态的入口（附件、名片、查重）照旧是原来那三个组件，只是藏起自己的键，由这里的菜单去打开；
 * 选好的文件小签、认名片时的进度提示、查重的小框都跟原来一样。
 */
export default function ComposerPlus({ 宽, 拍照, 在跑, files, setFiles, 摆背调键, on切背调, 渠道名们, on出卡 }: {
  宽: boolean;
  /** 手机：名片改成调相机，文本附件不摆（同原来） */
  拍照: boolean;
  在跑: boolean;
  files: 附件[];
  setFiles: (f: 附件[]) => void;
  摆背调键: boolean;
  on切背调: () => void;
  渠道名们: readonly string[];
  on出卡: (p: Proposal, 摘要: string) => void;
}) {
  const 文件 = useRef<开关>(null);
  const 名片 = useRef<开关>(null);
  const 查重 = useRef<开关>(null);
  const 项 = 加号菜单项({ 摆附件: !拍照, 拍照, 摆背调: 摆背调键 });
  const 点 = (k: 加号项) => {
    // 等菜单收起这一下点击过去再开：查重的小框在同一下点击里打开，会被当成「点了外面」立刻关掉
    setTimeout(() => {
      if (k === "附件") 文件.current?.打开();
      else if (k === "名片") 名片.current?.打开();
      else if (k === "查重") 查重.current?.打开();
      else on切背调();
    }, 0);
  };

  return (
    <>
      <Dropdown
        trigger={["click"]}
        placement="topLeft"
        menu={{
          items: 项.map((x) => ({
            key: x.key,
            label: <span title={x.说明}>{x.label}</span>,
            icon: x.key === "名片" && 拍照 ? <CameraOutlined /> : 图[x.key],
            disabled: 在跑 && (x.key === "附件" || x.key === "名片"),
          })),
          onClick: ({ key }) => 点(key as 加号项),
        }}
      >
        <button type="button" className="cli-tool" aria-label="更多入口" title={项.map((x) => x.label).join("、")}>
          <PlusOutlined />
        </button>
      </Dropdown>
      <DedupeKey 宽={宽} 藏键 开={查重} />
      {!拍照 && <AskFiles files={files} onChange={setFiles} disabled={在跑} 藏键 开={文件} />}
      <CardScanKey 宽={宽} 在跑={在跑} 渠道名们={渠道名们} on出卡={on出卡} 拍照={拍照} 藏键 开={名片} />
    </>
  );
}
