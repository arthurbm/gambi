import Bonjour, { type Browser, type Service } from "bonjour-service";

let instance: Bonjour | null = null;
const publishedServices: Map<string, Service> = new Map();

function getInstance(): Bonjour {
  if (!instance) {
    instance = new Bonjour();
  }
  return instance;
}

export interface PublishOptions {
  name: string;
  port: number;
  type?: string;
  txt?: Record<string, string>;
}

/**
 * Publish a service via mDNS (Bonjour/Zeroconf)
 *
 * @example
 * ```typescript
 * import { mDNS } from "@gambi/core/mdns";
 *
 * // Publish a Gambi hub
 * mDNS.publish({
 *   name: "gambi-ABC123",
 *   port: 3000,
 *   txt: { roomCode: "ABC123" },
 * });
 *
 * // Unpublish when done
 * mDNS.unpublish("gambi-ABC123");
 * ```
 */
export function publish(options: PublishOptions): Service {
  const bonjour = getInstance();

  const service = bonjour.publish({
    name: options.name,
    type: options.type ?? "gambi",
    port: options.port,
    txt: options.txt,
  });

  publishedServices.set(options.name, service);

  return service;
}

/**
 * Unpublish a service by name
 */
export function unpublish(name: string): boolean {
  const service = publishedServices.get(name);
  if (service) {
    if (service.stop) {
      service.stop();
    }
    publishedServices.delete(name);
    return true;
  }
  return false;
}

/**
 * Unpublish all services and destroy the instance
 */
export function destroy(): void {
  for (const service of publishedServices.values()) {
    if (service.stop) {
      service.stop();
    }
  }
  publishedServices.clear();

  if (instance) {
    instance.destroy();
    instance = null;
  }
}

export interface DiscoveredService {
  name: string;
  port: number;
  txt: Record<string, string>;
}

/**
 * Browse for Gambi services on the network
 */
export function browse(
  callback: (service: DiscoveredService) => void
): () => void {
  const bonjour = getInstance();

  const browser: Browser = bonjour.find({ type: "gambi" }, (service) => {
    callback({
      name: service.name,
      port: service.port,
      txt: (service.txt ?? {}) as Record<string, string>,
    });
  });

  return () => browser.stop();
}

export const mDNS = {
  publish,
  unpublish,
  destroy,
  browse,
} as const;
