import { EventEmitter } from "node:events";

export interface ReportStoredEvent {
  reportId: number;
  domainId: number;
  domain: string;
  ips: string[];
}

interface AppEvents {
  "report:stored": [ReportStoredEvent];
  "forensic:stored": [{ id: number; domainId: number | null }];
}

class TypedEmitter extends EventEmitter {
  override emit<K extends keyof AppEvents>(event: K, ...args: AppEvents[K]): boolean {
    return super.emit(event, ...args);
  }
  override on<K extends keyof AppEvents>(event: K, listener: (...args: AppEvents[K]) => void): this {
    return super.on(event, listener as (...a: unknown[]) => void);
  }
}

export const events = new TypedEmitter();
