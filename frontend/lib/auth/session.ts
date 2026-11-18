import "server-only";

import { redirect } from "next/navigation";
import { fetchJson, FetchJsonError } from "@/lib/api/client";
import { hasRole, type RoleAwareMe, getRoleHomePath } from "@/lib/auth/role-home";
import { paths, type UserRole } from "@/lib/routes/paths";

export type MeResponse = RoleAwareMe & {
  id?: string;
  email?: string | null;
  name?: string | null;
  status?: string | null;
  studentNo?: string | null;
  employeeNo?: string | null;
};

export type RoleGateResult =
  | { allowed: true; me: MeResponse }
  | { allowed: false; me: MeResponse };

export { hasRole, getRoleHomePath };

export async function getMe(): Promise<MeResponse> {
  return fetchJson<MeResponse>("users/me", {
    headers: { accept: "application/json" },
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
      redirect(paths.home);
    }
    throw error;
  }
}
