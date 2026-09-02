# Archived codemod scripts

One-off patch/fix scripts that were previously in the repository root. They were
already applied to the codebase; nothing in the build references them
(`package.json` scripts, `vite.config.ts`, `tsconfig.json`, and `src/` were all
checked — zero references).

They were moved here rather than deleted so the history and the scripts
themselves remain available. Moving them out of the root makes `src/` visible
when browsing the repository.
