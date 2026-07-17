# CLAUDE.md

Rules Claude must follow when working in this repo.

## Project

Personal Telegram assistant bot. Node.js (>=18), ES modules, Express server, long-polling Telegram bot. Data lives in Google Sheets. Entry point: `src/server.js`. Run with `npm run dev`.

## Code style — keep it lean

- **No verbosity.** Prefer the smallest change that solves the problem. Do not add abstractions, helper layers, config options, or "future-proofing" that the current task doesn't need.
- **No noise in output.** Do not add `console.log` calls beyond what's needed for operating the bot (startup info, errors, and the existing chat-ID hint). Never log message contents or tokens.
- **Minimal comments.** Only comment things the code can't say itself (API quirks, non-obvious constraints). No banner comments, no restating what a line does.
- **Match existing patterns.** Follow the style already in `src/` — plain functions, one module per concern (telegram, sheets, llm, jobs, ...). Don't introduce classes, TypeScript, or new frameworks.
- **No new dependencies** unless truly required; propose it and explain why first.
- **Keep files small.** If a module grows past ~200 lines, prefer splitting by concern over nesting more logic.
- **User-facing bot messages must be short.** One or two lines where possible; no filler phrases.

## Testing — required for new features

- Every new feature (new command, new job, new module, new parsing logic) must ship with unit tests in the same change.
- Bug fixes get a regression test that fails before the fix.
- Use the built-in **`node:test`** runner with `node:assert/strict` — no test framework dependencies. Tests live in `test/`, named `<module>.test.js`, run via `npm test` (`node --test test/`).
- Test pure logic directly; stub external services (Telegram, Google Sheets, the LLM API) — tests must never make network calls or need real credentials.
- Run `npm test` and confirm it passes before declaring any change done.

## Safety

- Never read, print, or commit secrets: `.env`, `service-account.json`, `oauth-credentials.json`. If touching config, edit `.env.example` instead.
- Don't change the Google Sheet tab names or column layouts without being asked — the sheet is live data.
