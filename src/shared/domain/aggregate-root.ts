export interface DomainEvent {
  readonly type: string;
  readonly aggregateId: string;
}

// Pull-based: the command handler drains events and writes them in the same transaction as the state.
export abstract class AggregateRoot<TEvent extends DomainEvent = DomainEvent> {
  private events: TEvent[] = [];

  protected record(event: TEvent): void {
    this.events.push(event);
  }

  pullEvents(): TEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }
}
