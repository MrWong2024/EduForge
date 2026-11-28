export type TaskExclusionSelection = {
  appliedIds: string[];
  selectedIds: string[];
  requestedIds: string[] | null;
};

export function normalizeTaskIds(taskIds: readonly string[]): string[] {
  return [...new Set(taskIds.map((id) => id.trim()).filter(Boolean))];
}

export function haveSameTaskIds(left: string[], right: string[]): boolean {
  const normalizedLeft = normalizeTaskIds(left);
  const rightSet = new Set(normalizeTaskIds(right));
  return (
    normalizedLeft.length === rightSet.size &&
    normalizedLeft.every((id) => rightSet.has(id))
  );
}

export function reconcileTaskExclusionSelection(
  selection: TaskExclusionSelection,
  appliedIds: string[],
): TaskExclusionSelection {
  if (haveSameTaskIds(selection.appliedIds, appliedIds)) return selection;

  const acknowledgesRequest =
    selection.requestedIds !== null &&
    haveSameTaskIds(selection.requestedIds, appliedIds);
  return {
    appliedIds,
    selectedIds: acknowledgesRequest ? selection.selectedIds : appliedIds,
    requestedIds: null,
  };
}
