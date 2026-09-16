import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/platform/events/event-bus';

describe('event bus', () => {
  it('lets modules react to events without direct imports between feature implementations', async () => {
    const bus = new EventBus();
    const seen: string[] = [];

    bus.on('tutoring.lesson.completed', (event) => {
      seen.push(`${event.module}:${event.type}`);
    });

    await bus.publish({
      id: 'evt-1',
      workspaceId: 'ws-1',
      module: 'tutoring',
      type: 'tutoring.lesson.completed',
      occurredAt: '2026-09-16T12:00:00Z',
      payload: { occurrenceId: 'occ-1' },
    });

    expect(seen).toEqual(['tutoring:tutoring.lesson.completed']);
  });

  it('supports wildcard observers such as audit logging', async () => {
    const bus = new EventBus();
    let count = 0;
    bus.on('*', () => { count += 1; });

    await bus.publish({
      id: 'evt-2',
      workspaceId: 'ws-1',
      module: 'finance',
      type: 'finance.receipt.recorded',
      occurredAt: '2026-09-16T12:00:00Z',
      payload: {},
    });

    expect(count).toBe(1);
  });
});
