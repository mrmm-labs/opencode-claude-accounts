## Root cause

`mostRecentlyObserved(quota)` returns a cache key. `accountKey()` writes the account id when one is registered, so the key is an id, while `accounts` carry Keychain sources. `quotaEntry` already reads both spellings; the active-account inference did not.

## Decisions

- **Resolve by read keys.** A cache or usage-log key belongs to an account when it is in `accountReadKeys(source)`. The key lookup is injectable so tests need no disk.
- **Session first.** The TUI cannot see the server's in-memory binding, but every request event carries the session id and the account. The newest event for the chip's session is the account serving it. A session with no event yet (a fresh or subagent session) falls back to the newest observation in the quota cache, which is also resolved. "no account" is only shown when nothing has been observed.
- **Reuse the tail reader.** `tailRequests` is incremental and already feeds the sidebar's request shares; rows gain an optional `session`.
- **Group by reference.** `groupOf` resolves each group's references the same way `groupRows` does; an ungrouped account shows no group.
- **Chip format**, one line beside the prompt:
  - preset: `⇄ <strategy> · <group> → <account> · 5h <pct>`
  - auto: `⇄ auto · <group> → <account> · 5h <pct>`
  - pinned: `📌 pinned · <group> → <account> · 5h <pct>`
  - strategy tags: round-robin `rr`, least-loaded `ll`, least-used `lu`, weighted `wt`, others as named; a preset with no strategy shows its name.
  - group cut to 8 cells, account to 12, with `…`; no group drops `<group> → `.
- The chip takes display names from the same map as the sidebar rather than deriving its own.
