#!/bin/sh
# Historical exploratory probe. Run only in a trusted environment with llamaindex
# already installed locally; this script never installs packages or edits files.
set -eu
node --input-type=module -e '
let module;
try {
  module = await import("llamaindex");
} catch (error) {
  console.error("Could not load the locally installed llamaindex package:", error.message);
  process.exitCode = 1;
}
if (module) {
  const { LlamaParseReader } = module;
  if (typeof LlamaParseReader !== "function") {
    console.error("This llamaindex version does not export LlamaParseReader.");
    process.exitCode = 1;
  } else {
    console.log(LlamaParseReader);
    console.log(Object.getOwnPropertyNames(LlamaParseReader.prototype));
  }
}
'
