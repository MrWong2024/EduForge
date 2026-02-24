import { NextResponse } from "next/server";
import { demoStore } from "@/lib/demo-store";

export async function POST(request: Request) {
  const store = demoStore;
  const body = await request.json().catch(() => ({}));
  const batchSizeRaw = Number(body?.batchSize ?? 3);
  const batchSize = Number.isFinite(batchSizeRaw) && batchSizeRaw > 0 ? batchSizeRaw : 3;
  const result = store.processOnce(batchSize);
  return NextResponse.json(result);
}
