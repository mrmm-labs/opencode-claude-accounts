# prefill-recovery Specification

## Purpose

Unwedge a session whose request ends with an assistant message on a model that refuses assistant prefill, by retrying once without the trailing assistant turn.

## Requirements

### Requirement: Opt-in recovery

The plugin SHALL retry only when the option is enabled (default off, because it is lossy) and only for the 400 `This model does not support assistant message prefill`.

#### Scenario: Disabled

- **WHEN** the option is off and the 400 arrives
- **THEN** the error is returned unchanged

#### Scenario: Enabled

- **WHEN** the option is on and that 400 arrives
- **THEN** one retry is sent with the trailing assistant turn removed

### Requirement: Safe refusal

The plugin SHALL NOT retry when the body cannot be parsed, does not end with an assistant turn, or consists only of assistant turns, and SHALL log `prefill_retry_skipped` with the reason.

#### Scenario: Only assistant turns

- **WHEN** stripping would leave an empty conversation
- **THEN** no retry is made and `prefill_retry_skipped` is logged

### Requirement: Observable outcomes

Every outcome SHALL be logged as `prefill_detected`, `prefill_recovered` (with `droppedAssistantTurns`), `prefill_retry_failed` or `prefill_retry_skipped`, and a recovery SHALL raise a toast.

#### Scenario: Recovered

- **WHEN** the retry succeeds
- **THEN** `prefill_recovered` is logged and a toast is shown
