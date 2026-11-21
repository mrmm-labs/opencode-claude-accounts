# balancing-strategies Specification

## Purpose

Decide which account serves the next request. The decision is a pure function of members, quota, config and time, so it is testable without a Keychain, network or clock.

## Requirements

### Requirement: Strategy registry

The balancer SHALL provide the strategies `sticky`, `priority`, `least-loaded`, `least-used`, `round-robin`, `weighted`, `random`, `p2c` and `expiring` behind one exhaustive registry, and SHALL default to `sticky`.

#### Scenario: Default

- **WHEN** no strategy is configured
- **THEN** the current account serves until it is spent

#### Scenario: Priority

- **WHEN** strategy is `priority`
- **THEN** the first listed usable account is chosen

#### Scenario: Round robin

- **WHEN** strategy is `round-robin`
- **THEN** the next account in listed order is chosen each time, with the cursor kept per process

#### Scenario: Weighted

- **WHEN** strategy is `weighted` with `weights`
- **THEN** accounts are interleaved by weight (smooth weighted round robin)

#### Scenario: Power of two choices

- **WHEN** strategy is `p2c`
- **THEN** two accounts are sampled at random and the one with more headroom is kept

#### Scenario: Least loaded versus least used

- **WHEN** strategy is `least-loaded`
- **THEN** the account with the most quota headroom (Anthropic's utilisation) wins
- **WHEN** strategy is `least-used`
- **THEN** the account with the fewest served requests in the usage log wins

#### Scenario: Expiring

- **WHEN** strategy is `expiring`
- **THEN** each account is scored by unused weekly share per hour left before its weekly reset, and the highest score wins

### Requirement: List order is priority order

Ties and walk order SHALL follow the configured account order.

#### Scenario: Tie

- **WHEN** two accounts score equally
- **THEN** the one listed first wins

### Requirement: Rotation is opt-in

The plugin SHALL NOT rotate off an account on its own unless `autoSwitch` allows it, because every move starts a cold prompt cache on the new account.

#### Scenario: autoSwitch off

- **WHEN** `autoSwitch` is false and the current account crosses `switchAt`
- **THEN** no automatic move happens

### Requirement: Hot reload

The strategy and presets SHALL be re-read at each decision so edits apply without a restart.

#### Scenario: Strategy edited

- **WHEN** the config file changes strategy
- **THEN** the next decision uses the new strategy within `configReloadInterval`

## Gaps

- Thresholds (`switchAt`, `switchWindow`) are described under pools-and-health; their per-strategy applicability table lives in the README.
