# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.3] - 2026-05-12

Initial public release.

### Added
- Context-aware completions for play keywords, task keywords, module FQCNs, and module options.
- Hover documentation for modules and keywords.
- 10 lint rules: name-required, fqcn-required, yaml-truthy, no-changed-when, key-order, jinja-spacing, no-duplicate-keys, play-has-hosts, deprecated-modules, no-free-form.
- Go-to-definition for `include_tasks`, `import_tasks`, `vars_files`, `roles`, and template `src` paths.
- Pre-generated module data for 120+ Ansible collections (~8900 modules).
- Zed extension wrapper that auto-installs the server from npm.

[Unreleased]: https://github.com/Ericlein/ansible-lint-win/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/Ericlein/ansible-lint-win/releases/tag/v0.1.3
