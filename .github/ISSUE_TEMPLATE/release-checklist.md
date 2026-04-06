---
name: Release checklist
about: Track pre-release validation before publishing gallery updates
title: "Release checklist: "
labels: [release]
assignees: []
---

## Scope

- Branch or commit:
- Planned release window:
- Target URL (prod or preview):

## Pre-release Validation

- [ ] Open [Pre-release Check workflow](../../actions/workflows/pre-release-check.yml)
- [ ] Click "Run workflow"
- [ ] Set target_url (optional if SITE_URL repository variable is set)
- [ ] Confirm workflow passed
- [ ] Confirm workflow run URL is linked below

Workflow run URL:

## Manual Verification

- [ ] Home page loads and main heading appears
- [ ] Album rail renders and switches correctly
- [ ] Photos load and "Load more" works
- [ ] Lightbox open/close and left/right navigation works
- [ ] Retry button behavior verified during API failure simulation
- [ ] /healthz.txt returns ok
- [ ] /404.html renders custom not found page

## Security Verification

- [ ] CSP header present
- [ ] X-Content-Type-Options header present
- [ ] Referrer-Policy header present
- [ ] X-Frame-Options header present
- [ ] HSTS header present

## Sign-off

- [ ] Release approved
- [ ] Notes and follow-ups documented
