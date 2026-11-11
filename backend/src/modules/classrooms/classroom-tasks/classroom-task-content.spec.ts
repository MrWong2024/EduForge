import {
  snapshotTask,
  publicTaskContent,
  isValidTaskSnapshot,
} from './classroom-task-content';
import { Task, TaskStatus } from '../../learning-tasks/schemas/task.schema';
import { Mongoose, Types } from 'mongoose';
import {
  ClassroomTask,
  ClassroomTaskSchema,
} from './schemas/classroom-task.schema';

it.each([
  undefined,
  null,
  [],
  {},
  'snapshot',
  1,
  true,
  { description: 'description', knowledgeModule: 'module' },
  { title: null, description: 'description', knowledgeModule: 'module' },
  { title: 'title', description: [], knowledgeModule: 'module' },
  { title: 'title', description: 'description', knowledgeModule: 1 },
])('rejects an unavailable snapshot structure %#', (value) => {
  expect(isValidTaskSnapshot(value)).toBe(false);
});

it('accepts minimal string fields without normalizing or validating optional historical fields', () => {
  const minimal = { title: '', description: ' ', knowledgeModule: '' };
  const historical = {
    title: 'Published title',
    description: 'Published description',
    knowledgeModule: 'Published module',
    difficulty: 'historical difficulty',
    courseLabel: 'historical label',
    rubric: { legacy: true },
  };
  expect(isValidTaskSnapshot(minimal)).toBe(true);
  expect(isValidTaskSnapshot(historical)).toBe(true);
  expect(minimal).toEqual({ title: '', description: ' ', knowledgeModule: '' });
  expect(historical).not.toHaveProperty('aiContextRefs');
});

it('requires an explicit immutable snapshot without a Schema default', () => {
  const schema = ClassroomTaskSchema.clone();
  const model = new Mongoose().model<ClassroomTask>(
    'OfflineClassroomTask',
    schema,
  );
  const fields = {
    classroomId: new Types.ObjectId(),
    taskId: new Types.ObjectId(),
    createdBy: new Types.ObjectId(),
    publishedAt: new Date('2026-01-01T00:00:00Z'),
  };
  expect(schema.path('taskSnapshot').options).toMatchObject({
    required: true,
    immutable: true,
  });
  expect(schema.path('taskSnapshot').options.default).toBeUndefined();
  const missing = new model(fields);
  expect(missing.toObject()).not.toHaveProperty('taskSnapshot');
  expect(missing.validateSync()?.errors.taskSnapshot).toMatchObject({
    kind: 'required',
  });
  expect(
    new model({ ...fields, taskSnapshot: null }).validateSync()?.errors
      .taskSnapshot,
  ).toMatchObject({ kind: 'required' });
  expect(
    new model({
      ...fields,
      taskSnapshot: {
        title: 'title',
        description: 'description',
        knowledgeModule: 'module',
      },
    }).validateSync(),
  ).toBeUndefined();
});

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
