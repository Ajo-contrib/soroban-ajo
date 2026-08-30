#!/usr/bin/env node
/**
 * Health Check Tracking Issue Manager
 *
 * This script creates or updates a single GitHub tracking issue with the
 * current pass/fail status and error counts from the automated health checks.
 *
 * It can be run:
 *   1. Locally: `node scripts/health-check-report.js --results /path/to/results`
 *   2. From the GitHub Actions workflow (.github/workflows/health-check.yml)
 *
 * Usage:
 *   node scripts/health-check-report.js [options]
 *
 * Options:
 *   --results <dir>    Directory containing health check result JSON files
 *                      (default: /tmp/health-results)
 *   --token <token>    GitHub token (default: process.env.GITHUB_TOKEN)
 *   --repo <owner/repo> GitHub repository (default: process.env.GITHUB_REPOSITORY)
 *   --title <title>    Tracking issue title (default: "🩺 Automated Health Check Report")
 *   --dry-run          Print the report without creating/updating an issue
 */

const fs = require('fs');
const path = require('path');

// ─── Configuration ──────────────────────────────────────────────────────────
const RESULTS_DIR = process.argv.includes('--results')
  ? process.argv[process.argv.indexOf('--results') + 1]
  : '/tmp/health-results';

const GITHUB_TOKEN = process.argv.includes('--token')
  ? process.argv[process.argv.indexOf('--token') + 1]
  : process.env.GITHUB_TOKEN;

const GITHUB_REPOSITORY = process.argv.includes('--repo')
  ? process.argv[process.argv.indexOf('--repo') + 1]
  : process.env.GITHUB_REPOSITORY;

const ISSUE_TITLE = process.argv.includes('--title')
  ? process.argv[process.argv.indexOf('--title') + 1]
  : '🩺 Automated Health Check Report';

const DRY_RUN = process.argv.includes('--dry-run');

// ─── Helpers ────────────────────────────────────────────────────────────────
function readJson(file) {
  try {
    const content = fs.readFileSync(path.join(RESULTS_DIR, file), 'utf8');
    return JSON.parse(content);
  } catch (e) {
    console.warn(`⚠️ Could not read ${file}: ${e.message}`);
    return null;
  }
}

function statusEmoji(status) {
  switch (status) {
    case 'success':
      return '✅';
    case 'failure':
      return '❌';
    default:
      return '⚠️';
  }
}

function buildReport(checks, totalErrors, allPassed, now) {
  const failedChecks = checks.filter((c) => c.status === 'failure');
  const tableRows = checks
    .map(
      (c) =>
        `| ${c.name} | ${statusEmoji(c.status)} ${c.status} | ${c.errors} |`
    )
    .join('\n');

  return `## 🩺 Automated Health Check Report

**Run Time:** ${now}
**Overall Status:** ${allPassed ? '✅ ALL CHECKS PASSED' : `❌ ${failedChecks.length} CHECK(S) FAILED`}
**Total Errors:** ${totalErrors}

### Check Results

| Check | Status | Errors |
|-------|--------|--------|
${tableRows}

### Details

${checks
  .map((c) => `- **${c.name}:** ${c.status}`)
  .join('\n')}

---
*This issue is automatically updated by the [Automated Health Check workflow](https://github.com/${GITHUB_REPOSITORY}/actions/workflows/health-check.yml).*
*Last updated: ${now}*
`;
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  if (!GITHUB_TOKEN && !DRY_RUN) {
    console.error('❌ GITHUB_TOKEN is required (or use --dry-run)');
    process.exit(1);
  }

  if (!GITHUB_REPOSITORY && !DRY_RUN) {
    console.error('❌ GITHUB_REPOSITORY is required (or use --dry-run)');
    process.exit(1);
  }

  // Read all result files
  const contracts = readJson('contracts.json') || {};
  const frontend = readJson('frontend.json') || {};
  const backend = readJson('backend.json') || {};

  // Build the checks list
  const checks = [
    {
      name: 'Contracts: Native Build',
      status: contracts.build_native || 'skipped',
      errors: parseInt(contracts.build_native_errors) || 0,
    },
    {
      name: 'Contracts: Tests',
      status: contracts.tests || 'skipped',
      errors: parseInt(contracts.tests_errors) || 0,
    },
    {
      name: 'Contracts: WASM Release Build',
      status: contracts.build_wasm || 'skipped',
      errors: parseInt(contracts.build_wasm_errors) || 0,
    },
    {
      name: 'Frontend: Type Check',
      status: frontend.type_check || 'skipped',
      errors: parseInt(frontend.type_check_errors) || 0,
    },
    {
      name: 'Backend: Type Check',
      status: backend.type_check || 'skipped',
      errors: parseInt(backend.type_check_errors) || 0,
    },
  ];

  const failedChecks = checks.filter((c) => c.status === 'failure');
  const totalErrors = checks.reduce((sum, c) => sum + c.errors, 0);
  const allPassed = failedChecks.length === 0;
  const now = new Date().toISOString();

  const body = buildReport(checks, totalErrors, allPassed, now);

  if (DRY_RUN) {
    console.log('=== DRY RUN: Report Preview ===');
    console.log(body);
    console.log('\n=== Summary ===');
    console.log(`Checks: ${checks.length}`);
    console.log(`Failed: ${failedChecks.length}`);
    console.log(`Total Errors: ${totalErrors}`);
    console.log(`Status: ${allPassed ? 'PASS' : 'FAIL'}`);
    return;
  }

  // GitHub API setup
  const [owner, repo] = GITHUB_REPOSITORY.split('/');
  const api = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const regressionComment = `🚨 **Health check regression detected!** ${failedChecks.length} check(s) failed with ${totalErrors} total error(s).\n\n@${owner} please investigate.`;

  // Look up the tracking issue by its label so we update it in place instead of
  // opening a duplicate when the repo has many open issues.
  const listResponse = await fetch(
    `${api}/issues?state=open&labels=health-check&per_page=100`,
    {
      headers,
    }
  );
  const issues = await listResponse.json();
  const issueList = Array.isArray(issues) ? issues : [];
  const existingIssue = issueList.find((issue) => issue.title === ISSUE_TITLE);

  if (existingIssue) {
    // Update the existing issue
    const updateResponse = await fetch(
      `${api}/issues/${existingIssue.number}`,
      {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      }
    );

    if (!updateResponse.ok) {
      console.error(
        `❌ Failed to update issue #${existingIssue.number}: ${updateResponse.status}`
      );
      process.exit(1);
    }

    console.log(`✅ Updated existing issue #${existingIssue.number}`);

    // On regression, comment and ping the owner.
    if (!allPassed) {
      const commentResponse = await fetch(
        `${api}/issues/${existingIssue.number}/comments`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            body: regressionComment,
          }),
        }
      );

      if (commentResponse.ok) {
        console.log('✅ Added regression alert comment');
      }
    }
  } else {
    // Create a new tracking issue
    const createResponse = await fetch(`${api}/issues`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: ISSUE_TITLE,
        body,
        labels: ['health-check', 'automated'],
      }),
    });

    if (!createResponse.ok) {
      console.error(`❌ Failed to create issue: ${createResponse.status}`);
      process.exit(1);
    }

    const newIssue = await createResponse.json();
    console.log(`✅ Created new issue #${newIssue.number}`);

    // On regression, comment and ping the owner.
    if (!allPassed) {
      const commentResponse = await fetch(
        `${api}/issues/${newIssue.number}/comments`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            body: regressionComment,
          }),
        }
      );

      if (commentResponse.ok) {
        console.log('✅ Added regression alert comment');
      }
    }
  }
}

main().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});