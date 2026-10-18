import { EventEmitter } from 'node:events';

/**
 * In-process event bus. Services emit "update" pokes; the SSE route fans them
 * out to connected clients, which then refetch the matching endpoint.
 */
export const bus = new EventEmitter();
bus.setMaxListeners(100);

export function broadcast(type, detail = {}) {
  bus.emit('update', { type, ...detail, at: Date.now() });
}
