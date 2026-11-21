# credentials Specification

## Purpose
Obtain Claude Code OAuth credentials for the Anthropic provider, keep them fresh, and never let concurrent sessions revoke each other's tokens.

## Requirements

### Requirement: Credential sources
The plugin SHALL read Claude Code credentials from the macOS Keychain (every `Claude Code-credentials*` entry) first, and fall back to `~/.claude/.credentials.json`, or `$CLAUDE_CONFIG_DIR/.credentials.json` when that variable is set, on all platforms.

#### Scenario: Several Keychain entries
- **WHEN** the Keychain holds more than one `Claude Code-credentials*` entry
- **THEN** each entry is detected as a separate account without configuration

#### Scenario: No Keychain
- **WHEN** the platform has no Keychain or no entry is found
- **THEN** the credentials file is used

#### Scenario: Non-OAuth credentials
- **WHEN** the credentials are not OAuth based
- **THEN** the plugin falls through to standard API key auth

### Requirement: Token refresh
The plugin SHALL refresh a token that is near expiry directly through Anthropic's OAuth endpoint and write the result back to its source.

#### Scenario: Near expiry
- **WHEN** a request needs a token that is about to expire
- **THEN** the token is refreshed before the request is sent

### Requirement: Cross-process refresh lock
The plugin SHALL serialise refreshes of one account with a lock shared across processes so two sessions cannot rotate the same refresh token concurrently.

#### Scenario: Two sessions refresh together
- **WHEN** two OpenCode sessions need to refresh the same account at once
- **THEN** only one performs the refresh and the other reuses its result

### Requirement: auth.json fallback sync
The plugin SHALL sync credentials to OpenCode's `auth.json` as a fallback, writing both known locations on Windows.

#### Scenario: Sync after refresh
- **WHEN** credentials are refreshed
- **THEN** `auth.json` holds the current token

### Requirement: Credential state
The plugin SHALL classify each credential as `ok`, `refreshable` or `unusable`.

#### Scenario: Expired but recoverable
- **WHEN** the access token is expired and a refresh token exists
- **THEN** the state is `refreshable`, not `unusable`

## Gaps
- The Windows path and the Linux fallback are documented in the README but not exercised by CI.
