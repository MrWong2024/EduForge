import { snapshotTask, publicTaskContent } from './classroom-task-content';
import { Task, TaskStatus } from '../../learning-tasks/schemas/task.schema';
import { Types } from 'mongoose';
it('deep copies internal references and explicitly projects public teaching fields', () => {
  const task: Task = {
    title: 'title',
    description: 'description',
    knowledgeModule: 'module',
    courseLabel: '通用编程',
    difficulty: 'easy',
    rubric: { nested: { points: 1 } },
    status: TaskStatus.Published,
    createdBy: new Types.ObjectId(),
    aiContextRefs: [
      { archivePath: 'teacher/book.zip', entryPaths: ['teacher/guide.md'] },
    ],
  };
  const legacyTask = { ...task, stage: 4 };
  const snapshot = snapshotTask(legacyTask);
  expect(snapshot).not.toHaveProperty('stage');
  task.aiContextRefs![0].entryPaths.push('new.md');
  task.aiContextRefs![0].archivePath = 'new/book.zip';
  expect(snapshot.aiContextRefs).toEqual([
    { archivePath: 'teacher/book.zip', entryPaths: ['teacher/guide.md'] },
  ]);
  expect(publicTaskContent(snapshot)).toEqual({
    title: 'title',
    description: 'description',
    knowledgeModule: 'module',
    courseLabel: '通用编程',
    difficulty: 'easy',
    rubric: { nested: { points: 1 } },
  });
  expect(publicTaskContent(snapshot)).not.toHaveProperty('aiContextRefs');
  const legacySnapshot = { ...snapshot, stage: 2 };
  expect(publicTaskContent(legacySnapshot)).not.toHaveProperty('stage');
});
