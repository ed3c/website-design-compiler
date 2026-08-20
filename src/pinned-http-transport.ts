import { request as requestHttp, type IncomingHttpHeaders, type RequestOptions } from "node:http";
import { request as requestHttps } from "node:https";
import { isIP } from "node:net";

export type PinnedTransportMode = "PRODUCTION" | "INJECTED";

export interface PinnedTransportRequest {
  url: URL;
  resolvedAddress: string;
  deadlineAt: number;
  maxBytes: number;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: Uint8Array;
  signal?: AbortSignal;
}

export interface PinnedTransportResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
  connectedAddress: string;
  mode: PinnedTransportMode;
}

export type PinnedTransport = (request: PinnedTransportRequest) => Promise<PinnedTransportResponse>;

function remainingMilliseconds(deadlineAt: number): number {
  return Math.max(0, Math.ceil(deadlineAt - Date.now()));
}

function headersFromNode(headers: IncomingHttpHeaders): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, Array.isArray(value) ? value.join(", ") : value]]
    )
  );
}

export function sameNetworkAddress(left: string, right: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/^::ffff:/, "").split("%")[0] ?? "";
  return normalize(left) === normalize(right);
}

export function requirePinnedConnectedAddress(
  connectedAddress: string | null | undefined,
  resolvedAddress: string
): string {
  if (!connectedAddress) throw new Error("connected peer address is unavailable for pinned DNS verification");
  if (!sameNetworkAddress(connectedAddress, resolvedAddress)) {
    throw new Error("connected peer address does not match pinned DNS resolution");
  }
  return connectedAddress;
}

export async function productionPinnedTransport(input: PinnedTransportRequest): Promise<PinnedTransportResponse> {
  return await new Promise((resolveResponse, rejectResponse) => {
    const family = isIP(input.resolvedAddress);
    if (family !== 4 && family !== 6) {
      rejectResponse(new Error("pinned transport requires a valid resolved IP address"));
      return;
    }

    const remaining = remainingMilliseconds(input.deadlineAt);
    if (remaining === 0) {
      rejectResponse(new Error("remote reference total deadline exceeded before transport"));
      return;
    }

    const options: RequestOptions = {
      method: input.method ?? "GET",
      family,
      headers: input.headers ?? {
        accept: "text/html,application/xhtml+xml;q=0.9",
        "user-agent": "website-design-compiler-reference-capture/2"
      },
      lookup: ((_hostname: string, _options: unknown, callback: (error: NodeJS.ErrnoException | null, address: string, addressFamily: number) => void) => {
        callback(null, input.resolvedAddress, family);
      }) as RequestOptions["lookup"]
    };
    const requestFn = input.url.protocol === "https:" ? requestHttps : requestHttp;
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer);
      input.signal?.removeEventListener("abort", abortRequest);
      rejectResponse(error instanceof Error ? error : new Error("remote reference transport failed"));
    };
    const abortRequest = () => clientRequest.destroy(new Error("pinned transport request was cancelled"));
    const clientRequest = requestFn(input.url, options, (response) => {
      let connectedAddress: string;
      try {
        connectedAddress = requirePinnedConnectedAddress(response.socket?.remoteAddress, input.resolvedAddress);
      } catch (error) {
        response.resume();
        fail(error);
        return;
      }
      const chunks: Buffer[] = [];
      let byteCount = 0;
      response.on("data", (chunk: Buffer) => {
        byteCount += chunk.byteLength;
        if (byteCount > input.maxBytes) {
          response.destroy(new Error(`remote reference exceeds ${input.maxBytes} byte limit`));
          return;
        }
        chunks.push(chunk);
      });
      response.on("error", fail);
      response.on("end", () => {
        if (settled) return;
        settled = true;
        clearTimeout(totalTimer);
        input.signal?.removeEventListener("abort", abortRequest);
        resolveResponse({
          status: response.statusCode ?? 0,
          headers: headersFromNode(response.headers),
          body: new Uint8Array(Buffer.concat(chunks)),
          connectedAddress,
          mode: "PRODUCTION"
        });
      });
    });
    const totalTimer = setTimeout(() => {
      clientRequest.destroy(new Error("remote reference total deadline exceeded during transport"));
    }, remaining);
    clientRequest.on("error", fail);
    input.signal?.addEventListener("abort", abortRequest, { once: true });
    if (input.signal?.aborted) abortRequest();
    else {
      if (input.body) clientRequest.write(input.body);
      clientRequest.end();
    }
  });
}

export function injectedFetchTransport(fetchImpl: typeof globalThis.fetch): PinnedTransport {
  return async (input) => {
    const controller = new AbortController();
    const abortRequest=()=>controller.abort(new Error("pinned transport request was cancelled"));
    const remaining = remainingMilliseconds(input.deadlineAt);
    if (remaining === 0) throw new Error("remote reference total deadline exceeded before injected transport");
    const timer = setTimeout(() => controller.abort(new Error("remote reference total deadline exceeded during injected transport")), remaining);
    input.signal?.addEventListener("abort",abortRequest,{once:true});
    if(input.signal?.aborted)abortRequest();
    try {
      const response = await fetchImpl(input.url, {
        method: input.method ?? "GET",
        redirect: "manual",
        credentials: "omit",
        headers: input.headers ?? {
          accept: "text/html,application/xhtml+xml;q=0.9",
          "user-agent": "website-design-compiler-reference-capture/2"
        },
        ...(input.body ? { body: Buffer.from(input.body) } : {}),
        signal: controller.signal
      });
      const chunks: Uint8Array[] = [];
      let byteCount = 0;
      const reader = response.body?.getReader();
      if (reader) {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          byteCount += result.value.byteLength;
          if (byteCount > input.maxBytes) {
            await reader.cancel();
            throw new Error(`remote reference exceeds ${input.maxBytes} byte limit`);
          }
          chunks.push(result.value);
        }
      }
      const body = new Uint8Array(byteCount);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body,
        connectedAddress: input.resolvedAddress,
        mode: "INJECTED"
      };
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort",abortRequest);
    }
  };
}
