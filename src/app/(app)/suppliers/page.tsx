import { notFound } from "next/navigation";

/**
 * 供应商档案页 2026-10-28 已删（企业版到不了）。这一页只留一个 404：
 * 排版闸门（e2e-layout/排版闸门.spec.ts）和网页对桌面（e2e-parity）还按清单访问 /suppliers，
 * 在 (app) 里 notFound() 才带着 AI 栏，闸门的「AI栏常驻」不会红；那两份清单去掉 /suppliers 之后这个文件一起删。
 */
export default function SuppliersPage() {
  notFound();
}
