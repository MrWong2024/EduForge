import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Mongoose, Types } from 'mongoose';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { Task, TaskSchema, TaskStatus } from './schemas/task.schema';

const base = {
  title: 'Difficulty validation',
  description: 'Pure validation without a database',
  knowledgeModule: 'difficulty-validation',
};
const valid = [undefined, '', 'easy', 'medium', 'hard'];
const invalid: unknown[] = [
  null,
  ' ',
  '\t',
  '综合',
  '基础',
  'Easy',
  ' easy ',
  'hard ',
  [],
  ['easy'],
  {},
  { toString: () => 'easy' },
  1,
  true,
];

describe('task difficulty write validation without a database', () => {
  const mongoose = new Mongoose();
  const TaskModel = mongoose.model<Task>(
    'TaskDifficultyValidation',
    TaskSchema.clone(),
  );

  afterAll(() => {
    expect(mongoose.connection.readyState).toBe(0);
    mongoose.deleteModel('TaskDifficultyValidation');
  });

  it.each(valid)(
    'accepts omitted or valid difficulty %p in both DTOs and the actual model',
    async (difficulty) => {
      const input = difficulty === undefined ? {} : { difficulty };
      for (const dto of [
        plainToInstance(CreateTaskDto, { ...base, ...input }),
        plainToInstance(UpdateTaskDto, input),
      ]) {
        expect(validateSync(dto)).toEqual([]);
      }
      const document = new TaskModel({
        ...base,
        status: TaskStatus.Draft,
        createdBy: new Types.ObjectId(),
        ...input,
      });
      await expect(document.validate()).resolves.toBeUndefined();
      expect(document.difficulty).toBe(difficulty);
      expect(TaskModel.db.readyState).toBe(0);
    },
  );

  it.each(invalid.map((difficulty) => [difficulty]))(
    'rejects invalid difficulty %p in both DTOs and the actual model',
    async (difficulty: unknown) => {
      for (const dto of [
        plainToInstance(CreateTaskDto, { ...base, difficulty }),
        plainToInstance(UpdateTaskDto, { difficulty }),
      ]) {
        expect(
          validateSync(dto).some((error) => error.property === 'difficulty'),
        ).toBe(true);
      }
      const document = new TaskModel({
        ...base,
        status: TaskStatus.Draft,
        createdBy: new Types.ObjectId(),
        difficulty,
      });
      await expect(document.validate()).rejects.toHaveProperty(
        'errors.difficulty',
      );
      expect(TaskModel.db.readyState).toBe(0);
    },
  );
});
