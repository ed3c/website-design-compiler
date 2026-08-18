import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  productionPinnedTransport,
  requirePinnedConnectedAddress
} from "../src/pinned-http-transport.js";

test("pinned peer admission fails closed when the response no longer exposes its socket identity", () => {
  assert.throws(
    () => requirePinnedConnectedAddress(undefined, "203.0.113.7"),
    /connected peer address is unavailable/
  );
});

test("production pinned transport preserves the connected peer identity after a closing response", async () => {
  const server = createServer((_request, response) => {
    response.setHeader("connection", "close");
    response.setHeader("content-type", "text/html");
    response.end("<!doctype html><title>Closing response</title>");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, "object");
    if (address === null || typeof address === "string") throw new Error("expected an ephemeral TCP address");

    const result = await productionPinnedTransport({
      url: new URL(`http://localhost:${address.port}/`),
      resolvedAddress: "127.0.0.1",
      deadlineAt: Date.now() + 5_000,
      maxBytes: 1_024
    });

    assert.equal(result.connectedAddress, "127.0.0.1");
    assert.equal(result.status, 200);
    assert.equal(new TextDecoder().decode(result.body), "<!doctype html><title>Closing response</title>");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
