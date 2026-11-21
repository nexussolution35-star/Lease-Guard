import { describe, expect, it } from 'vitest'

import { googleSheetsCsvExportUrl, googleSheetUrl, parseGoogleSheetsLink } from './googleSheetsLink.js'

const ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'

describe('parseGoogleSheetsLink', () => {
  it('reads the spreadsheet id from a link without a tab', () => {
    expect(parseGoogleSheetsLink(`https://docs.google.com/spreadsheets/d/${ID}/edit`)).toEqual({ spreadsheetId: ID })
    expect(parseGoogleSheetsLink(`  https://docs.google.com/spreadsheets/d/${ID}  `)).toEqual({ spreadsheetId: ID })
    expect(parseGoogleSheetsLink(`docs.google.com/spreadsheets/u/1/d/${ID}/edit?usp=sharing`)).toEqual({ spreadsheetId: ID })
  })

  it('reads the tab id from the fragment or the query', () => {
    expect(parseGoogleSheetsLink(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=1386834576`)).toEqual({ spreadsheetId: ID, gid: '1386834576' })
    expect(parseGoogleSheetsLink(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing&gid=0#gid=0`)).toEqual({ spreadsheetId: ID, gid: '0' })
    expect(parseGoogleSheetsLink(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=12&range=A1`)).toEqual({ spreadsheetId: ID, gid: '12' })
  })

  it('refuses anything that is not a Google Sheets link', () => {
    for (const text of [
      '',
      'https://example.com/spreadsheets/d/' + ID,
      `https://docs.google.com.evil.example/spreadsheets/d/${ID}`,
      `https://evil.example@docs.google.com/spreadsheets/d/${ID}`,
      `https://docs.google.com@evil.example/spreadsheets/d/${ID}`,
      `https://docs.google.com:8443/spreadsheets/d/${ID}`,
      `https://docs.google.com/document/d/${ID}/edit`,
      'https://docs.google.com/spreadsheets/d/e/2PACX-1vT/pub?output=csv',
      'https://docs.google.com/spreadsheets/d/short/edit',
      `ftp://docs.google.com/spreadsheets/d/${ID}`,
      `https://docs.google.com/spreadsheets/d/${ID}/edit with spaces`,
    ]) {
      expect(parseGoogleSheetsLink(text), text).toBeNull()
    }
  })
})

describe('Google Sheets addresses', () => {
  it('builds the CSV export address from the id and tab only', () => {
    expect(googleSheetsCsvExportUrl({ spreadsheetId: ID })).toBe(`https://docs.google.com/spreadsheets/d/${ID}/export?format=csv`)
    expect(googleSheetsCsvExportUrl({ spreadsheetId: ID, gid: '7' })).toBe(`https://docs.google.com/spreadsheets/d/${ID}/export?format=csv&gid=7`)
  })

  it('builds the link that opens the sheet', () => {
    expect(googleSheetUrl({ spreadsheetId: ID, gid: '7' })).toBe(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=7`)
  })
})
