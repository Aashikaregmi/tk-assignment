// Abstract class rather than interface so it survives compilation as a DI token.
export abstract class UnitOfWork {
  // Runs `work` in one transaction: commits if it resolves, rolls back if it throws.
  // A nested run() joins the outer transaction.
  abstract run<T>(work: () => Promise<T>): Promise<T>;
}
