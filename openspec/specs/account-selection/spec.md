# account-selection Specification

## Purpose

Let the operator choose which account, preset or mode serves requests, switchable mid-task without re-authenticating or interrupting running agents.

## Requirements

### Requirement: Selection file

The current selection (an account, a preset, or auto) SHALL be stored in `selection.txt` under the plugin state directory and re-read on the next request.

#### Scenario: Written mid-task

- **WHEN** another process writes the selection file while OpenCode runs
- **THEN** the next request uses the new selection with nothing cancelled

### Requirement: Switching never re-authenticates

The token SHALL be resolved per request inside the plugin's `fetch`, so changing the active account takes effect on the next call without reloading the provider.

#### Scenario: Switch during a subagent run

- **WHEN** the account is switched while subagents run
- **THEN** they are not cancelled and use the new account from their next request

### Requirement: Pins

An explicit choice of one account SHALL pin it: the balancer MUST NOT move off it on threshold or refusal. Choosing something else SHALL apply immediately. A config option MAY make a pin a starting point only. Provider auth running with no selection MUST NOT record a pin.

#### Scenario: Pinned account is spent

- **WHEN** the pinned account crosses `switchAt`
- **THEN** the plugin stays on it

### Requirement: autoSwitch scope

`autoSwitch` SHALL govern only moves the plugin makes on its own initiative; an explicit selection SHALL be obeyed whatever its value.

#### Scenario: Preset with autoSwitch off

- **WHEN** `autoSwitch` is false and the operator selects a preset
- **THEN** the preset takes effect

### Requirement: Rotation is never persisted

An automatic rotation SHALL NOT be written to the selection file.

#### Scenario: One window exhausts its account

- **WHEN** one OpenCode window rotates off a spent account
- **THEN** other windows and the stored selection are unchanged

### Requirement: Presets

A preset SHALL name accounts, order and strategy, and appear above the individual accounts in the switcher. A preset MUST declare either `accounts` or `pools`, never both. Accounts are named by exact Keychain source or a unique label fragment; an ambiguous fragment SHALL be refused, and an unknown preset name SHALL be ignored. `CLAUDE_AUTH_PRESET` SHALL select one for a single run.

#### Scenario: Ambiguous fragment

- **WHEN** a label fragment matches two accounts
- **THEN** it is refused rather than guessed

### Requirement: Groups

A group SHALL be a named set of accounts usable anywhere an account list is accepted, expanding in order. Groups MUST NOT nest. The group key is its id; `label` is only the display name.

#### Scenario: Group in a preset

- **WHEN** a preset lists a group name
- **THEN** the group's accounts take its place, in order

#### Scenario: Rename

- **WHEN** a group is renamed in the TUI
- **THEN** only its label changes and no preset breaks

### Requirement: Per-session accounts

When enabled, each OpenCode session (including subagents) SHALL be bound to an account, keep it while usable, and move only when its own account is spent. The binding is per process and not persisted, and a session's token MUST be resolved against its own account without mutating the global active account.

#### Scenario: Parallel subagents

- **WHEN** several subagent sessions run in parallel
- **THEN** they spread across accounts and each keeps its account while it is usable

## Gaps

- `opencode auth login` selection re-initialises the provider and cancels in-flight work; this is documented but not prevented.
