/** Moved to the shared service kit (ADR 0003); re-exported so existing imports keep working. New code imports @leaseguard/service-kit. */
export {
  conflictWithDatabaseMessage,
  httpErrorFromDatabase,
  unwrapDatabase,
  type DatabaseErrorLike,
  type DatabaseErrorOverrides,
} from '@leaseguard/service-kit'
