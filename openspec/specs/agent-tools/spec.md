# agent-tools Specification

## Purpose
Expose the account controls to the agent inside a session through the plugin's own tool hook.

## Requirements

### Requirement: Registered tools
The plugin SHALL register `claude_accounts_status`, `claude_accounts_switch` and `claude_accounts_usage` through its `tool` hook rather than a separate MCP server.

#### Scenario: Status
- **WHEN** `claude_accounts_status` is called
- **THEN** it reports who serves now, what is selected, and each account's verdict with the reason, with per-group aggregates when groups exist

#### Scenario: Switch
- **WHEN** `claude_accounts_switch` is called with a preset, an account, `auto` or `clear`
- **THEN** it writes the selection file and nothing in flight is cancelled

#### Scenario: Usage
- **WHEN** `claude_accounts_usage` is called
- **THEN** it reports per-account requests, share, refusals, latency and rotations

### Requirement: Tools can be disabled
`"tools": false` SHALL turn the tool set off and leave the CLI available, because tool descriptions occupy model context for the whole session.

#### Scenario: Disabled
- **WHEN** `tools` is false
- **THEN** none of the three tools is registered

## Gaps
- `@opencode-ai/plugin` is imported for a value only in src/ui/tools.ts, dynamically; this is a structural rule checked by check:structure, not a behavioural requirement.
