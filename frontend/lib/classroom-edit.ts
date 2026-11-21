import type { UpdateClassroomRequest } from "@/lib/api/types-teacher";
import { toSingleLineInputValue } from "./form-text-values";

export const toClassroomNameInputValue = toSingleLineInputValue;

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
