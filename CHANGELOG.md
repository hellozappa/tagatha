# Changelog

All notable changes to Tagatha are documented in this file.

## [Unreleased]

### Fixed

- Wait for a space, Tab, or Return before synchronizing an active note's tag.
- Reject stale cached tag prefixes and offsets while editing.

### Added

- Add a vault installer with runtime backups, asset comparison, dry-run support,
  and an optional Obsidian CLI reload that preserves plugin settings.

## [1.0.0] - 2026-09-26

### Added

- Add the **Synchronize tag removals** setting, disabled by default.
- Remove tags from frontmatter when synchronized inline tags are removed, and
  remove matching inline tags when synchronized frontmatter tags are removed.
- Track per-note tag state so pre-existing frontmatter-only tags are not
  mistaken for removals.

### Changed

- Document default append-only behavior and the optional two-way removal mode.
- Expand automated coverage for removal planning, property updates, normalized
  matching, and inline-tag text updates.
- Require Obsidian 1.13.0 or later.

## [0.1.0] - 2026-09-26

### Added

- Copy inline body tags into the note's YAML `tags` property.
- Preserve existing tags while avoiding case-insensitive duplicates.
- Support multiple and nested tags such as `#client/billing`.
- Add automated tests, continuous integration, and tagged GitHub releases.
