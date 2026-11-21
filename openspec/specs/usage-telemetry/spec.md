# usage-telemetry Specification

## Purpose
Record which account served each request and every rotation, so usage and refusals can be reported. The quota cache only answers how full an account is.

## Requirements

### Requirement: Append-only usage log
Every response SHALL append one JSONL row to `usage.jsonl` holding account, session, model, status, duration, reported utilisation and cache use, and every rotation SHALL be recorded.

#### Scenario: Response served
- **WHEN** a response completes
- **THEN** a row naming the serving account is appended

### Requirement: Bounded log
The file SHALL be capped and roll over to `.1`. `least-used` SHALL read it through a 30 second cache.

#### Scenario: Cap reached
- **WHEN** the log exceeds its cap
- **THEN** it rolls over and the previous content is kept as `.1`

### Requirement: Utilisation samples
Utilisation samples SHALL be kept for a week in `samples.jsonl` to drive the pace forecast in the TUI.

#### Scenario: Sample recorded
- **WHEN** a quota reading is captured
- **THEN** a sample is appended

### Requirement: No runtime dependencies
Telemetry SHALL use plain JSONL, not SQLite, because the plugin has no runtime dependencies and runs under Bun in OpenCode and Node in tests.

#### Scenario: Install
- **WHEN** the package is installed
- **THEN** no native module is required

## Gaps
- The exact cap and retention of `samples.jsonl` are not stated in the README.
