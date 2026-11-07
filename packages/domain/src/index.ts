/**
 * @leaseguard/domain — framework-independent LeaseGuard domain model and business rules.
 *
 * The backend executes these rules authoritatively. The frontend demo mode reuses the same
 * functions so no rule is implemented twice. Nothing in this package may import a framework,
 * perform I/O or read the clock; date-sensitive functions take `today` explicitly.
 */
export * from './types/index.js'
export * from './rules/index.js'
