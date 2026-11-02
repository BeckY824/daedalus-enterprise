"use client";

import FavoriteStar from "@/components/FavoriteStar";
import { 切换收藏 } from "../../favorites";

/** 客户记录页名字旁边的星：进左栏「收藏的客户」 */
export default function StarButton({ customerId, 初值 }: { customerId: string; 初值: boolean }) {
  return <FavoriteStar 初值={初值} 切换={() => 切换收藏(customerId)} />;
}
