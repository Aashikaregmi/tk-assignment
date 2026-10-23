import type { ApplicationEvent } from '../domain/events';

// Port. Called inside the command's unit of work, so whatever it writes commits with the change.
// Named apart from @nestjs/cqrs's EventPublisher, which is unrelated.
export abstract class DomainEventPublisher {
  // actorId is null when the system acts (the risk worker).
  abstract publish(actorId: string | null, events: readonly ApplicationEvent[]): Promise<void>;
}
