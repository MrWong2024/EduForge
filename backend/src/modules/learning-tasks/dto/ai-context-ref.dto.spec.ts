import { ValidationPipe } from '@nestjs/common';
import { CreateTaskDto } from './create-task.dto';
import { UpdateTaskDto } from './update-task.dto';
const valid = [
  {
    archivePath: '教材/配套_C++.zip',
    entryPaths: ['chapter/说明.md', 'src/C++.cpp'],
  },
];
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
const create = {
  title: 'task',
  description: 'desc',
  knowledgeModule: 'unit',
  stage: 1,
};
const transform = (
  value: unknown,
  metatype: typeof UpdateTaskDto | typeof CreateTaskDto = UpdateTaskDto,
) => pipe.transform(value, { type: 'body', metatype });
describe('nested context DTO and PATCH contract', () => {
  it('preserves exact names and order in both formal DTOs', async () => {
    expect(
      await transform({ ...create, aiContextRefs: valid }, CreateTaskDto),
    ).toMatchObject({ aiContextRefs: valid });
    expect(await transform({ aiContextRefs: valid })).toMatchObject({
      aiContextRefs: valid,
    });
    expect(await transform({})).toMatchObject({ aiContextRefs: undefined });
    expect(await transform({ aiContextRefs: [] })).toMatchObject({
      aiContextRefs: [],
    });
  });
  it.each([
    null,
    {},
    [null],
    ['bad'],
    [{ archivePath: 'book/a.zip', entryPaths: [] }],
    [{ archivePath: 'book/a.zip', entryPaths: null }],
    [{ archivePath: 'book/a.zip', entryPaths: ['a.txt', 'a.txt'] }],
    [...valid, ...valid],
    [{ ...valid[0], unknown: 'forbidden' }],
    [{ archivePath: 'x'.repeat(1025), entryPaths: ['a.txt'] }],
    [{ archivePath: 'book/a.zip', entryPaths: [3] }],
  ])('rejects invalid nested structure %#', async (aiContextRefs) => {
    await expect(transform({ aiContextRefs })).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      transform({ ...create, aiContextRefs }, CreateTaskDto),
    ).rejects.toMatchObject({ status: 400 });
  });
});
