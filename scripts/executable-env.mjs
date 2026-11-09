import path from 'node:path';

/** Optional single-directory PATH for a subprocess. The caller must trust that
 * directory and the executable; this cannot verify ownership or other env vars. */
export function executableEnv(variable, env = process.env) {
  const directory = env[variable];
  if (directory === undefined) return env;
  if (!directory || !path.isAbsolute(directory) || directory.includes(path.delimiter)) {
    throw new Error(`${variable} must be one absolute directory`);
  }
  const clean = Object.fromEntries(Object.entries(env).filter(([key]) => key.toUpperCase() !== 'PATH'));
  clean.PATH = directory;
  return clean;
}
