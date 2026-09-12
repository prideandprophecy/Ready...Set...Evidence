export const STUDY_DESIGN_OPTIONS = [
  ['randomized_controlled_trial', 'Randomized controlled trial'],
  ['prospective_controlled', 'Prospective controlled study'],
  ['prospective_uncontrolled', 'Prospective uncontrolled study'],
  ['retrospective_controlled', 'Retrospective controlled study'],
  ['retrospective_uncontrolled', 'Retrospective uncontrolled study'],
  ['case_control', 'Case-control study'],
  ['cross_sectional', 'Cross-sectional study'],
  ['case_series_or_report', 'Case series / case report'],
  ['systematic_review_meta_analysis', 'Systematic review / meta-analysis'],
  ['other', 'Other'],
  ['unclear', 'Unclear / not reported'],
];

export const WORK_TYPE_OPTIONS = [
  ['journal_article', 'Journal article'],
  ['conference_abstract', 'Conference abstract'],
  ['systematic_review', 'Systematic review'],
  ['registry', 'Registry / public dataset'],
  ['internal_evidence', 'Internal / organization evidence'],
  ['other', 'Other'],
];

export function studyDesignLabel(value) {
  return STUDY_DESIGN_OPTIONS.find(([v]) => v === value)?.[1] || value?.replaceAll('_', ' ') || 'Not classified';
}

export function workTypeLabel(value) {
  return WORK_TYPE_OPTIONS.find(([v]) => v === value)?.[1] || value?.replaceAll('_', ' ') || 'Other';
}
