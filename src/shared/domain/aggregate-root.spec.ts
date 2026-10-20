import { AggregateRoot, DomainEvent } from './aggregate-root';

interface Renamed extends DomainEvent {
  readonly type: 'Renamed';
  readonly name: string;
}

class Widget extends AggregateRoot<Renamed> {
  constructor(readonly id: string) {
    super();
  }

  rename(name: string): void {
    this.record({ type: 'Renamed', aggregateId: this.id, name });
  }
}

describe('AggregateRoot', () => {
  it('returns recorded events in order', () => {
    const widget = new Widget('w-1');
    widget.rename('a');
    widget.rename('b');

    expect(widget.pullEvents()).toEqual([
      { type: 'Renamed', aggregateId: 'w-1', name: 'a' },
      { type: 'Renamed', aggregateId: 'w-1', name: 'b' },
    ]);
  });

  it('drains events so each is pulled once', () => {
    const widget = new Widget('w-1');
    widget.rename('a');
    const first = widget.pullEvents();

    expect(widget.pullEvents()).toEqual([]);

    widget.rename('b');
    expect(first).toHaveLength(1);
    expect(widget.pullEvents()).toEqual([{ type: 'Renamed', aggregateId: 'w-1', name: 'b' }]);
  });
});
