import fs from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import {
  AiFeedbackRequestBodyDumper,
  aiFeedbackRequestDirectory,
} from './ai-feedback-request-body-dumper';

const project = resolve(__dirname, '../../../../../..');
const temporaryParent = resolve(project, '.local/deliverables');

describe('AI request body files (synthetic local files only)', () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    await fs.mkdir(temporaryParent, { recursive: true });
    temporaryDirectory = await fs.mkdtemp(
      resolve(temporaryParent, '.tmp-ai-request-tests-'),
    );
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (
      dirname(temporaryDirectory) !== temporaryParent ||
      !basename(temporaryDirectory).startsWith('.tmp-ai-request-tests-')
    ) {
      throw new Error('Refusing cleanup outside the owned temporary directory');
    }
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('locates the same fixed directory from src and dist without consulting cwd', () => {
    jest.spyOn(process, 'cwd').mockReturnValue(temporaryDirectory);
    const expected = resolve(
      project,
      '.local/deliverables/ai-feedback-requests',
    );
    expect(aiFeedbackRequestDirectory()).toBe(expected);
    expect(
      aiFeedbackRequestDirectory(
        resolve(
          project,
          'backend/dist/src/modules/learning-tasks/ai-feedback/lib',
        ),
      ),
    ).toBe(expected);
  });

  it('keeps exact UTF-8 bytes and never overwrites concurrent or repeated submissions', async () => {
    const logger = {
      log: jest.fn<void, [string]>(),
      warn: jest.fn<void, [string]>(),
    };
    const directory = resolve(temporaryDirectory, 'requests');
    const dumper = new AiFeedbackRequestBodyDumper(logger, directory);
    const body = JSON.stringify({
      messages: [{ content: '合成材料\n  缩进' }],
    });
    const submissionId = '../unsafe:id\\with\ncharacters';

    await Promise.all([
      dumper.save(submissionId, body),
      dumper.save(submissionId, body),
    ]);
    await dumper.save(submissionId, body);

    const files = await fs.readdir(directory);
    expect(files).toHaveLength(3);
    expect(new Set(files).size).toBe(3);
    for (const name of files) {
      expect(name).toMatch(/^submission-.+-\d{4}-\d{2}-\d{2}T.+\.json$/);
      expect(name).not.toMatch(/[<>:"/\\|?*]/);
      expect([...name].some((character) => character.charCodeAt(0) < 32)).toBe(
        false,
      );
      expect(await fs.readFile(resolve(directory, name))).toEqual(
        Buffer.from(body, 'utf8'),
      );
    }
    expect(logger.log).toHaveBeenCalledTimes(3);
    expect(logger.warn).not.toHaveBeenCalled();
    for (const [message] of logger.log.mock.calls) {
      expect(message).not.toContain(body);
    }
  });

  it('warns safely and returns when writing fails', async () => {
    const logger = {
      log: jest.fn<void, [string]>(),
      warn: jest.fn<void, [string]>(),
    };
    const blocked = resolve(temporaryDirectory, 'not-a-directory');
    await fs.writeFile(blocked, 'owned sentinel');
    const dumper = new AiFeedbackRequestBodyDumper(logger, blocked);

    await expect(
      dumper.save('submission-1', 'private synthetic body'),
    ).resolves.toBeUndefined();

    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'AI feedback request body retention failed: submissionId=submission-1',
    );
    expect(await fs.readFile(blocked, 'utf8')).toBe('owned sentinel');
  });
});
