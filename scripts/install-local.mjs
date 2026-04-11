#!/usr/bin/env node
/**
 * install-local.mjs
 *
 * Builds the plugin from source and links (or copies) the resulting
 * dist/index.js into a local OpenCode plugins directory.
 *
 * Usage:
 *   node scripts/install-local.mjs                    # link into the global plugin dir
 *   node scripts/install-local.mjs --target project   # link into .opencode/plugins in cwd
 *   node scripts/install-local.mjs --copy             # hard-copy instead of symlink
 *   node scripts/install-local.mjs --skip-build       # reuse existing dist/
 *
 * The local file://-based install in opencode.json is never overwritten by
 * OpenCode's npm auto-download, so the local build always wins.
 */
import { execFile } from 'node:child_process';
import { mkdir, readlink, rm, stat, symlink, copyFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(thisFile), '..');
const distIndex = path.join(repoRoot, 'dist', 'index.js');

function parseArgs(argv) {
  const opts = { target: 'global', copy: false, skipBuild: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--target') {
      opts.target = argv[++i] ?? 'global';
    } else if (arg === '--copy') {
      opts.copy = true;
    } else if (arg === '--skip-build') {
      opts.skipBuild = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node scripts/install-local.mjs [--target global|project] [--copy] [--skip-build]',
      );
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return opts;
}

function resolveTargetDir(target) {
  if (target === 'project') return path.resolve(process.cwd(), '.opencode', 'plugins');
  if (target === 'global') return path.join(homedir(), '.config', 'opencode', 'plugins');
  throw new Error(`Unknown --target value: ${target} (expected 'global' or 'project')`);
}

async function fileExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function replaceTarget(targetPath) {
  try {
    const link = await readlink(targetPath).catch(() => undefined);
    if (link !== undefined) {
      await rm(targetPath);
      return;
    }
  } catch {
    // not a symlink
  }
  if (await fileExists(targetPath)) {
    await rm(targetPath);
  }
}

async function build() {
  console.log('› npm run build');
  const { stdout, stderr } = await run('npm', ['run', 'build'], {
    cwd: repoRoot,
    shell: false,
  });
  if (stdout.trim()) console.log(stdout.trim());
  if (stderr.trim()) console.error(stderr.trim());
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const targetDir = resolveTargetDir(opts.target);
  const targetPath = path.join(targetDir, 'opencode-lcm.js');

  if (!opts.skipBuild) {
    await build();
  }

  if (!(await fileExists(distIndex))) {
    console.error(`Build output missing: ${distIndex}`);
    console.error('Run `npm run build` first, or drop --skip-build.');
    process.exit(1);
  }

  await mkdir(targetDir, { recursive: true });
  await replaceTarget(targetPath);

  if (opts.copy) {
    await copyFile(distIndex, targetPath);
    console.log(`✓ copied ${distIndex}`);
    console.log(`  → ${targetPath}`);
  } else {
    await symlink(distIndex, targetPath);
    console.log(`✓ symlinked ${distIndex}`);
    console.log(`  → ${targetPath}`);
  }

  console.log('');
  console.log('Next steps:');
  console.log('  1. Ensure opencode.json uses the local build, e.g.:');
  console.log('     "plugin": ["file://' + distIndex + '"]');
  console.log('  2. Restart OpenCode to pick up the new plugin.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
