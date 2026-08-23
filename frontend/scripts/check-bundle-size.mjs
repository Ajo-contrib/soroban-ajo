#!/usr/bin/env node
/**
 * Build-time bundle size check for the frontend.
 *
 * Complements the runtime client-side monitoring in `src/utils/monitoring.ts`
 * (whose `PERFORMANCE_BUDGETS.maxBundleSize` only fires a console.warn after a
 * real user has already downloaded an oversized bundle). This script inspects
 * the actual `next build` output artifacts and fails the build/CI step with a
 * hard budget when a regression would otherwise slip in before merge.
 *
 * Usage:
 *   npm run build                  # first, produces .next/
 *   node scripts/check-bundle-size.mjs [--dir .next] [--budget 512000]
 *
 * Env overrides:
 *   BUNDLE_SIZE_BUDGET            bytes (default: 512000 = 500 KB, matching
 *                                 PERFORMANCE_BUDGETS.maxBundleSize)
 *   BUNDLE_SIZE_STRICT=false      surface violations as warnings instead of
 *                                 failing (useful for triage); default: fail
 *
 * Exit codes:
 *   0  all chunks within budget
 *   1  one or more chunks exceed budget (or no output found)
 */

import { execSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FRONTEND_ROOT = resolve(__dirname, '..')

const DEFAULT_BUDGET = 500 * 1024 // 500 KB – aligned with monitoring.ts

// Chunks that are expected to be large by design (Next.js runtime, framework).
// We still measure them but they don't gate the hard budget – the intent is to
// catch *regressions* in app code, not to penalize the framework itself.
const EXEMPT_GLOBS = [
  'framework-*.js',
  'main-*.js',
  'webpack-*.js',
  'polyfills-*.js',
]

function parseArgs(argv) {
  const args = { dir: join(FRONTEND_ROOT, '.next'), budget: null, strict: true }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dir') args.dir = resolve(FRONTEND_ROOT, argv[++i])
    else if (arg === '--budget') args.budget = parseInt(argv[++i], 10)
    else if (arg.startsWith('--dir=')) args.dir = resolve(FRONTEND_ROOT, arg.split('=')[1])
    else if (arg.startsWith('--budget=')) args.budget = parseInt(arg.split('=')[1], 10)
  }

  if (process.env.BUNDLE_SIZE_BUDGET) {
    args.budget = parseInt(process.env.BUNDLE_SIZE_BUDGET, 10)
  }
  if (process.env.BUNDLE_SIZE_STRICT === 'false') args.strict = false

  if (!args.budget || Number.isNaN(args.budget) || args.budget <= 0) {
    args.budget = DEFAULT_BUDGET
  }
  return args
}

function isExempt(filename) {
  return EXEMPT_GLOBS.some((glob) => filename.match(new RegExp('^' + glob.replaceAll('*', '.*'))))
}

function walkChunks(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) out.push(...walkChunks(full))
    else if (/\.js$/.test(entry) && !entry.endsWith('.map')) out.push(full)
  }
  return out
}

function formatBytes(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(2)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const chunksDir = join(args.dir, 'static', 'chunks')

  // Fall back to `webpack: (config) => ...` style outputs nested under .next/static
  const files = walkChunks(chunksDir)

  if (files.length === 0) {
    console.error(`❌ No JS chunks found in ${chunksDir}`)
    console.error('   Run `npm run build` first (or pass --dir pointing at a .next build output).')
    process.exit(args.strict ? 1 : 0)
  }

  const measurements = files
    .map((file) => ({ file, size: statSync(file).size }))
    .sort((a, b) => b.size - a.size)

  const maxChunk = measurements[0]
  const exemptMax = measurements.filter((m) => isExempt(relativeChunkName(m.file, chunksDir)))[0]
  const appChunks = measurements.filter((m) => !isExempt(relativeChunkName(m.file, chunksDir)))
  const largestAppChunk = appChunks[0]
  const totalAppBytes = appChunks.reduce((sum, m) => sum + m.size, 0)
  const totalBytes = measurements.reduce((sum, m) => sum + m.size, 0)

  console.log('📦 Bundle Size Check (build-time)\n')
  console.log(`   Build output : ${chunksDir}`)
  console.log(`   Budget       : ${formatBytes(args.budget)} (${args.budget.toLocaleString()} bytes)`)
  console.log(`   Chunks found : ${files.length} JS files`)
  console.log('')
  console.log('   Largest chunks:')
  for (const m of measurements.slice(0, 8)) {
    const exempt = isExempt(relativeChunkName(m.file, chunksDir)) ? ' (framework)' : ''
    console.log(`     ${formatBytes(m.size).padStart(10)}  ${relativeChunkName(m.file, chunksDir)}${exempt}`)
  }
  if (measurements.length > 8) {
    console.log(`     … and ${measurements.length - 8} more`)
  }

  console.log('')
  console.log(`   Total JS (all)      : ${formatBytes(totalBytes)}`)
  console.log(`   Total JS (app)      : ${formatBytes(totalAppBytes)}`)
  console.log(`   Largest app chunk   : ${formatBytes(largestAppChunk.size)} (${relativeChunkName(largestAppChunk.file, chunksDir)})`)
  if (exemptMax) console.log(`   Largest framework    : ${formatBytes(exemptMax.size)} (framework)`)
  console.log('')

  let violations = []
  // 1. Any single app chunk must stay under the budget (guards: an accidental
  //    import of a heavy library into a page pulls the whole thing in).
  for (const m of appChunks) {
    if (m.size > args.budget) violations.push(`single chunk ${relativeChunkName(m.file, chunksDir)} (${formatBytes(m.size)} > ${formatBytes(args.budget)})`)
  }

  if (violations.length > 0) {
    console.error('❌ BUNDLE SIZE BUDGET EXCEEDED:')
    for (const v of violations) console.error(`   - ${v}`)
    console.error('')
    console.error(`   Budget: ${formatBytes(args.budget)} per app chunk. Actual largest app chunk: ${formatBytes(largestAppChunk.size)}.`)
    console.error('   Consider lazy-loading heavy imports (dynamic import), or splitting the page.')
    console.error('   To raise the budget deliberately, pass --budget=<bytes> or set BUNDLE_SIZE_BUDGET.')
    process.exit(args.strict ? 1 : 0)
  }

  console.log(`✅ All app chunks within budget (${formatBytes(args.budget)} each).`)
}

function relativeChunkName(file, chunksDir) {
  return file.startsWith(chunksDir) ? file.slice(chunksDir.length + 1) : file
}

main()