/**
 * Deterministic DOM ids for form fields, so `FormValidationSummary` can link `#id` to the
 * control that owns an error. Dots and brackets in RHF paths become dashes:
 * `escalation.percentage` → `field-escalation-percentage`.
 */
export function fieldIdFor(name: string): string {
  return `field-${name.replace(/[.[\]]+/g, '-').replace(/-+$/, '')}`
}
