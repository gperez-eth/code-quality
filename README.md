![Code Quality](https://img.shields.io/badge/status-early%20design-orange.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Design](https://img.shields.io/badge/design-Stitch-4285F4.svg)

Hey! 👋 **Code Quality** is a self-hosted code quality dashboard, in the spirit
of SonarQube: it scans a codebase, tracks quality gates over time, and surfaces
the stuff that actually slows teams down — smells, duplication, complexity,
coverage gaps — in one place.

> **Status: early design.** There's no running code here yet. The first
> milestone is turning the [Stitch](https://stitch.withgoogle.com) UI design
> into a working dashboard. This README describes where the project is
> headed, not what's shipped.

Code Quality aims to offer:

- 📊 A project-level dashboard with quality gates (pass/fail thresholds you define)
- 🧹 Code smell, duplication and complexity detection across common languages
- 🧪 Coverage tracking, pulled in from your existing test reports
- 📈 Historical trends so regressions show up before they pile up
- 🔌 CI integration — fail a pipeline on a broken quality gate
- 🧩 Pluggable analyzers, so new languages/rules don't require a rewrite

## Status & roadmap

| Milestone | State |
| --- | --- |
| UI/UX design (Stitch) | 🟡 In progress |
| Project scaffold | ⬜ Not started |
| Analysis engine | ⬜ Not started |
| Dashboard (web) | ⬜ Not started |
| CI integration | ⬜ Not started |

## Contributing

This project is just getting started — issues and ideas are welcome, but
expect things to move fast and break while the core shape settles.

## License

[MIT](LICENSE) © Guillermo Pérez ([gperez-eth](https://github.com/gperez-eth))

Thanks for reading this far — more coming soon! 💙
