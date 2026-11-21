# request-capture Specification

## Purpose
Let the operator measure what each request carries (system prompt blocks, tool schemas, conversation) without recording conversation content unless explicitly asked.

## Requirements

### Requirement: Capture levels
`captureRequests` SHALL accept `off`, `shape`, `full` and `messages`, default `off`. `shape` records sizes, hashes and an 80-character head; `full` adds the system text; `messages` adds the conversation verbatim.

#### Scenario: Default
- **WHEN** no capture level is set
- **THEN** nothing is recorded

### Requirement: Content only at messages
Message content MUST NOT appear in records at `shape` or `full`, and no level SHALL imply `messages`.

#### Scenario: Known string
- **WHEN** a request contains a known string and the level is `shape` or `full`
- **THEN** the string is absent from the captured output

### Requirement: Hot reload
The level SHALL be hot-reloadable so it can be turned on, used and turned off without a restart.

#### Scenario: Turned off
- **WHEN** the level is set back to `off`
- **THEN** recording stops on the next request

### Requirement: Report
`pnpm prompt` SHALL break the system prompt into blocks largest first with the file each came from, list per-tool schema cost, and separate fixed overhead from conversation. Blocks composed programmatically by OpenCode SHALL be reported as `unattributed`.

#### Scenario: Programmatic block
- **WHEN** a block has no source file
- **THEN** it is listed as `unattributed`

### Requirement: Log redaction
The structured debug log SHALL redact `accessToken`, `refreshToken` and `x-api-key` by key name at the top level, and payloads SHALL be flat scalars.

#### Scenario: Token key logged
- **WHEN** a payload includes an `accessToken` field
- **THEN** its value is redacted

## Gaps
- Redaction is key-based and top-level only; a nested or renamed field would leak. Enforced by convention (AGENTS.md section 5), not by code.
