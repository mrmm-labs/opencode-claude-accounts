## ADDED Requirements

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
