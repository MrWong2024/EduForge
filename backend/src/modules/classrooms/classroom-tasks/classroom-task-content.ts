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

export const MISSING_TASK_SNAPSHOT_MESSAGE =
  '该课堂任务未保存发布内容，请教师重新布置后继续。';

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
