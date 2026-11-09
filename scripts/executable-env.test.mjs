import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { executableEnv } from './executable-env.mjs';

test('tool PATH override accepts only a single absolute directory, leaving default untouched', () => {
  const env = { PATH: 'legacy:path', Path: 'other', HOME: '/home/test' };
  assert.equal(executableEnv('TOOL_DIR', env), env);
  for (const value of ['', '.', 'relative', `${path.resolve('tools')}${path.delimiter}${path.resolve('elsewhere')}`]) {
    assert.throws(() => executableEnv('TOOL_DIR', { ...env, TOOL_DIR: value }), /one absolute directory/);
  }
  const dir = path.resolve('tools');
  const result = executableEnv('TOOL_DIR', { ...env, TOOL_DIR: dir });
  assert.equal(result.PATH, dir);
  assert.equal(result.Path, undefined);
  assert.equal(result.HOME, env.HOME);
  assert.equal(env.PATH, 'legacy:path');
});
