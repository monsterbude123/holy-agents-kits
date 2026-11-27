# Vendored Third-Party References

This directory holds verbatim copies of external agent skills used to write the
standards in `../standards/`. They are **reference material only**. Do not edit
files here; the normative rules for building an external web app against new-api
live in `../standards/`.

Everything is copied without modification. Read the original license before
redistributing any content outside this repository.

## Inventory

| Directory | Source | Version | License file |
|-----------|--------|---------|--------------|
| `nextjs-react-typescript/` | vendored from a local Trae skills directory (`%USERPROFILE%\.trae-cn\skills\`) | unversioned (single `SKILL.md`) | none shipped by the source |
| `vercel-react-best-practices/` | vendored from the same directory; upstream author `vercel` | `1.0.0` (per `SKILL.md` front matter) | `SKILL.md` declares `license: MIT`; no separate LICENSE file in the source |

## What Was Copied

### `nextjs-react-typescript/`

The complete source directory: `SKILL.md` only.

### `vercel-react-best-practices/`

The complete source directory: `SKILL.md`, `README.md`, `AGENTS.md` (the
compiled 69-rule guide) and `rules/*.md` (one file per rule).

## What Was Excluded

- **`node_modules/` and `.git/`** are never copied from any source.

Current vendored size: roughly **418 KB / 76 files**（2026-11-27 实测）。

## How to Update

Re-run the copy from the original vendoring source directories after the
upstream skills update, then:

1. Keep `references/vendor/` well under 10 MB, with no binary or font assets.
2. Update the version column above if a vendored skill declares a new version.

Then re-read the relevant vendored files and update `../standards/` where the
upstream guidance changed. The vendored copies are not loaded at runtime by the
application under development; they only inform the standards.
