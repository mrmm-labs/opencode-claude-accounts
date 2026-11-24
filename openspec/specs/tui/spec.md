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

### Requirement: Prompt chip names the serving account

The prompt-side chip SHALL show the routing mode, the group and the account serving the current session, taken from that session's most recent request, else from the newest quota observation. It SHALL show "no account" only when neither exists. It SHALL fit one line by cutting group and account names with an ellipsis.

#### Scenario: Preset with group

- **WHEN** a preset with strategy `round-robin` is selected and the session was last served by an account in group `Main`
- **THEN** the chip reads `⇄ rr · Main → <account> · 5h <pct>`

#### Scenario: Id-keyed cache

- **WHEN** the quota cache is keyed by account id rather than Keychain source
- **THEN** the chip still names the account

#### Scenario: Session served by another account

- **WHEN** the session's last request went to a different account than the newest observation overall
- **THEN** the chip names the session's account

#### Scenario: Subagent or fresh session

- **WHEN** the session has no request yet
- **THEN** the chip names the account from the newest quota observation

#### Scenario: Nothing observed

- **WHEN** no session request and no quota observation exist
- **THEN** the chip reads "no account"

#### Scenario: Long names

- **WHEN** a group or account name exceeds its width
- **THEN** it is cut with an ellipsis

## Gaps

- Per-surface rendering rules are in src/tui/SURFACES.md; only the behaviours above are captured here.
- Slash command naming has changed repeatedly (4.0.0 replaced /cc-\*, a later change restored it); verify against tui/claude-auth-tui.tsx before relying on this list.
