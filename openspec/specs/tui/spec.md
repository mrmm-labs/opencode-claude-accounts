# tui Specification

## Purpose
Show account state and offer controls inside OpenCode's TUI, which is a separate plugin entry loaded in a separate process from the server plugin.

## Requirements

### Requirement: File-based coupling
The TUI plugin SHALL share state with the server plugin only through files (selection, quota cache, usage log, samples, identities, config), so it works whether or not the server plugin runs in the same process.

#### Scenario: Selection from the TUI
- **WHEN** the operator picks an account in the TUI
- **THEN** the selection file changes and the server applies it on its next request

### Requirement: Always-on sidebar
The sidebar SHALL show a Claude Auth section with each account's quota, collapsible group headings with aggregate room (accounts with no reading count as none, coloured by the worst member), and accounts in no group under **Other**.

#### Scenario: Groups configured
- **WHEN** groups are configured
- **THEN** one collapsible heading per group appears in config order

### Requirement: Account management
The TUI SHALL let the operator edit groups, presets and balancing config, and a group delete confirmation SHALL name any preset that routes to it.

#### Scenario: Delete routed group
- **WHEN** a group used by a preset is deleted
- **THEN** the confirmation names that preset

### Requirement: Slash commands
The plugin SHALL provide a `/claude` command, a `/cc` entry, and one `/cc-<sub>` entry per sub-command.

#### Scenario: Sub-command entry
- **WHEN** the operator types `/cc-config`
- **THEN** the config dialog opens

## Gaps
- Per-surface rendering rules are in src/tui/SURFACES.md; only the behaviours above are captured here.
- Slash command naming has changed repeatedly (4.0.0 replaced /cc-*, a later change restored it); verify against tui/claude-auth-tui.tsx before relying on this list.
