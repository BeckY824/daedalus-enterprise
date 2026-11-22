"use client";

import { useEffect, useState } from "react";
import { Button, Radio, Switch } from "antd";
import { useSettingsNote } from "./InlineNote";
import { 读转写设置, 设录音点评开关, 设大文件交法, 测转写连接 } from "./asr-actions";
import type { 转写设置概况 } from "@/lib/enterprise/coach-rec-asr-settings";
import { 录音目录上限字节, 草稿保留天, 音频保留天 } from "@/lib/enterprise/coach-rec";

const 读GB = (字节: number) => (字节 >= 1024 ** 3 ? `${(字节 / 1024 ** 3).toFixed(1)}GB` : `${Math.round(字节 / 1024 ** 2)}MB`);

const 密钥话: Record<转写设置概况["密钥"], string> = {
  已配置: "已配置（服务器环境）",
  未配置: "未配置：要在服务器上写好腾讯云密钥再重启",
  解不开: "解不开：服务器换过 auth-secret，要重新写一次密钥",
  假通道: "假通道（测试用，不连腾讯云）",
};

/**
 * 设置 → AI 接入 →「语音转文字」（企业版，11-22 录音点评 PR4）：录音点评把录音交给腾讯云录音文件识别转成文字。
 * 只显示状态，**不提供密钥输入框**（密钥只在服务器环境里，方案 §4.5）；系统管理员能开关、选大文件怎么交、测试连接（两条路都测）。
 * 开关：开了以后客户页「发起点评」里才有「传录音文件」、待提交的录音才能「提交整理」；要密钥在、ffmpeg 自检过才打得开
 */
export default function AsrCard() {
  const [就地, 提示条] = useSettingsNote();
  const [概况, set概况] = useState<转写设置概况 | null>(null);
  const [忙, set忙] = useState<"开关" | "交法" | "测" | null>(null);

  useEffect(() => {
    let 还在 = true;
    // 不是企业版回 null；回的不像概况（没有 密钥）的也当没有，不画这一块
    读转写设置().then((r) => { if (还在 && r && typeof r === "object" && "密钥" in r) set概况(r); }).catch(() => {});
    return () => {
      还在 = false;
    };
  }, []);

  if (!概况) return null;
  const 齐了 = (概况.密钥 === "已配置" || 概况.密钥 === "假通道") && 概况.ffmpeg.ok;
  const 打不开 = !概况.开 && !齐了;

  const 包 = async <T extends { ok: true }>(哪个: "开关" | "交法" | "测", 做: () => Promise<T | { ok: false; error: string }>, 成: (r: T) => void) => {
    set忙(哪个);
    try {
      const r = await 做();
      if (!r.ok) return void 就地.error(r.error);
      成(r);
    } catch {
      就地.error("没成功，刷新页面再试");
    } finally {
      set忙(null);
    }
  };

  const 上次 = 概况.上次测试;
  return (
    <div className="mcp-block" data-testid="asr-card">
      {提示条}
      <h4>
        语音转文字（录音点评）
        <Switch
          checked={概况.开}
          loading={忙 === "开关"}
          disabled={!概况.能改 || 打不开}
          title={打不开 ? "密钥、ffmpeg 都好了才能打开" : undefined}
          onChange={(开) => void 包("开关", () => 设录音点评开关(开), (r) => { set概况(r.概况); 就地.success(开 ? "录音点评已打开" : "录音点评已关掉"); })}
          className="asr-switch"
          checkedChildren="开"
          unCheckedChildren="关"
          aria-label="录音点评"
        />
      </h4>
      <p>
        录音点评传上来的录音交给<b>腾讯云录音文件识别</b>转成文字（带说话人），再整理成点评草稿给录的人确认。
        打开后客户页「发起点评」里多一项「传录音文件」。录音只在这台服务器和腾讯云之间传，不进 AI 助手、导出和搜索。
      </p>
      <dl className="asr-status">
        <dt className="muted">腾讯云密钥</dt>
        <dd data-testid="asr-key">{密钥话[概况.密钥]}</dd>
        <dt className="muted">录音处理（ffmpeg）</dt>
        <dd>{概况.ffmpeg.话}</dd>
        <dt className="muted">站点地址</dt>
        <dd>{概况.配了地址 ? "已配置（大文件可以给腾讯云签名下载地址）" : "没配 ENT_PUBLIC_URL：大文件只能切段提交"}</dd>
        <dt className="muted">录音存储</dt>
        <dd data-testid="asr-storage" className={概况.存储.满了 ? "asr-full" : undefined}>
          录音占 {读GB(概况.存储.用了)}（上限 {读GB(录音目录上限字节)}）{概况.存储.剩 !== null ? `，磁盘还剩 ${读GB(概况.存储.剩)}` : ""}
          {概况.存储.满了 ? `：空间不够了，现在不能录新的、传文件。清掉服务器上别的大文件，或者等过期的录音自动删（草稿 ${草稿保留天} 天、音频 ${音频保留天} 天）` : ""}
        </dd>
      </dl>
      <div className="asr-big">
        <span>大文件（规整后超过约 3.6MB）怎么交给腾讯云</span>
        <Radio.Group
          value={概况.交法}
          disabled={!概况.能改 || 忙 === "交法"}
          onChange={(e) => void 包("交法", () => 设大文件交法(e.target.value), (r) => { set概况(r.概况); 就地.success("已保存"); })}
          options={[
            { value: "签名地址", label: "签名下载地址（腾讯云来取，说话人整条统一编号）" },
            { value: "切段", label: "切段提交（每段 3.6MB 以下，说话人各段各编号）" },
          ]}
        />
        <span className="mcp-hint">「测试连接」里签名地址那条不通时（腾讯云取不了这台服务器的地址），改成切段提交。</span>
      </div>
      <Button
        onClick={() => void 包("测", () => 测转写连接(), (r) => { set概况(r.概况); 就地.success("测完了，结果在下面"); })}
        loading={忙 === "测"}
        disabled={!概况.能改 || !齐了}
        title={!齐了 ? "密钥、ffmpeg 都好了才能测" : undefined}
      >
        测试连接
      </Button>
      <span className="mcp-hint asr-test-hint">用一段 3 秒的样例音频（不是业务数据）走两条路各交一次，最多等 45 秒</span>
      {上次 && (
        <div className="asr-last" data-testid="asr-last-test">
          <div className="muted">上次测试：{new Date(上次.at).toLocaleString("zh-CN", { hour12: false })}</div>
          <div>请求体（小文件）：{上次.请求体.ok ? "✓ " : "✗ "}{上次.请求体.话}</div>
          <div>签名下载地址（大文件）：{上次.签名地址.ok ? "✓ " : "✗ "}{上次.签名地址.话}</div>
        </div>
      )}
      {!概况.能改 && <p className="mcp-hint">只有系统管理员能改（切换视图时只读）。</p>}
    </div>
  );
}
