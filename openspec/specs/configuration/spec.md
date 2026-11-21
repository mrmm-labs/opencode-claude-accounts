# configuration Specification

## Purpose
Layered, hot-reloadable configuration that is reachable from the config file, the environment and the TUI.

## Requirements

### Requirement: Layer precedence
Config SHALL be resolved from defaults, then the user file, then the project file, then inline config, then environment, with later layers winning.

#### Scenario: Env overrides file
- **WHEN** a key is set in both the user file and the environment
- **THEN** the environment value applies

### Requirement: Hot reload
The config file SHALL be re-read on a stat check so edits apply within `configReloadInterval` without a restart.

#### Scenario: File edited
- **WHEN** the config file changes while OpenCode runs
- **THEN** the new values apply within `configReloadInterval`

### Requirement: Unparseable env values are dropped
An unparseable environment value SHALL be dropped rather than replaced with the default, so a typo cannot override the config file.

#### Scenario: Typo in env
- **WHEN** an env var holds a value that does not parse
- **THEN** the file's value is kept

### Requirement: Surface parity
Every config key SHALL be reachable from the file, the environment and the TUI; a test enumerates the config type to keep it so.

#### Scenario: New key
- **WHEN** a key is added to the config type without an env mapping
- **THEN** the parity test fails

## Gaps
- Which keys are TUI-editable is a table in the README, not restated here.
