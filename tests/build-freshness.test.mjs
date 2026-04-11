import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  assertLocalBuildFreshnessSync,
  readSourceSchemaVersionSync,
} from '../dist/build-freshness.js';

const SOURCE_SCHEMA_OVERRIDE_ENV = 'OPENCODE_LCM_SOURCE_CONSTANTS_PATH';

async function withTempConstants(version, fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'lcm-freshness-'));
  const file = path.join(dir, 'constants.ts');
  const body =
    version === null
      ? '// no schema version\nexport const NOT_A_SCHEMA = 1;\n'
      : `export const STORE_SCHEMA_VERSION = ${version};\n`;
  await writeFile(file, body, 'utf8');
  const previous = process.env[SOURCE_SCHEMA_OVERRIDE_ENV];
  process.env[SOURCE_SCHEMA_OVERRIDE_ENV] = file;
  try {
    return await fn({ file, dir });
  } finally {
    if (previous === undefined) delete process.env[SOURCE_SCHEMA_OVERRIDE_ENV];
    else process.env[SOURCE_SCHEMA_OVERRIDE_ENV] = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

test('readSourceSchemaVersionSync parses schema version from override path', async () => {
  await withTempConstants(7, () => {
    const moduleUrl = pathToFileURL(path.resolve('dist/build-freshness.js')).href;
    const version = readSourceSchemaVersionSync(moduleUrl);
    assert.equal(version, 7);
  });
});

test('readSourceSchemaVersionSync returns undefined when constants file is missing', () => {
  const previous = process.env[SOURCE_SCHEMA_OVERRIDE_ENV];
  process.env[SOURCE_SCHEMA_OVERRIDE_ENV] = path.join(
    tmpdir(),
    `lcm-freshness-missing-${process.pid}-${Date.now()}.ts`,
  );
  try {
    const moduleUrl = pathToFileURL(path.resolve('dist/build-freshness.js')).href;
    const version = readSourceSchemaVersionSync(moduleUrl);
    assert.equal(version, undefined);
  } finally {
    if (previous === undefined) delete process.env[SOURCE_SCHEMA_OVERRIDE_ENV];
    else process.env[SOURCE_SCHEMA_OVERRIDE_ENV] = previous;
  }
});

test('readSourceSchemaVersionSync returns undefined when constant is absent', async () => {
  await withTempConstants(null, () => {
    const moduleUrl = pathToFileURL(path.resolve('dist/build-freshness.js')).href;
    const version = readSourceSchemaVersionSync(moduleUrl);
    assert.equal(version, undefined);
  });
});

test('assertLocalBuildFreshnessSync is a no-op when source matches runtime', async () => {
  // Use the currently built STORE_SCHEMA_VERSION so the assert stays silent.
  const { STORE_SCHEMA_VERSION } = await import('../dist/constants.js');
  await withTempConstants(STORE_SCHEMA_VERSION, () => {
    const moduleUrl = pathToFileURL(path.resolve('dist/build-freshness.js')).href;
    assert.doesNotThrow(() => assertLocalBuildFreshnessSync(moduleUrl));
  });
});

test('assertLocalBuildFreshnessSync throws when source is newer than runtime', async () => {
  const { STORE_SCHEMA_VERSION } = await import('../dist/constants.js');
  await withTempConstants(STORE_SCHEMA_VERSION + 1, () => {
    const moduleUrl = pathToFileURL(path.resolve('dist/build-freshness.js')).href;
    assert.throws(
      () => assertLocalBuildFreshnessSync(moduleUrl),
      /Stale local opencode-lcm build detected/,
    );
  });
});

test('assertLocalBuildFreshnessSync accepts runtime newer than on-disk source', async () => {
  const { STORE_SCHEMA_VERSION } = await import('../dist/constants.js');
  if (STORE_SCHEMA_VERSION <= 0) return;
  await withTempConstants(STORE_SCHEMA_VERSION - 1, () => {
    const moduleUrl = pathToFileURL(path.resolve('dist/build-freshness.js')).href;
    assert.doesNotThrow(() => assertLocalBuildFreshnessSync(moduleUrl));
  });
});
