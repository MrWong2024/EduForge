import { NextResponse } from "next/server";
import { demoStore } from "@/lib/demo-store";

export async function GET(request: Request) {
  const store = demoStore;
  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get("taskId");
  if (!taskId) {
    return NextResponse.json({ message: "taskId 必填" }, { status: 400 });
  }
  const report = store.getCommonIssuesReport(taskId);
  return NextResponse.json({ report });
}
