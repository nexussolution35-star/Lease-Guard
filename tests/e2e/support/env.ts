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
/** The document-processing service (python-services/document-processing) the e2e statement worker calls. */
export const E2E_DOCUMENT_PROCESSING_PORT = 3957
export const E2E_DOCUMENT_PROCESSING_URL = `http://127.0.0.1:${E2E_DOCUMENT_PROCESSING_PORT}`
/** How run-api.ts hands the statement worker (statement-worker.ts) its build directory and settings. */
export const STATEMENT_WORKER_ENV_VARIABLE = 'LEASEGUARD_E2E_WORKER_ENV'
