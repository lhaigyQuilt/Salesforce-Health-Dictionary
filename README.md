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
| Security | Credential written into a formula, description or help text (any field, managed included) | High |
| Documentation | Custom field has no description | Medium |
| | Input field has no help text | Low |
| | Custom object has no description | Medium |
| Naming | Field label does not match its API name | Medium |
| | Field label only partly matches its API name | Low |
| | Two or more fields share the same label | Medium |
| | Field is marked old, test or do-not-use | Medium |
| | API name looks like a copy or second version (`_2`, `_v2`, `_New`, `_Copy`…) | Low |
| Field health | Retire candidate (Field Health action) | High |
| | Recently stopped being populated — did a process break? | Medium |
| | Rarely used (under 1% of records since creation) | Medium |
| | Required field that is never populated | Medium |
| | Formula with no usage signal (unreferenced, or a single constant value) | Low |
| | Adopted more than a year after it was created | Low |
| Usage | Custom object has no records | Medium |
| Limits | Object at 80%+ of its custom field / roll-up / relationship limit | High |
| | Formula over 3,000 characters (limit 3,900) | Medium |
| | Picklist with more than 200 active values | Low |
| Automation | Active workflow rule (retired feature) | High |
| | Active Process Builder (retired feature) | High |
| | More than five record-triggered flows on one save | Medium |
| | Apex triggers and record-triggered flows on the same object | Low |
| | Inactive flows, Process Builders, workflow and validation rules | Low |
| Packages | Installed package whose objects are all empty | Medium |

**Credentials are never stored.** `redact.js` blanks anything that looks like an API key,
token, private key or a credential in a URL or assignment before the scan saves it, and
the Security check reports the field. (The Zenkraft `zkmulti__LocationOnMap__c` formula
ships a Google Maps key; GitHub secret scanning caught it in the first commit.)

**Name matching** ignores case, punctuation, word order and filler words (of, the, a…),
so `# of Jobs/Month?` matches `of_Jobs_Month__c`. Half or more words in common is a
*partial* match; less is a *mismatch*.

## Field Health score

Every field on a measured object (every custom object plus the key standard objects in
`scan_tech.js` → `KEY_OBJECTS`) gets the score from the **"&lt;Object&gt; Field Health
Analysis &lt;BU&gt;.xlsx" workbooks**: same columns, same formulas, same Scoring Model inputs.
`fieldscore.js` holds it — `MODEL` mirrors the workbook's Scoring Model tab (weights 25 /
25 / 20 / 5 / 20 / 5; bands 75 / 55 / 35 / 15; grace 90 days; 300 eligible records; 12
months dormancy; 1% Active; 1.5× Growing) and each function line names the Field Health
column it reproduces (Population, Recency, Trend, Info, Integration, Doc score → HEALTH
SCORE → Band → Classification → Action). Change a weight or threshold there.

The workbooks were built from a full record export of one object; that isn't practical for
every object every month, so the same measures come from aggregate queries:

| Measure | How it's measured here |
|---|---|
| Records populated by month | `COUNT(field)` grouped by `CALENDAR_YEAR/MONTH(CreatedDate)`, 50 fields per query; checkboxes `WHERE field = true`; multi-select picklists `WHERE field != null` |
| Since creation, last 90d / 365d, first / last populated, months since, adoption onset / lag | derived from those monthly counts, exactly as the workbook defines them (whole months; the current partial month is left out of the windows and the first/last/onset months) |
| Distinct values | `COUNT_DISTINCT` where Salesforce allows it; for numbers, currency and date/times `MIN = MAX` proves a single value, and 5+ distinct in the newest 2,000 records settles full information credit; otherwise unknown, and the Information component is left out (renormalised) rather than scored 0 |
| Layouts | read from every page layout's metadata (standard fields included); address sub-fields take their parent Address field's count |
| Flows / formula refs / other | `MetadataComponentDependency` by CustomField Id, each referencing component counted once (a flow's versions are one flow). Other includes Apex, validation rules, field updates, email templates **and reports** — reports weren't visible to the workbook build |

**Validated** against `Account Field Health Analysis XBU.xlsx` (as of 2026-10-01) on a
2026-10-27 scan: of 521 fields compared, classification matched 514, action 520, band
496, median score difference 0. The differences are the 26 days of new data, per-user
fields such as LastViewedDate, distinct counts the API can't produce, and the live
reference crawl.

**Not assessable:** long text / rich text areas and a few system fields that can't be
counted or filtered over the API (the workbooks measured these from the export), compound
Address/Geolocation parents and record Ids.

**Field health findings** come from the Action column for the org's own custom fields:
Retire candidate (incl. required ones), Recently stopped, Rarely used, Verify formula usage,
plus the Data Quality flags (required but never populated; adopted over a year late). They
replace the earlier ad-hoc usage checks (never filled / under 1% / not populated in a year).

**Last populated.** Salesforce keeps no "last set" date per field, so for each custom field
the org built that has data, the scan also records the `CreatedDate` of the newest record
holding a value, and — if Field History Tracking is on for the field — the newest tracked
change. A value added later to an older record is only caught by the second.

**Run time:** the monthly-grouped queries are the slow part on very large objects (SBU Case,
~674k records, ~90 s per 50-field query). A full scan of both orgs takes about 30–40 minutes.

## Files

| File | |
|---|---|
| `redact.js` | blanks credentials found in formulas, descriptions and help text |
| `fieldscore.js` | the Field Health scoring model (workbook formulas + Scoring Model inputs) |
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
Credential Manager login must both be valid. A full run takes about 30–40 minutes.

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
