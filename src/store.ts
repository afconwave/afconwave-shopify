/**
 * Session store interface — maps AfconWave payment refs → Shopify payment session IDs.
 *
 * The default `InMemorySessionStore` is fine for local development but **must not** be
 * used in production: it is lost on restart and broken under multi-instance deployments.
 *
 * For production, inject a `RedisSessionStore` (see below) or implement `SessionStore`
 * against your own database.
 */

export interface SessionStore {
    set(afconwaveRef: string, shopifyPaymentId: string, ttlSeconds?: number): Promise<void>;
    get(afconwaveRef: string): Promise<string | null>;
    delete(afconwaveRef: string): Promise<void>;
}

/** Dev-only in-memory store. NEVER use in production. */
export class InMemorySessionStore implements SessionStore {
    private map = new Map<string, { value: string; expiresAt: number }>();

    async set(ref: string, id: string, ttlSeconds = 86_400): Promise<void> {
        this.map.set(ref, { value: id, expiresAt: Date.now() + ttlSeconds * 1000 });
    }

    async get(ref: string): Promise<string | null> {
        const entry = this.map.get(ref);
        if (!entry) return null;
        if (entry.expiresAt < Date.now()) {
            this.map.delete(ref);
            return null;
        }
        return entry.value;
    }

    async delete(ref: string): Promise<void> {
        this.map.delete(ref);
    }
}

/**
 * Redis-backed store. `ioredis` is an optional peer dependency — install it yourself
 * (`npm i ioredis`) and pass a connected client.
 *
 *   import Redis from 'ioredis';
 *   import { RedisSessionStore } from './store';
 *   const store = new RedisSessionStore(new Redis(process.env.REDIS_URL!));
 */
export class RedisSessionStore implements SessionStore {
    constructor(private redis: { set: Function; get: Function; del: Function }, private prefix = 'afconwave:shopify:') {}

    async set(ref: string, id: string, ttlSeconds = 86_400): Promise<void> {
        await this.redis.set(this.prefix + ref, id, 'EX', ttlSeconds);
    }

    async get(ref: string): Promise<string | null> {
        const v = await this.redis.get(this.prefix + ref);
        return v ?? null;
    }

    async delete(ref: string): Promise<void> {
        await this.redis.del(this.prefix + ref);
    }
}

/**
 * Resolve the active session store from env. Override by importing a custom store
 * directly in `routes/payment.ts`.
 */
let activeStore: SessionStore = new InMemorySessionStore();

export function setSessionStore(store: SessionStore): void {
    activeStore = store;
}

export function getSessionStore(): SessionStore {
    return activeStore;
}
