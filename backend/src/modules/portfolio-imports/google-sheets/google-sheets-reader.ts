import { Injectable } from '@nestjs/common'
import type { GoogleSheetSource } from '@leaseguard/domain'

import { fetchGoogleSheet, type FetchedGoogleSheet } from './fetch-google-sheet'

/** Reads Google Sheets for portfolio imports; a provider so tests can replace the network. */
@Injectable()
export class GoogleSheetsReader {
  read(source: GoogleSheetSource): Promise<FetchedGoogleSheet> {
    return fetchGoogleSheet(source)
  }
}
