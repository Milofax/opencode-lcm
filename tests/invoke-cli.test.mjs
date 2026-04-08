import assert from 'node:assert/strict';
import test from 'node:test';

import { CLIExitError, CLISpawnError, CLITimeoutError, invokeCLI } from '../dist/invoke-cli.js';

test('invokeCLI returns stdout for successful commands', async () => {
  const output = await invokeCLI({ command: 'echo', args: ['hello'] });

  assert.equal(output, 'hello\n');
});

test('invokeCLI delivers stdin to the child process', async () => {
  const output = await invokeCLI({ command: 'cat', args: [], stdin: 'test input' });

  assert.equal(output, 'test input');
});

test('invokeCLI preserves large stdin payloads', async () => {
  const stdin = '0123456789'.repeat(1024);
  const output = await invokeCLI({
    command: 'cat',
    args: [],
    stdin,
    maxOutputChars: stdin.length + 10,
  });

  assert.equal(output, stdin);
  assert.equal(output.length, 10_240);
});

test('invokeCLI throws CLIExitError on non-zero exit codes', async () => {
  await assert.rejects(
    () => invokeCLI({ command: 'node', args: ['-e', 'process.exit(42)'] }),
    (error) => {
      assert.ok(error instanceof CLIExitError);
      assert.equal(error.exitCode, 42);
      assert.match(error.message, /code 42/);
      return true;
    },
  );
});

test('invokeCLI throws CLITimeoutError when the command exceeds timeoutMs', async () => {
  await assert.rejects(
    () => invokeCLI({ command: 'sleep', args: ['10'], timeoutMs: 200 }),
    (error) => {
      assert.ok(error instanceof CLITimeoutError);
      assert.equal(error.timeoutMs, 200);
      assert.match(error.message, /timed out/);
      return true;
    },
  );
});

test('invokeCLI throws CLISpawnError for missing commands', async () => {
  await assert.rejects(
    () => invokeCLI({ command: 'nonexistent_command_xyz', args: [] }),
    (error) => {
      assert.ok(error instanceof CLISpawnError);
      assert.equal(error.cause.code, 'ENOENT');
      assert.match(error.message, /Failed to spawn CLI command/);
      return true;
    },
  );
});

test('invokeCLI truncates stdout to maxOutputChars', async () => {
  const output = await invokeCLI({
    command: 'node',
    args: ['-e', 'process.stdout.write("x".repeat(500))'],
    maxOutputChars: 100,
  });

  assert.equal(output.length, 100);
  assert.match(output, /^x+$/);
});
