import type { Metadata } from "next";
import { FramePilotCase } from "@/components/public/FramePilotCase";

export const metadata: Metadata = {
  title: "FramePilot｜智能视频剪辑工作台",
  description:
    "沿双时间轴审查字幕裁切、重排和拼接的时间映射，用交集规则与固定验收预期解释边界和重复片段。",
};

export default function FramePilotPage() {
  return <FramePilotCase />;
}
