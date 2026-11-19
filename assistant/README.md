# Workspace assistant tools (CMD-1 / SBX-1)

`tools.json` is an **offline catalog** in Gemini function-calling format. It includes all registered commands, even commands that cannot be drafted. Regenerate it along with the SDK and OpenAPI artifacts (`npm run commands:generate`). The definitions and descriptions come from Zod and the command registry. `gemini.ts` converts from the shared tool definition and maps function calls to the sandbox HTTP API; a different provider can supply its own converter.

For a Gemini integration:

1. Have the signed-in person open a sandbox (`POST /api/v1/workspaces/:workspaceId/sandboxes`). Keep its short-lived assistant token on the application side; never put it in the model context.
2. Fetch `GET /api/v1/sandboxes/:sandboxId/tools` with that bearer token. Use `SYSTEM_PROMPT.md` as `systemInstruction`, the response's `tools` as Gemini's `config.tools`, and the returned workspace currency as context. This offers at most 25 functions, filtered by the sandbox admission boundary and the person's live and issued roles.
3. For each model function call, send the relative request from `sandboxRequestForGeminiCall` through the sandbox API with the same bearer. Return the response as a function response (including the function-call ID if present). Proposal calls go to `POST /:sandboxId/steps`, never the live command endpoint. On `find_command`, load only relevant returned declarations, replacing unused proposal tools.
4. `list_proposals` lists the one sandbox's current proposal and `preview_proposal` reads the stored step previews. These tools neither refresh nor apply a proposal. Acceptance, rechecking changed steps, and undo remain in the person's existing review UI with their own sign-in.

The older metered `/ai/process` and `/brain/*` APIs are separate request/response protocols. They are not granted this token or silently switched to a tool-using model.
