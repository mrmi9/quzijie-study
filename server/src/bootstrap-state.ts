let databaseBootstrapPending = false;

export function markDatabaseBootstrapPending(): void {
  databaseBootstrapPending = true;
}

export function markDatabaseBootstrapReady(): void {
  databaseBootstrapPending = false;
}

export function isDatabaseBootstrapPending(): boolean {
  return databaseBootstrapPending;
}
