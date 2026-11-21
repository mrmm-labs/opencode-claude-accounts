# pools-and-health Specification

## Purpose
Derive account health from Anthropic's rate-limit response headers and organise accounts into failover tiers, so a spent account is skipped and recovers on its own reset time.

## Requirements

### Requirement: Health from rate-limit headers
The plugin SHALL parse the `anthropic-ratelimit-unified-*` response headers into a per-account quota cache holding the 5h and 7d windows and their reset epochs. An account SHALL be spent when utilisation is at least `switchAt` (default 0.95) or the server reports `rejected`, and SHALL be healthy again once the window's reset time passes.

#### Scenario: Threshold crossed
- **WHEN** a response reports utilisation at or above `switchAt`
- **THEN** the account is treated as spent until its reset

#### Scenario: Window reset
- **WHEN** the reset time of the limiting window passes
- **THEN** the account is healthy again with no stored expiry

### Requirement: Bounded ejection without a reset time
A refusal that carries no reset time SHALL eject the account for `ejectFor` (default 5 minutes), backing off on each consecutive failure.

#### Scenario: Repeated refusal
- **WHEN** an account is refused twice in a row without a reset time
- **THEN** the second ejection is longer than the first

### Requirement: Pools as failover tiers
Pools SHALL be tried in order, and a tier SHALL be reached only when every account above it is spent. A pool MAY override `strategy` and set per-account `weights`. Without `pools`, all accounts form one tier, and `accounts` selects a subset in preference order.

#### Scenario: Fallback tier
- **WHEN** every account in tier one is spent
- **THEN** a usable account from tier two serves the request

### Requirement: All accounts spent
When every account in every tier is spent, the plugin SHALL stay on the current account, log `rotate_skipped_all_spent` naming the account that frees first, and rely on the quota advisory toast.

#### Scenario: Nothing usable
- **WHEN** all accounts are spent
- **THEN** no move happens and the log names the first account to free up

### Requirement: Evaluation points
Rotation SHALL be evaluated after each response and after a refusal, never on a timer while idle.

#### Scenario: Spent account noticed
- **WHEN** a response pushes the account past `switchAt`
- **THEN** the next request goes to another account

### Requirement: Notification of automatic moves
Every automatic move SHALL raise a toast naming the new account, because the provider label cannot be rewritten mid-session.

#### Scenario: Auto move
- **WHEN** the plugin moves accounts on its own
- **THEN** a toast names the account it moved to

## Gaps
- Retry pacing for spent pools is recorded in docs/adr/0003; not restated here.
