import { expect, test } from "@playwright/test";
import { ESLint } from "eslint";
import { readFile } from "node:fs/promises";
import path from "node:path";

const frontendRoot = path.resolve(__dirname, "../..");
const eslint = new ESLint({ cwd: frontendRoot });

async function lint(source: string, filePath: string) {
  const [result] = await eslint.lintText(source, {
    filePath: path.join(frontendRoot, filePath),
  });
  expect(result.fatalErrorCount).toBe(0);
  expect(result.messages.some((message) => /ignored/i.test(message.message))).toBe(
    false,
  );
  return result.messages;
}

const ruleExamples = [
  {
    name: "anonymous default exports",
    filePath: "eslint-contract-fixture.mjs",
    ruleId: "import-x/no-anonymous-default-export",
    severity: 1,
    invalid: "export default {};",
    valid: "const config = {}; export default config;",
  },
  {
    name: "Next Image alternative text",
    filePath: "app/eslint-contract-fixture.tsx",
    ruleId: "jsx-a11y-x/alt-text",
    severity: 1,
    invalid:
      'import Image from "next/image"; export default function Example() { return <Image src="/sample.png" width={1} height={1} />; }',
    valid:
      'import Image from "next/image"; export default function Example() { return <Image src="/sample.png" width={1} height={1} alt="Sample" />; }',
  },
  {
    name: "ARIA property names",
    filePath: "components/eslint-contract-fixture.tsx",
    ruleId: "jsx-a11y-x/aria-props",
    severity: 1,
    invalid:
      'export function Example() { return <button aria-invalid-property="value">Save</button>; }',
    valid:
      'export function Example() { return <button aria-label="Save">Save</button>; }',
  },
  {
    name: "React list keys",
    filePath: "components/eslint-contract-fixture.tsx",
    ruleId: "@eslint-react/no-missing-key",
    severity: 2,
    invalid:
      'export function Example() { return <ul>{["one", "two"].map((label) => <li>{label}</li>)}</ul>; }',
    valid:
      'export function Example() { return <ul>{["one", "two"].map((label) => <li key={label}>{label}</li>)}</ul>; }',
  },
  {
    name: "official conditional Hook checks",
    filePath: "components/eslint-contract-fixture.tsx",
    ruleId: "react-hooks/rules-of-hooks",
    severity: 2,
    invalid:
      'import { useState } from "react"; export function Example({ active }: { active: boolean }) { if (active) { useState(0); } return null; }',
    valid:
      'import { useState } from "react"; export function Example() { useState(0); return null; }',
  },
  {
    name: "Next Core Web Vitals script checks",
    filePath: "app/eslint-contract-fixture.tsx",
    ruleId: "@next/next/no-sync-scripts",
    severity: 2,
    invalid:
      'export default function Example() { return <script src="https://example.invalid/script.js" />; }',
    valid:
      'export default function Example() { return <script src="https://example.invalid/script.js" async />; }',
  },
  {
    name: "TypeScript explicit any checks",
    filePath: "lib/eslint-contract-fixture.ts",
    ruleId: "@typescript-eslint/no-explicit-any",
    severity: 2,
    invalid: "export const value: any = 1;",
    valid: "export const value: unknown = 1;",
  },
  {
    name: "TypeScript unused variables remain warnings",
    filePath: "test/contracts/eslint-contract-fixture.ts",
    ruleId: "@typescript-eslint/no-unused-vars",
    severity: 1,
    invalid: "const unused = 1; export {};",
    valid: "export const value = 1;",
  },
  {
    name: "TypeScript unused expressions remain warnings",
    filePath: "lib/eslint-contract-fixture.ts",
    ruleId: "@typescript-eslint/no-unused-expressions",
    severity: 1,
    invalid: "declare const value: string; value;",
    valid: "export const value = 'used';",
  },
  {
    name: "MJS JavaScript checks and Node globals",
    filePath: "eslint-contract-fixture.mjs",
    ruleId: "no-undef",
    severity: 2,
    invalid: "export const version = missingMjsName;",
    valid: "export const version = process.version;",
  },
] as const;

for (const example of ruleExamples) {
  test(`enforces ${example.name} through the actual ESLint config`, async () => {
    const invalid = await lint(example.invalid, example.filePath);
    expect(
      invalid.filter((message) => message.ruleId === example.ruleId),
    ).toEqual([
      expect.objectContaining({
        ruleId: example.ruleId,
        severity: example.severity,
      }),
    ]);

    const valid = await lint(example.valid, example.filePath);
    expect(valid.filter((message) => message.ruleId === example.ruleId)).toEqual(
      [],
    );
  });
}

test("lints the MJS Browser support source without executing it", async () => {
  const filePath = "test/browser/support/browser-probe-upstream.mjs";
  const source = await readFile(path.join(frontendRoot, filePath), "utf8");
  const messages = await lint(source, filePath);
  expect(messages.filter((message) => message.severity === 2)).toEqual([]);
});

test("preserves the generated file and directory ignores", async () => {
  for (const filePath of [
    ".next/eslint-contract-fixture.ts",
    "out/eslint-contract-fixture.mjs",
    "build/eslint-contract-fixture.tsx",
    "next-env.d.ts",
  ]) {
    expect(await eslint.isPathIgnored(path.join(frontendRoot, filePath))).toBe(
      true,
    );
  }
});
