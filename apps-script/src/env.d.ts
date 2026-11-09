/* eslint-disable no-var */
// shared/ids.ts references globalThis.crypto. Apps Script has no such global, so the helper must
// never call shortId() (use Utilities.getUuid()); this declaration only satisfies the type checker.
declare var crypto: { getRandomValues<T extends ArrayBufferView>(array: T): T };
