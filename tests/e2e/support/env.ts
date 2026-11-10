/**
 * Fixed settings of the E2E stack, shared by the Playwright config and the API runner. Ports are
 * unusual on purpose: a run fails fast instead of testing some other server.
 */
export const E2E_WEB_PORT = 5199
export const E2E_WEB_URL = `http://localhost:${E2E_WEB_PORT}`
export const E2E_API_PORT = 3955
export const E2E_API_URL = `http://127.0.0.1:${E2E_API_PORT}`
/** Redis for BullMQ; the documented local default. Override with E2E_REDIS_URL (must be local). */
export const E2E_REDIS_URL = process.env.E2E_REDIS_URL ?? 'redis://127.0.0.1:6379'
