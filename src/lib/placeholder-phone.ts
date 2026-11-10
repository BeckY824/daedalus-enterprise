/**
 * 占位假号（M-导入-36、P-全局-06）：全同数字（11111111111、00000000）、一小段前缀后面一串 0（13800000000）、
 * 顺序数字（12345、987654321，9 接 0 也算）。
 *
 * 导入：不写进电话、不参与查重（clean.ts）；新建 / 编辑客户、联系人、AI 建档、录线索：拦下、叫人填真实号码。
 * 两头共用这一个函数，纯函数，浏览器和服务端都能用。
 *
 * 只认「整串都是」的：中间夹着几个 0 的真号（13900000001）、带字母的（微信号）、不足 5 位的都不算。
 * 带分机的看主号；+86 / 0086 国家码不算进去。
 */
import { 全角数字转半角 } from "./fullwidth";


const 分机 = /(?:转|分机|ext\.?|x|#)\s*\d{1,6}\s*$/i;

/** 是不是占位假号。空的、带字母或汉字的、不足 5 位的都返回 false */
export function 是占位号(v: string | null | undefined): boolean {
  if (!v) return false;
  let s = 全角数字转半角(String(v))
    .replace(/＋/g, "+")
    .trim();
  s = s.replace(分机, "");
  if (/[A-Za-z㐀-鿿]/.test(s)) return false;
  let d = s.replace(/\D/g, "");
  d = d.replace(/^(?:00)?86(?=\d{11}$)/, "");
  if (d.length < 5) return false;
  if (/^(\d)\1+$/.test(d)) return true;
  if (/^\d{1,4}0{7,}$/.test(d)) return true;
  return 顺序(d, 1) || 顺序(d, -1);
}

function 顺序(d: string, 步: 1 | -1): boolean {
  for (let i = 1; i < d.length; i++) {
    if (Number(d[i]) !== (Number(d[i - 1]) + 步 + 10) % 10) return false;
  }
  return true;
}

/** 拦下时给人看的话 */
export function 占位号提示(标签: string): string {
  return `${标签}是占位号码（全同数字、一串 0 或顺序数字），请填写真实号码`;
}
