import { Task } from '../../learning-tasks/schemas/task.schema';

export type TaskSnapshot = Pick<
  Task,
  | 'title'
  | 'description'
  | 'knowledgeModule'
  | 'courseLabel'
  | 'difficulty'
  | 'rubric'
  | 'aiContextRefs'
>;

export type PublicTaskContent = Omit<TaskSnapshot, 'aiContextRefs'>;

export function publicTaskContent(task: TaskSnapshot): PublicTaskContent {
  return {
    title: task.title,
    description: task.description,
    knowledgeModule: task.knowledgeModule,
    courseLabel: task.courseLabel,
    difficulty: task.difficulty,
    rubric: task.rubric,
  };
}

export const INVALID_TASK_SNAPSHOT_MESSAGE =
  '课堂任务内容快照缺失或无效，请联系教师核对。';

export function isValidTaskSnapshot(value: unknown): value is TaskSnapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'title' in value &&
    typeof value.title === 'string' &&
    'description' in value &&
    typeof value.description === 'string' &&
    'knowledgeModule' in value &&
    typeof value.knowledgeModule === 'string'
  );
}

export function snapshotTask(task: Task): TaskSnapshot {
  return {
    aiContextRefs: task.aiContextRefs?.map((ref) => ({
      archivePath: ref.archivePath,
      entryPaths: [...ref.entryPaths],
    })),
    title: task.title,
    description: task.description,
    knowledgeModule: task.knowledgeModule,
    courseLabel: task.courseLabel,
    difficulty: task.difficulty,
    rubric:
      task.rubric === undefined ? undefined : structuredClone(task.rubric),
  };
}
