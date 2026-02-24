import { NextResponse } from "next/server";
import { demoStore } from "@/lib/demo-store";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const store = demoStore;
  const { id } = await params;
  // demo 用调试，可后续移除
  console.log("demo publish debug", {
    id,
    taskIds: store.tasks.map((task) => task.id),
  });
  const task = store.publishTask(id);
  if (!task) {
    return NextResponse.json({ message: "任务不存在" }, { status: 404 });
  }
  return NextResponse.json({ task });
}
