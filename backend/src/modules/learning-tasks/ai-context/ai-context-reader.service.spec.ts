import { BadRequestException } from '@nestjs/common';
import fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import yauzl from 'yauzl';
import {
  AiContextReaderService,
  aiContextResourceRoot,
} from './ai-context-reader.service';
import { AI_CONTEXT_LIMITS } from './ai-context.types';

const fixtures = resolve(__dirname, '../../../../test/fixtures');
const ref = (archive: string, entries: string[]) => ({
  archivePath: 'ai-context/' + archive,
  entryPaths: entries,
});
const reader = (root = fixtures) => {
  const service = new AiContextReaderService();
  Object.defineProperty(service, 'resourceRoot', { value: root });
  return service;
};

describe('ZIP context reader (no database)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('locates the same project .local from source and dist independently of cwd', () => {
    const project = resolve(__dirname, '../../../../..');
    expect(aiContextResourceRoot()).toBe(resolve(project, '.local'));
    expect(
      aiContextResourceRoot(
        resolve(project, 'backend/dist/src/modules/learning-tasks/ai-context'),
      ),
    ).toBe(resolve(project, '.local'));
  });

  it('does not touch the filesystem for omitted or empty dependencies', async () => {
    const probe = jest.spyOn(fs, 'realpath');
    expect(await reader().read()).toEqual([]);
    expect(await reader().read([])).toEqual([]);
    expect(probe).not.toHaveBeenCalled();
  });

  it('reads exact selected text from multiple ZIPs in configured order, ignoring DOCX', async () => {
    expect(
      await reader().read([
        ref('teacher.zip', ['teacher/guide.md']),
        ref('student.zip', ['src/C++.cpp', '资料/AI任务委托卡.md']),
      ]),
    ).toEqual([
      {
        referenceNo: 1,
        entryPath: 'teacher/guide.md',
        text: '# REF_B\nsecond reference\n',
      },
      {
        referenceNo: 2,
        entryPath: 'src/C++.cpp',
        text: 'int reference() { return 14; }\n',
      },
      {
        referenceNo: 2,
        entryPath: '资料/AI任务委托卡.md',
        text: '# REF_A\nfirst reference\n',
      },
    ]);
    expect(
      (await reader().read([ref('invalid-text.zip', ['bom.txt'])]))[0].text,
    ).toBe('hello\n');
  });

  it.each([
    '../outside.zip',
    '/absolute.zip',
    'C:/book.zip',
    '//host/book.zip',
    'book\\file.zip',
    'book/./file.zip',
    'book//file.zip',
    'book/../file.zip',
    'book/fi\0le.zip',
    'book.zip',
  ])(
    'rejects noncanonical archive %s without filesystem access',
    async (archivePath) => {
      const probe = jest.spyOn(fs, 'realpath');
      await expect(
        reader().read([{ archivePath, entryPaths: ['test.txt'] }]),
      ).rejects.toMatchObject({ code: 'AI_CONTEXT_UNAVAILABLE' });
      expect(probe).not.toHaveBeenCalled();
    },
  );
  it.each([
    '../test.txt',
    '/test.txt',
    'C:/test.txt',
    'test\\file.txt',
    'x//test.txt',
    'x/./test.txt',
    'x/../test.txt',
    'a\0.txt',
    'folder/',
  ])('rejects noncanonical entry %s', async (entry) => {
    await expect(
      reader().read([ref('student.zip', [entry])]),
    ).rejects.toMatchObject({ code: 'AI_CONTEXT_UNAVAILABLE' });
  });

  it.each([
    ['missing.zip', ['test.txt']],
    ['student.zip', ['missing.txt']],
    ['student.zip', ['layout/ignore.docx']],
    ['invalid-text.zip', ['nul.txt']],
    ['invalid-text.zip', ['invalid.txt']],
    ['duplicate.zip', ['same.txt']],
    ['symlink.zip', ['link.txt']],
    ['unsupported.zip', ['test.txt']],
    ['encrypted.zip', ['test.txt']],
    ['corrupt.zip', ['test.txt']],
  ])('safely rejects unavailable/unsupported %s', async (archive, entries) => {
    await expect(reader().read([ref(archive, entries)])).rejects.toMatchObject({
      code: 'AI_CONTEXT_UNAVAILABLE',
    });
    try {
      await reader().validateForSave([ref(archive, entries)]);
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect(String(error)).not.toContain(fixtures);
      expect(String(error)).not.toContain(archive);
    }
  });

  it('rejects duplicate configuration and concentrated resource limits', async () => {
    const selected = ref('student.zip', ['src/C++.cpp']);
    await expect(reader().read([selected, selected])).rejects.toMatchObject({
      code: 'AI_CONTEXT_UNAVAILABLE',
    });
    await expect(
      reader().read([ref('student.zip', ['src/C++.cpp', 'src/C++.cpp'])]),
    ).rejects.toMatchObject({ code: 'AI_CONTEXT_UNAVAILABLE' });
    await expect(
      reader().read(
        Array.from({ length: 9 }, (_, i) => ref(i + '.zip', ['a.txt'])),
      ),
    ).rejects.toMatchObject({ code: 'AI_CONTEXT_LIMIT_EXCEEDED' });
    await expect(
      reader().read([
        ref(
          'student.zip',
          Array.from({ length: 33 }, (_, i) => i + '.txt'),
        ),
      ]),
    ).rejects.toMatchObject({ code: 'AI_CONTEXT_LIMIT_EXCEEDED' });
    for (const [archive, entries] of [
      ['oversized.zip', ['large.txt']],
      ['total.zip', Array.from({ length: 5 }, (_, i) => i + '.txt')],
      ['many.zip', ['0.txt']],
    ] as Array<[string, string[]]>) {
      await expect(
        reader().read([ref(archive, entries)]),
      ).rejects.toMatchObject({ code: 'AI_CONTEXT_LIMIT_EXCEEDED' });
    }
    expect(
      (await reader().read([ref('student.zip', ['limit.txt'])]))[0].text.length,
    ).toBe(65536);
  });

  it('stops a stream as soon as actual bytes exceed the file cap and closes it', async () => {
    let chunksRead = 0;
    const stream = Readable.from(
      (function* () {
        for (let i = 0; i < 8; i++) {
          chunksRead++;
          yield Buffer.alloc(32768, 65);
        }
      })(),
    );
    jest
      .spyOn(yauzl.ZipFile.prototype, 'openReadStreamPromise')
      .mockResolvedValue(stream);
    await expect(
      reader().read([ref('student.zip', ['src/C++.cpp'])]),
    ).rejects.toMatchObject({ code: 'AI_CONTEXT_LIMIT_EXCEEDED' });
    expect(stream.destroyed).toBe(true);
    expect(chunksRead).toBeLessThan(8);
  });

  it('closes ZIP descriptors on success and all representative failures', async () => {
    const open = jest.spyOn(yauzl, 'openPromise');
    await reader().read([ref('student.zip', ['src/C++.cpp'])]);
    await expect(
      reader().read([ref('invalid-text.zip', ['invalid.txt'])]),
    ).rejects.toThrow();
    await expect(
      reader().read([ref('duplicate.zip', ['same.txt'])]),
    ).rejects.toThrow();
    await expect(
      reader().read([ref('oversized.zip', ['large.txt'])]),
    ).rejects.toThrow();
    for (const result of open.mock.results) {
      const zip = (await result.value) as yauzl.ZipFile;
      expect(zip.isOpen).toBe(false);
      expect(zip.listenerCount('close')).toBe(0);
    }
  });

  it('rejects realpath escapes and oversize physical archives; cleans its own files', async () => {
    const scratch = await fs.mkdtemp(resolve(tmpdir(), 'eduforge-zip-'));
    const root = resolve(scratch, 'root');
    try {
      await fs.mkdir(root);
      await fs.mkdir(resolve(scratch, 'outside'));
      await fs.copyFile(
        resolve(fixtures, 'ai-context/student.zip'),
        resolve(scratch, 'outside/book.zip'),
      );
      await fs.symlink(
        resolve(scratch, 'outside'),
        resolve(root, 'escape'),
        'junction',
      );
      await expect(
        reader(root).read([
          { archivePath: 'escape/book.zip', entryPaths: ['src/C++.cpp'] },
        ]),
      ).rejects.toMatchObject({ code: 'AI_CONTEXT_UNAVAILABLE' });
      await fs.mkdir(resolve(root, 'own'));
      const file = await fs.open(resolve(root, 'own/huge.zip'), 'w');
      try {
        await file.truncate(AI_CONTEXT_LIMITS.archiveBytes + 1);
      } finally {
        await file.close();
      }
      await expect(
        reader(root).read([
          { archivePath: 'own/huge.zip', entryPaths: ['a.txt'] },
        ]),
      ).rejects.toMatchObject({ code: 'AI_CONTEXT_LIMIT_EXCEEDED' });
      await expect(
        reader(root).read([{ archivePath: 'own', entryPaths: ['a.txt'] }]),
      ).rejects.toThrow();
    } finally {
      await fs.rm(scratch, { recursive: true, force: true });
    }
    await expect(fs.stat(scratch)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reads both maintained chapter14 packages without modifying them', async () => {
    const result = await new AiContextReaderService().read([
      {
        archivePath:
          'human-ai-programming/student/第14章_学生配套_C++_V0.5.1.zip',
        entryPaths: ['chapter14_cpp/notes/AI任务委托卡.md'],
      },
      {
        archivePath:
          'human-ai-programming/teacher/第14章_教师与编辑配套_三语言_V0.7.zip',
        entryPaths: ['chapter14_teacher/teacher/教学与练习说明.md'],
      },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].text).toContain('AI任务委托卡');
    expect(result[1].text).toContain('教学');
    expect(result.every((file) => file.text.length > 0)).toBe(true);
  });
});
