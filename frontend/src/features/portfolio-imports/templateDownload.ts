import { portfolioImportTemplateCsv, type PortfolioImportScope } from '@leaseguard/domain'

/** File name of the downloadable template for `scope`. */
export function templateFileName(scope: PortfolioImportScope): string {
  return scope === 'units' ? 'leaseguard-units-template.csv' : 'leaseguard-portfolio-template.csv'
}

/**
 * The template as a file: the domain's CSV with a UTF-8 byte-order mark, so Excel opens the m² headings correctly
 * (LeaseGuard reads the file with or without one).
 */
export function templateBlob(scope: PortfolioImportScope): Blob {
  return new Blob(['\ufeff', portfolioImportTemplateCsv(scope)], { type: 'text/csv;charset=utf-8' })
}

/** Saves the template through a temporary link, as the browser's own download. */
export function downloadTemplate(scope: PortfolioImportScope): void {
  const url = URL.createObjectURL(templateBlob(scope))
  const link = document.createElement('a')
  link.href = url
  link.download = templateFileName(scope)
  link.click()
  // Revoked once the browser has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
