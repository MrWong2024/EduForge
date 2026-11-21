import type { UpdateClassroomRequest } from "@/lib/api/types-teacher";

export const toClassroomNameInputValue = (name: string): string =>
  name.replace(/[\r\n]/g, "");

export function buildClassroomEditPatch(
  baselineName: string,
  name: string,
): Pick<UpdateClassroomRequest, "name"> | null {
  if (!name.trim()) {
    return null;
  }
  if (
    toClassroomNameInputValue(name) === toClassroomNameInputValue(baselineName)
  ) {
    return {};
  }
  return { name };
}
