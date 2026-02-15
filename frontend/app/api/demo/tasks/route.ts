import { NextResponse } from "next/server";
import { demoStore } from "@/lib/demo-store";

export async function GET() {
  const store = demoStore;
  return NextResponse.json({ tasks: store.tasks });
}

export async function POST(request: Request) {
  const store = demoStore;
  const body = await request.json();
  const title = String(body?.title ?? "").trim();
  const description = String(body?.description ?? "").trim();
  if (!title) {
    return NextResponse.json({ message: "标题不能为空" }, { status: 400 });
  }
  const task = store.createTask({ title, description });
  return NextResponse.json({ task });
}
