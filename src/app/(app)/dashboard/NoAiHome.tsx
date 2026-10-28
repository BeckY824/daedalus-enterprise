"use client";

import { useRouter } from "next/navigation";
import { Button } from "antd";
import { ApiOutlined } from "@ant-design/icons";
import type { 满额提醒 } from "@/lib/enterprise/lead-full-notice";
import LeadFullNotices from "../leads/LeadFullNotices";

/**
 * 企业版项目、但还没配 AI 时的首页（2026-10-26 用户定：首页改成对话框，和桌面端首页一样）。
 *
 * 原来没配 AI 时首页是老数据看板（Board，10-28 删了）：它和「数据」页是同一份东西，
 * 用户说过两处重复。首页的位置留给对话，
 * 这里只说一句「AI 还没配，配好就能问」，再给三个最常去的入口。
 */
export default function NoAiHome({ 管理员, 满额提醒 = [] }: { 管理员: boolean; 满额提醒?: 满额提醒[] }) {
  const router = useRouter();
  return (
    <>
      <LeadFullNotices 提醒={满额提醒} />
      <h1 className="start-h">首页</h1>
      <div className="start">
        <span className="start-badge">AI 未配置</span>
        <div className="start-t">配好 AI，这里就能直接问项目进展</div>
        <p className="start-s">
          {管理员
            ? "在 设置 → AI 接入 填好模型，首页就是对话框：问哪些项目卡住了、让它记一笔跟进。"
            : "请找管理员在 设置 → AI 接入 填好模型。配好之前，项目、新线索、客户照常在左栏里用。"}
        </p>
        <div className="start-a">
          {管理员 && (
            <Button type="primary" icon={<ApiOutlined />} onClick={() => router.push("/settings?tab=ai")}>
              去配置 AI
            </Button>
          )}
          <Button type={管理员 ? "default" : "primary"} onClick={() => router.push("/projects")}>
            看项目
          </Button>
          <Button onClick={() => router.push("/leads")}>新线索</Button>
          <Button onClick={() => router.push("/customers")}>客户</Button>
        </div>
      </div>
    </>
  );
}
