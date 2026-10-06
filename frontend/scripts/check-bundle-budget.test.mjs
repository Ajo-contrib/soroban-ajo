import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { checkBundleBudget, DEFAULT_BUNDLE_BUDGET_BYTES } from './check-bundle-budget.mjs';

async function fixture(files, fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ajo-bundle-budget-'));
  try {
    for (const [name, bytes] of Object.entries(files)) {
      const target = path.join(root, name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, Buffer.alloc(bytes));
    }
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('default budget matches the 500 KiB runtime script budget', () => {
  assert.equal(DEFAULT_BUNDLE_BUDGET_BYTES, 500 * 1024);
});

test('accepts emitted browser chunks at or below the budget', async () => {
  await fixture({ 'app/a.js': 64, 'vendor.js': 100 }, async (root) => {
    const result = await checkBundleBudget({ chunksDir: root, budgetBytes: 100 });
    assert.deepEqual(result.violations, []);
    assert.deepEqual(result.measurements.map((entry) => entry.relativePath), [
      'vendor.js',
      path.join('app', 'a.js'),
    ]);
  });
});

test('reports every emitted browser chunk over the budget', async () => {
  await fixture({ 'app/a.js': 101, 'vendor.js': 180, 'styles.css': 1000 }, async (root) => {
    const result = await checkBundleBudget({ chunksDir: root, budgetBytes: 100 });
    assert.deepEqual(result.violations.map((entry) => entry.relativePath), [
      'vendor.js',
      path.join('app', 'a.js'),
    ]);
  });
});

test('fails closed when the build emitted no JavaScript chunks', async () => {
  await fixture({ 'styles.css': 1 }, async (root) => {
    await assert.rejects(
      () => checkBundleBudget({ chunksDir: root, budgetBytes: 100 }),
      /No JavaScript chunks found/
    );
  });
});

test('fails closed when the build output directory is missing', async () => {
  await assert.rejects(
    () =>
      checkBundleBudget({
        chunksDir: path.join(os.tmpdir(), `missing-${process.pid}`),
        budgetBytes: 100,
      }),
    /Bundle output directory not found/
  );
});
