import { createHash } from "node:crypto";
import {
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  rename,
  rm,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { build } from "esbuild";

// Each Stryker sandbox keeps the same instrumented source and changes only the active
// mutant environment variable. Bundle once, retaining those runtime checks. Validate
// every bundled input before reuse so ordinary manual source edits cannot use stale code.
const directory = "work/mutation/test-bundles";
const manifestPath = `${directory}/inputs.json`;
const digest = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
let inputs;
try {
  inputs = JSON.parse(await readFile(manifestPath, "utf8"));
} catch {
  /* first run */
}
const reusable =
  inputs &&
  (
    await Promise.all(
      Object.entries(inputs).map(async ([path, expected]) => {
        try {
          return (await digest(path)) === expected;
        } catch {
          return false;
        }
      }),
    )
  ).every(Boolean);
if (!reusable) {
  await mkdir(directory, { recursive: true });
  const staging = await mkdtemp("work/mutation/test-bundles-build-");
  const result = await build({
    entryPoints: [
      "src/tests/money-mutation.test.ts",
      "src/tests/money-mutation-hourly.test.ts",
      "src/tests/tax-codes.test.ts",
    ],
    outdir: staging,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    metafile: true,
  });
  const paths = [
    ...Object.keys(result.metafile.inputs),
    "package.json",
    "package-lock.json",
    "scripts/test-money-mutation.mjs",
  ];
  inputs = Object.fromEntries(
    await Promise.all(paths.map(async (path) => [path, await digest(path)])),
  );
  // Parallel runners may publish identical bundles; atomic renames prevent partial reads.
  for (const name of [
    "money-mutation.test.mjs",
    "money-mutation-hourly.test.mjs",
    "tax-codes.test.mjs",
  ])
    await rename(`${staging}/${name}`, `${directory}/${name}`);
  await writeFile(`${staging}/inputs.json`, JSON.stringify(inputs));
  await rename(`${staging}/inputs.json`, manifestPath);
  await rm(staging, { recursive: true });
}
const child = spawn(
  process.execPath,
  [
    "--test",
    `${directory}/money-mutation.test.mjs`,
    `${directory}/money-mutation-hourly.test.mjs`,
    `${directory}/tax-codes.test.mjs`,
  ],
  {
    stdio: "inherit",
    env: process.env,
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
