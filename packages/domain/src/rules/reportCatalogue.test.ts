import { describe, expect, it } from 'vitest'

import { REPORT_IDS } from '../types/reports.js'
import { findReportDefinition, isReportId, REPORT_CATALOGUE } from './reportCatalogue.js'

describe('REPORT_CATALOGUE', () => {
  it('lists every report exactly once, in the order of REPORT_IDS', () => {
    expect(REPORT_CATALOGUE.map((report) => report.id)).toEqual([...REPORT_IDS])
  })

  it('gives every report a title, a description and an icon', () => {
    for (const report of REPORT_CATALOGUE) {
      expect(report.title.trim()).not.toBe('')
      expect(report.description.trim()).not.toBe('')
      expect(report.icon).toMatch(/^[a-z0-9-]+$/)
    }
  })

  it('finds a report by id and refuses unknown ids', () => {
    expect(findReportDefinition('arrears')?.title).toBe('Arrears ageing')
    expect(findReportDefinition('owner_summary')).toBeUndefined()
    expect(isReportId('occupancy')).toBe(true)
    expect(isReportId('Occupancy')).toBe(false)
  })
})
