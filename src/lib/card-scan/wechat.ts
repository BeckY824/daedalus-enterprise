/**
 * 微信资料页截图（2026-11-01）：销售在展会加了好友，截一张对方的资料页发到首页对话框。
 * 认字和名片同一套（ocr.ts），这里只看认出的行：有「微信号」那一行就当微信截图，不当名片拆。
 *
 *   名字 ← 「微信号」上面字最大的那行（昵称或销售改过的备注名）；「Babs | Canada」这种拆开，后半是国家就当国家线索
 *   微信号 ← 「微信号：」后面那串（同一行没写就看下一个框）
 *   国家、城市 ← 「地区：加拿大 多伦多」，国家认不出就空着（卡上标待确认，不猜）
 * 手机状态栏（14:03、5G、电量）、按钮（发消息、音视频通话……）都不进
 */
import { 排好的行, type 框 } from "./parse";
import { 国家反查, 找国家 } from "./form";

export type 微信资料 = {
  /** 卡上的名称：昵称拆掉装饰和国家后的那段 */
  名字: string;
  /** 截图上原样的昵称（拆过才和名字不一样） */
  昵称: string;
  微信号: string;
  /** 中文叫法；认不出 = "" */
  国家: string;
  城市: string;
  /** 国家是从昵称里猜的（地区没写），要人确认 */
  国家靠猜: boolean;
  /** 昵称拆过（去了装饰、国家），名字要人确认 */
  名字拆过: boolean;
};

const 微信号行 = /^(微信号|微信號|WeChat\s*ID|Weixin\s*ID)\s*[:：]?\s*(.*)$/i;
const 地区行 = /^(地区|地區|Region)\s*[:：]?\s*(.*)$/i;
const 像微信号 = /^[A-Za-z][-_A-Za-z0-9]{3,40}$/;
const 不是名字 = /^(\d{1,2}[:：]\d{2}|[<‹←].*|[345]G|LTE|\d+%|.*(发消息|音视频通话|朋友圈|备注和标签|添加到通讯录|更多信息|视频号|个性签名|来源|Messages|Moments|Add to Contacts)$)/i;

export function 认微信截图(框们: 框[]): 微信资料 | null {
  const 行们 = 排好的行(框们);
  const i = 行们.findIndex((l) => 微信号行.test(l.text.trim()));
  if (i < 0) return null;
  const 号 = (微信号行.exec(行们[i].text.trim())?.[2] || 行们[i + 1]?.text || "").trim().split(/\s+/)[0] ?? "";
  if (!像微信号.test(号)) return null;

  // 名字：微信号那一行上面、字最大的一行（同样大取靠近微信号的）
  const 上面 = 行们.slice(0, i).filter((l) => l.text.trim().length >= 2 && !不是名字.test(l.text.trim()) && !/^昵称/.test(l.text.trim()));
  const 大 = 上面.reduce<框 | null>((最, l) => (!最 || l.h >= 最.h ? l : 最), null);
  const 昵称 = (大?.text ?? "").trim();
  // 去掉表情、旗子（OCR 认成的乱码）两头的符号；按 | ｜ / 拆开，是国家的那段当国家线索
  const 段们 = 昵称.split(/\s*[|｜/／·•]\s*/).map((x) => x.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.]+$/gu, "").trim()).filter(Boolean);
  const 昵称国家 = 段们.map((x) => 国家反查(x)).find(Boolean) ?? null;
  const 名段 = 段们.find((x) => !国家反查(x)) ?? "";

  // 地区：「加拿大 多伦多」「Canada Toronto」「Pakistan」；值在下一个框里也认
  const j = 行们.findIndex((l) => 地区行.test(l.text.trim()));
  const 地区 = j < 0 ? "" : (地区行.exec(行们[j].text.trim())?.[2] || (行们[j + 1] && !微信号行.test(行们[j + 1].text) ? 行们[j + 1].text : "")).trim();
  const 找 = 找国家(地区);
  const 国家 = 找?.国家 ?? 昵称国家 ?? "";
  const 城市 = 找 ? (地区.slice(0, 找.位) + " " + 地区.slice(找.位 + 找.长)).replace(/\s+/g, " ").trim() : "";

  return {
    名字: 名段,
    昵称,
    微信号: 号,
    国家,
    城市: 城市.slice(0, 40),
    国家靠猜: !找 && Boolean(昵称国家),
    名字拆过: 名段 !== 昵称,
  };
}
