# Salesforce Health Dictionary — SBU & XBU Production

Technical health checks and field-level metadata for both production orgs, regenerated
monthly. It is the admin-facing companion to the
[Salesforce Data Dictionary](https://github.com/lhaigyQuilt/Salesforce-Data-Dictionary),
and deliberately separate from it: its own repo, scan, schedule and site.

- **SBU Production** — POS Nation · Quilt Software, CLI alias `production`
- **XBU Production** — Rain POS, CLI alias `xbu`

The built page is [`salesforce-health-dictionary.html`](salesforce-health-dictionary.html):
one self-contained file. It opens on **Org health** (a scorecard per org, then every
finding grouped by category and check, filterable by org, category, priority and object);
**Open the health dictionary** switches to a field explorer with the technical details
of every field: fill rate, who created and last changed it, findings, limits and
automation per object.

## The checks

All checks are defined in one list, `CHECKS` in `analyze.js` (title, priority, why it
matters, what to do). Field checks apply to fields each org built itself; managed-package
fields are left out because they can't be edited.

| Category | Check | Priority |
|---|---|---|
| Documentation | Custom field has no description | Medium |
| | Input field has no help text | Low |
| | Custom object has no description | Medium |
| Naming | Field label does not match its API name | Medium |
| | Field label only partly matches its API name | Low |
| | Two or more fields share the same label | Medium |
| | Field is marked old, test or do-not-use | Medium |
| | API name looks like a copy or second version (`_2`, `_v2`, `_New`, `_Copy`…) | Low |
| Usage | Custom field is never filled in | High |
| | Custom field is filled in on under 1% of records | Medium |
| | Custom object has no records | Medium |
| Limits | Object at 80%+ of its custom field / roll-up / relationship limit | High |
| | Formula over 3,000 characters (limit 3,900) | Medium |
| | Picklist with more than 200 active values | Low |
| Automation | Active workflow rule (retired feature) | High |
| | Active Process Builder (retired feature) | High |
| | More than five record-triggered flows on one save | Medium |
| | Apex triggers and record-triggered flows on the same object | Low |
| | Inactive flows, Process Builders, workflow and validation rules | Low |
| Packages | Installed package whose objects are all empty | Medium |

**Name matching** ignores case, punctuation, word order and filler words (of, the, a…),
so `# of Jobs/Month?` matches `of_Jobs_Month__c`. Half or more words in common is a
*partial* match; less is a *mismatch*.

**Fill rates** are `COUNT(field)` aggregate queries — the number of records with a value.
They run on every custom object plus the key standard objects listed in `scan_tech.js`
(`KEY_OBJECTS`). Checkboxes (never empty), formulas, roll-ups, auto numbers and long text
areas (Salesforce can't count them) aren't measured. Fields and objects created in the
last 90 days are exempt from the usage checks.

## Files

| File | |
|---|---|
| `scan_tech.js` | per org: describes, CustomField/CustomObject provenance, EntityLimit, flows, triggers, validation and workflow rules, packages, fill rates → `<org>_tech.json` |
| `analyze.js` | the checks → `health.json`; appends the run's counts to `history.json` |
| `build_health_html.js` | builds the page from the above, `style.css` and `app.js` |
| `app.js` | the page's code (landing + explorer) |
| `style.css` | the look, copied from the data dictionary so the two match |
| `validate_health.js` | pre-publish checks |
| `refresh_health.cmd` | the monthly run |

`history.json` is what makes trends work: each run adds one line, and the scorecard
compares against the line before it.

## Refreshing

`refresh_health.cmd` pulls, rescans both orgs, reruns the checks, rebuilds, validates,
commits and pushes. A failed step aborts and is logged in `refresh.log`; if only the
push fails, the commit stays local, the log ends `COMMITTED BUT PUSH FAILED`, and the task
exits 2 — run `git push` by hand.

It runs as Windows Task Scheduler job **"SF Health Dictionary Refresh"**, monthly on the
1st, as the signed-in user, so the sf CLI logins for `production`/`xbu` and the Git
Credential Manager login must both be valid. A full run takes about 10 minutes.

Rebuild locally without rescanning:

```
node analyze.js && node build_health_html.js && node validate_health.js
```

## Requirements

- Node 20+ (built-in `fetch`, `zlib`; no dependencies)
- Salesforce CLI authenticated to both orgs; the CLI path `C:/Program Files/sf/client/bin/run.js`
  is hardcoded in `scan_tech.js`
- Read-only access is enough: nothing is written to either org
- Viewing needs a browser with `DecompressionStream` (current Chrome, Edge, Firefox, Safari)

## Hosting

`server.js` serves the page at `/` (plus `/health.json`, `/history.json`, `/healthz`) for
Railway or any host that sets `PORT`: `npm start`. There is no build script on purpose —
the page is built and committed by the refresh.
