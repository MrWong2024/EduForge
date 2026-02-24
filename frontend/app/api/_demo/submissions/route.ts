import { NextResponse } from "next/server";
import { demoStore } from "@/lib/demo-store";

export async function GET(request: Request) {
  const store = demoStore;
  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get("taskId");
  const studentId = searchParams.get("studentId");
  const submissions = store.getSubmissions({ taskId, studentId });
  return NextResponse.json({ submissions });
}

export async function POST(request: Request) {
  const store = demoStore;
  const body = await request.json();
  const taskId = String(body?.taskId ?? "").trim();
  const studentId = String(body?.studentId ?? "").trim();
  const codeText = String(body?.codeText ?? "");

  if (!taskId || !studentId || !codeText.trim()) {
    return NextResponse.json({ message: "缺少必要字段" }, { status: 400 });
  }

  try {
    const result = store.createSubmission({ taskId, studentId, codeText });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "提交失败" },
      { status: 400 }
    );
  }
}
