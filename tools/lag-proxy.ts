#!/usr/bin/env bun
/**
 * Lag proxy — put real latency in front of the local gateway.
 *
 *   bun tools/lag-proxy.ts --delay 150            # :7781 -> :7780, 150ms each way
 *   bun quest-eval/run.ts --gateway http://127.0.0.1:7781
 *
 * Why: tick rate and latency are different axes, and the local world has none of
 * the second one. The demo server sits in `iad` and a session from here sees
 * 200-300ms round trips, which is where "worked locally, flaked in prod" comes
 * from — a click that is answered after one tick locally is answered after one
 * tick PLUS a round trip there.
 *
 * This is a transparent TCP proxy (the gateway speaks WebSocket over TCP, so
 * nothing needs to understand frames), delaying every chunk by `--delay` ms in
 * each direction. Ordering is preserved per connection because every chunk gets
 * the same delay.
 */
const argv = process.argv.slice(2);
const flags = new Map<string, string>();
for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`);
    const [key, inline] = arg.slice(2).split('=');
    if (inline !== undefined) flags.set(key!, inline);
    else if (argv[i + 1] && !argv[i + 1]!.startsWith('--')) flags.set(key!, argv[++i]!);
    else flags.set(key!, 'true');
}

const listenPort = Number(flags.get('listen') ?? 7781);
const targetHost = flags.get('target-host') ?? '127.0.0.1';
const targetPort = Number(flags.get('target-port') ?? flags.get('target') ?? 7780);
const delayMs = Math.max(0, Number(flags.get('delay') ?? 150));

if (!Number.isFinite(listenPort) || !Number.isFinite(targetPort)) {
    console.error('usage: lag-proxy.ts [--listen 7781] [--target-port 7780] [--delay 150]');
    process.exit(2);
}

let connections = 0;
let bytesUp = 0;
let bytesDown = 0;

type Upstream = { write(chunk: Uint8Array): number; end(): void };
type Conn = { upstream: Upstream | null; queue: Uint8Array[] };

await Bun.listen({
    hostname: '127.0.0.1',
    port: listenPort,
    socket: {
        async open(socket) {
            connections += 1;
            // Bun starts every socket with `data: undefined`. Assign it BEFORE
            // awaiting the upstream connection: the client's first bytes arrive
            // while the connect is still in flight, and dropping them truncates
            // the HTTP/WS handshake (symptom: bytes up, nothing back).
            const conn: Conn = { upstream: null, queue: [] };
            socket.data = conn;
            const upstream = await Bun.connect({
                hostname: targetHost,
                port: targetPort,
                socket: {
                    data(_peer, chunk) {
                        bytesDown += chunk.byteLength;
                        setTimeout(() => {
                            try {
                                socket.write(chunk);
                            } catch {
                                /* peer closed */
                            }
                        }, delayMs);
                    },
                    close() {
                        try {
                            socket.end();
                        } catch {
                            /* already gone */
                        }
                    },
                    error() {
                        try {
                            socket.end();
                        } catch {
                            /* already gone */
                        }
                    },
                },
            });
            conn.upstream = upstream as unknown as Upstream;
            // Flush whatever the client sent while we were connecting.
            for (const chunk of conn.queue.splice(0)) {
                setTimeout(() => {
                    try {
                        conn.upstream?.write(chunk);
                    } catch {
                        /* peer closed */
                    }
                }, delayMs);
            }
        },
        data(socket, chunk) {
            bytesUp += chunk.byteLength;
            const conn = socket.data as Conn | undefined;
            if (!conn) return;
            if (!conn.upstream) {
                conn.queue.push(chunk);
                return;
            }
            const upstream = conn.upstream;
            setTimeout(() => {
                try {
                    upstream.write(chunk);
                } catch {
                    /* peer closed */
                }
            }, delayMs);
        },
        close(socket) {
            (socket.data as Conn | undefined)?.upstream?.end();
        },
        error(socket) {
            (socket.data as Conn | undefined)?.upstream?.end();
        },
    },
});

console.log(`lag-proxy: 127.0.0.1:${listenPort} -> ${targetHost}:${targetPort}, ${delayMs}ms each way`);
setInterval(() => {
    if (connections) console.log(`  ${connections} conn · up ${bytesUp}B · down ${bytesDown}B`);
}, 30_000).unref?.();
