export type DomainEvent<TPayload = unknown> = {
  id: string;
  workspaceId: string;
  type: string;
  module: string;
  occurredAt: string;
  payload: TPayload;
};

export type EventHandler<TPayload = unknown> = (
  event: DomainEvent<TPayload>,
) => void | Promise<void>;

export class EventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>();

  on<TPayload>(type: string, handler: EventHandler<TPayload>): () => void {
    const set = this.handlers.get(type) ?? new Set<EventHandler>();
    set.add(handler as EventHandler);
    this.handlers.set(type, set);

    return () => {
      set.delete(handler as EventHandler);
      if (set.size === 0) this.handlers.delete(type);
    };
  }

  async publish<TPayload>(event: DomainEvent<TPayload>): Promise<void> {
    const handlers = [
      ...(this.handlers.get(event.type) ?? []),
      ...(this.handlers.get('*') ?? []),
    ];

    for (const handler of handlers) {
      await handler(event);
    }
  }
}
