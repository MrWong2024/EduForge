import type { Metadata } from "next";
import { PublicHome } from "@/components/public/PublicHome";

export const metadata: Metadata = {
  title: { absolute: "EduForge · 智炼｜AI 协作编程教学" },
  description:
    "面向 AI 协作编程的教学平台。围绕编程任务，连接作品与独立说明、AI 辅助反馈、教师评阅和教学复盘。",
};

export default function Home() {
  return <PublicHome />;
}
