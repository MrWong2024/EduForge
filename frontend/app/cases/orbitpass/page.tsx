import type { Metadata } from "next";
import { OrbitPassCase } from "@/components/public/OrbitPassCase";

export const metadata: Metadata = {
  title: "OrbitPass｜大会席位预约",
  description:
    "从最后一个席位出发，审查 AI 初稿中的并发窗口，理解安全重试、原子写入与数据一致性的验收依据。",
};

export default function OrbitPassPage() {
  return <OrbitPassCase />;
}
