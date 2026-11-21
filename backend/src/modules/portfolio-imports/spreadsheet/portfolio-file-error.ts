/** Why a portfolio file was refused. */
export type PortfolioFileErrorKind = 'unreadable' | 'empty' | 'no_rows' | 'too_large' | 'too_many_rows' | 'too_many_columns' | 'sheet_not_found'

/** A portfolio file LeaseGuard cannot accept; `message` is written for the person who uploaded it. */
export class PortfolioFileError extends Error {
  constructor(
    readonly kind: PortfolioFileErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'PortfolioFileError'
  }
}
