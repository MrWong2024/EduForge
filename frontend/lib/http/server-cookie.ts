import "server-only";

import { headers } from "next/headers";

export async function getInboundCookieHeader(): Promise<string | null> {
  const inboundHeaders = await headers();
  const cookieHeader = inboundHeaders.get("cookie");
  return cookieHeader && cookieHeader.trim() ? cookieHeader : null;
}
