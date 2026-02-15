import { NextResponse } from "next/server";
import { demoStore } from "@/lib/demo-store";
import type { JobStatus } from "@/lib/demo-types";

export async function GET(request: Request) {
  const store = demoStore;
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") as JobStatus | null;
  const limitRaw = searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : null;

  const jobs = store.getJobs({
    status: status && status !== "ALL" ? status : null,
    limit: Number.isFinite(limit ?? NaN) ? limit : null,
  });

  return NextResponse.json({ jobs });
}
