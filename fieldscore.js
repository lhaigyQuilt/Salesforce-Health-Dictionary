// Field Health score — the scoring model of the "<Object> Field Health Analysis <BU>.xlsx"
// workbooks, formula for formula. MODEL mirrors their "Scoring Model" tab; each function
// below names the Field Health column it reproduces. Percentages are 0–100, as in the sheets.
const MODEL = {
  weights: { population: 25, recency: 25, trend: 20, info: 5, integration: 20, documentation: 5 },
  populationFullCredit: 100,   // % — population is log-scaled to this
  recencyZeroMonths: 24,       // months since last populated at which recency reaches zero
  infoFullDistinct: 5,         // distinct values for full information credit
  integrationFullRefs: 3,      // references for full integration credit
  graceDays: 90,               // younger fields: "Too New - Provisional"
  trendWindowDays: 90,         // younger fields: Trend is n/a
  minEligible: 300,            // fewer eligible records: "Insufficient Data"
  dormantMonths: 12,           // months unpopulated before "Dormant"
  bands: { Healthy: 75, Monitor: 55, Review: 35, 'Likely Debt': 15 },   // score >=; below the last is Retire
  activePct: 1,                // % since creation at or above which a field is Active
  growingMultiple: 1.5,        // last-90d rate this multiple of since-creation rate = Growing
};

// fh: measures from scan_tech.js; f: the field (custom, help, desc, created); ageDays: from created
function score(fh, f, ageDays, origin) {
  const M_ = MODEL, w = M_.weights, F = fh.formula, I = ageDays;
  const na = 'n/a';
  const AD = fh.flows + fh.formulas + fh.layouts + fh.other;                        // Total References
  const AJ = F ? na : Math.min(1, Math.log(1 + fh.Q) / Math.log(1 + M_.populationFullCredit));   // Population
  const AK = F ? na : Math.max(0, 1 - fh.V / M_.recencyZeroMonths);                 // Recency
  const AL = F || (I != null && I < M_.trendWindowDays) ? na : (fh.Q === 0 ? 0 : Math.min(1, fh.R / fh.Q));   // Trend
  // Information: the workbooks count distinct values from a full export; Salesforce can't
  // COUNT_DISTINCT some types (text areas), and an unknown count is left out, not scored 0
  const AM = fh.Y == null ? na : Math.min(1, Math.max(0, (fh.Y - 1) / (M_.infoFullDistinct - 1)));
  const AN = Math.min(1, AD / M_.integrationFullRefs);                               // Integration
  const AO = (f.help ? 0.5 : 0) + (f.desc ? 0.5 : 0);                               // Documentation
  const parts = [[AJ, w.population], [AK, w.recency], [AL, w.trend], [AM, w.info], [AN, w.integration], [AO, w.documentation]];
  const num = parts.reduce((a, [v, wt]) => a + (v === na ? 0 : v * wt), 0);
  const den = parts.reduce((a, [v, wt]) => a + (v === na ? 0 : wt), 0);
  const AP = Math.round(num / den * 100 * 10) / 10;                                 // HEALTH SCORE

  const tooNew = I != null && I < M_.graceDays;
  let AQ;                                                                            // Band
  if (tooNew) AQ = 'Too New - Provisional';
  else if (fh.O < M_.minEligible) AQ = 'Insufficient Data';
  else AQ = Object.entries(M_.bands).find(([, min]) => AP >= min)?.[0] || 'Retire';

  let AR;                                                                            // Classification
  if (tooNew) AR = 'Too New';
  else if (F) AR = AD === 0 ? 'Unreferenced Formula' : fh.Y === 1 ? 'Constant Formula' : 'Active Formula';
  else if (fh.M === 0) AR = (origin === 'Custom' ? 'Never Adopted' : 'Never Populated') + (fh.checkbox ? ' (checkbox always FALSE)' : '');
  else if (!fh.checkbox && fh.Y === 1) AR = 'Single Value Only';
  else if (fh.V >= M_.dormantMonths) AR = 'Dormant';
  else if (fh.R === 0) AR = 'Recently Stopped';
  else if (fh.Q > 0 && fh.R >= fh.Q * M_.growingMultiple) AR = 'Growing';
  else AR = fh.Q >= M_.activePct ? 'Active' : 'Rarely Used';

  let AS;                                                                            // Action
  if (origin === 'Standard') AS = 'Standard field — not removable';
  else if (origin === 'Managed Package') AS = 'Managed package — not removable';
  else if (AR === 'Too New') AS = 'Re-assess after grace period';
  else if (['Active', 'Growing', 'Active Formula'].includes(AR)) AS = 'Keep';
  else if (AR === 'Rarely Used') AS = 'Review — consolidate or retire';
  else if (AR === 'Recently Stopped') AS = 'Investigate — did a process break?';
  else if (AR === 'Unreferenced Formula' || AR === 'Constant Formula') AS = 'Verify formula usage';
  else if (fh.required) AS = 'Required field — resolve requirement first';
  else AS = 'Retire candidate';

  const r = v => (v === na ? null : Math.round(v * 1000) / 1000);
  return { score: AP, band: AQ, cls: AR, action: AS, refs: AD,
    parts: { population: r(AJ), recency: r(AK), trend: r(AL), info: r(AM), integration: r(AN), documentation: r(AO) } };
}

module.exports = { MODEL, score };
