import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { hasRole, type RoleAwareMe, getRoleHomePath } from "@/lib/auth/role-home";
import { paths, type UserRole } from "@/lib/routes/paths";

export type MeResponse = RoleAwareMe & {
  id?: string;
};

export type RoleGateResult =
  | { allowed: true; me: MeResponse }
  | { allowed: false; me: MeResponse };

const getRequestOrigin = (headerMap: Headers): string => {
  const host = headerMap.get("x-forwarded-host") ?? headerMap.get("host") ?? "";
  if (!host) {
    return "";
  }

  const protocol = headerMap.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
};

export { hasRole, getRoleHomePath };

export async function getMe(): Promise<MeResponse> {
  const headerMap = await headers();
  const requestHeaders = new Headers();
  const cookie = headerMap.get("cookie");

  if (cookie) {
    requestHeaders.set("cookie", cookie);
  }
  requestHeaders.set("accept", "application/json");

  return fetchJson<MeResponse>("users/me", {
    origin: getRequestOrigin(headerMap),
    headers: requestHeaders,
    cache: "no-store",
  });
}

export async function requireRole(role: UserRole): Promise<RoleGateResult> {
  try {
    const me = await getMe();
    if (!hasRole(me, role)) {
      return { allowed: false, me };
    }
    return { allowed: true, me };
  } catch (error) {
    if (error instanceof FetchJsonError && error.status === 401) {
      redirect(paths.login);
    }
    throw error;
  }
}
