"use client";

import FavoriteStar from "@/components/FavoriteStar";
import { 切换项目收藏 } from "../../favorites";

/** 项目详情页名字旁边的星：进左栏「收藏的项目」 */
export default function ProjectStarButton({ projectId, 初值 }: { projectId: string; 初值: boolean }) {
  return <FavoriteStar 初值={初值} 切换={() => 切换项目收藏(projectId)} />;
}
