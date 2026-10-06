import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_BUNDLE_BUDGET_BYTES = 500 * 1024;

async function walkJavaScriptFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walkJavaScriptFiles(fullPath)));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(fullPath);
  }
  return files;
}

function parsePositiveInteger(value, name) {
  if (value == null || value === '') return undefined;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a positive integer, received ${JSON.stringify(value)}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return parsed;
}

export async function checkBundleBudget({
  chunksDir = path.resolve('.next/static/chunks'),
  budgetBytes = DEFAULT_BUNDLE_BUDGET_BYTES,
} = {}) {
  let files;
  try {
    files = await walkJavaScriptFiles(chunksDir);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Bundle output directory not found: ${chunksDir}. Run \`next build\` first.`);
    }
    throw error;
  }

  if (files.length === 0) {
    throw new Error(`No JavaScript chunks found in ${chunksDir}. Refusing to pass without built output.`);
  }

  const measurements = await Promise.all(
    files.map(async (file) => ({
      file,
      relativePath: path.relative(chunksDir, file),
      bytes: (await stat(file)).size,
    }))
  );
  measurements.sort((a, b) => b.bytes - a.bytes || a.relativePath.localeCompare(b.relativePath));
  const violations = measurements.filter((entry) => entry.bytes > budgetBytes);
  return { budgetBytes, measurements, violations };
}

function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

export async function main({ env = process.env } = {}) {
  const budgetBytes =
    parsePositiveInteger(env.BUNDLE_SIZE_BUDGET_BYTES, 'BUNDLE_SIZE_BUDGET_BYTES') ??
    DEFAULT_BUNDLE_BUDGET_BYTES;
  const chunksDir = path.resolve(env.BUNDLE_CHUNKS_DIR || '.next/static/chunks');
  const result = await checkBundleBudget({ chunksDir, budgetBytes });
  const limit = parsePositiveInteger(env.BUNDLE_SIZE_REPORT_LIMIT, 'BUNDLE_SIZE_REPORT_LIMIT') ?? 20;

  console.log(`Bundle budget: ${formatKiB(result.budgetBytes)} per emitted browser script`);
  console.log(`Measured ${result.measurements.length} built JavaScript chunk(s) in ${chunksDir}`);
  console.log('\nLargest chunks:');
  for (const entry of result.measurements.slice(0, limit)) {
    console.log(`  ${formatKiB(entry.bytes).padStart(11)}  ${entry.relativePath}`);
  }

  if (result.violations.length > 0) {
    console.error(`\nBundle budget exceeded by ${result.violations.length} chunk(s):`);
    for (const entry of result.violations) {
      console.error(
        `  ${formatKiB(entry.bytes)} > ${formatKiB(result.budgetBytes)}  ${entry.relativePath}`
      );
    }
    return 1;
  }

  console.log('\nBundle size budget passed.');
  return 0;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`Bundle budget check failed: ${error.message}`);
      process.exitCode = 1;
    });
}
