export interface StoredRequest {
  requestHash: string;
  responseBody: unknown;
}

// Port. Both methods run inside the request's unit of work.
export abstract class IdempotencyStore {
  // Null when this request now owns the key. Otherwise the earlier request's record; if that
  // request is still running, this waits for its transaction to end.
  abstract claim(userId: string, key: string, requestHash: string): Promise<StoredRequest | null>;
  abstract complete(userId: string, key: string, responseBody: unknown): Promise<void>;
}
