## Why

The prompt-side chip reads `⇄ rr-123 · no account · 5h 16%` while a session is running. Two faults:

- **"no account" is wrong.** The TUI infers the serving account from the newest `observedAt` in the quota cache, but that cache is keyed by account id on migrated installs. The id is then compared with a Keychain source, never matches, and the chip falls back to "no account". The sidebar's active marker uses the same inference.
- **The mode text is the raw preset id.** `rr-123` says nothing about how requests are routed or which group is serving.

## What Changes

- The serving account is resolved from the session's own last request in the usage log (the chip slot is handed a session id), falling back to the newest observation in the quota cache, and the quota key is mapped back to an account before it is compared.
- The chip shows strategy, group and account: `⇄ rr · Main → Team 1 · 5h 16%`.
- Chip and sidebar use the same resolution, so the sidebar's active marker works on migrated installs too.

Out of scope: the picker, the sidebar layout, and the server-side session binding (it stays in the server process; the TUI reads the usage log, per the file-coupling rule).

No config keys, files or tools are added; nothing is off by default because nothing spends quota.

## Capabilities

### Modified Capabilities

- `tui`: adds the prompt chip requirement.

## Impact

`src/tui/chip.ts`, `src/tui/groups.ts`, `src/balance/usage.ts` (session on the tail rows), `tui/claude-auth-tui.tsx`.
