import assert from "node:assert/strict";
import test from "node:test";
import { captureRemoteUrl } from "../src/reference-capture.js";
import { buildLiveReferenceReceipt } from "../src/live-reference.js";
import { validateAgainstSchema } from "../src/validate.js";

test("remote capture records the DNS resolution used for transport policy", async () => {
  const result = await captureRemoteUrl("https://reference.example/page", {
    now: () => new Date("2026-08-18T12:34:56.000Z"),
    resolveHost: async () => ["93.184.216.34"],
    fetchImpl: async () => new Response("<main><h1>Observed</h1></main>", {
      status: 200,
      headers: { "content-type": "text/html" }
    })
  });

  assert.equal(result.state, "PASS");
  assert.deepEqual(result.provenance.dnsResolutions, [
    {
      attempt: 1,
      hostname: "reference.example",
      addresses: ["93.184.216.34"],
      observedAt: "2026-08-18T12:34:56.000Z"
    }
  ]);
});

test("remote capture records redirect, byte, timestamp, and content identity evidence", async () => {
  const html = "<main><h1>Observed</h1></main>";
  let calls = 0;
  const result = await captureRemoteUrl("https://reference.example/start", {
    now: () => new Date("2026-08-18T12:34:56.000Z"),
    resolveHost: async () => ["93.184.216.34"],
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://reference.example/final" }
        });
      }
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html" }
      });
    }
  });

  assert.equal(result.state, "PASS");
  assert.equal(result.provenance.requestedUrl, "https://reference.example/start");
  assert.equal(result.provenance.finalUrl, "https://reference.example/final");
  assert.deepEqual(result.provenance.redirectChain, [
    {
      attempt: 1,
      fromUrl: "https://reference.example/start",
      status: 302,
      toUrl: "https://reference.example/final"
    }
  ]);
  assert.equal(result.provenance.responseBytes, 30);
  assert.equal(result.provenance.responseSha256, "6a47d76d791ab30944d3c6c8248eb150f55b3bc1529be36ed242f2032b747e8c");
  assert.equal(result.provenance.artifactIdentity, "sha256:6a47d76d791ab30944d3c6c8248eb150f55b3bc1529be36ed242f2032b747e8c");
  assert.equal(result.provenance.capturedAt, "2026-08-18T12:34:56.000Z");
});

test("remote capture retries bounded availability failures without fabricating semantic FAIL", async () => {
  let calls = 0;
  const backoffs: number[] = [];
  const result = await captureRemoteUrl("https://reference.example/page", {
    maxAttempts: 3,
    retryBackoffMs: 10,
    sleep: async (milliseconds) => {
      backoffs.push(milliseconds);
    },
    resolveHost: async () => ["93.184.216.34"],
    fetchImpl: async () => {
      calls += 1;
      throw new TypeError("simulated network outage");
    }
  });

  assert.equal(calls, 3);
  assert.deepEqual(backoffs, [10, 20]);
  assert.equal(result.state, "NOT_EXERCISED");
  assert.equal(result.availability, "UNAVAILABLE");
  assert.equal(result.failureKind, "AVAILABILITY");
  assert.equal(result.provenance.attemptCount, 3);
});

test("remote capture bounds every transport attempt with a timeout", async () => {
  let calls = 0;
  const result = await captureRemoteUrl("https://reference.example/page", {
    timeoutMs: 5,
    maxAttempts: 2,
    retryBackoffMs: 0,
    sleep: async () => undefined,
    resolveHost: async () => ["93.184.216.34"],
    fetchImpl: async (_input, init) => {
      calls += 1;
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    }
  });

  assert.equal(calls, 2);
  assert.equal(result.state, "NOT_EXERCISED");
  assert.equal(result.availability, "UNAVAILABLE");
  assert.match(result.reason ?? "", /timed out after 5ms/);
});

test("live reference receipt binds two HTTPS targets to durable capture evidence", async () => {
  const bodies = new Map([
    ["https://one.example/", "<main><h1>One</h1></main>"],
    ["https://two.example/", "<main><h1>Two</h1></main>"]
  ]);
  const receipt = await buildLiveReferenceReceipt(
    ["https://one.example/", "https://two.example/"],
    {
      now: () => new Date("2026-08-18T12:34:56.000Z"),
      resolveHost: async (hostname) => hostname === "one.example" ? ["93.184.216.34"] : ["2606:4700:4700::1111"],
      fetchImpl: async (input) => new Response(bodies.get(input.toString()), {
        status: 200,
        headers: { "content-type": "text/html" }
      })
    }
  );

  assert.equal(receipt.schema, "website-design-compiler/live-reference-receipt/v1");
  assert.equal(receipt.mode, "LIVE_THIRD_PARTY_OPT_IN");
  assert.equal(receipt.overall, "PASS");
  assert.equal(receipt.targets.length, 2);
  assert.deepEqual(receipt.targets[0], {
    targetUrl: "https://one.example/",
    finalUrl: "https://one.example/",
    state: "PASS",
    availability: "AVAILABLE",
    httpStatus: 200,
    contentType: "text/html",
    responseBytes: 25,
    responseSha256: "d89b770d16ec62e2248e49b9feb76b343bc14aba8d3594bcba637e0313854bcd",
    artifactIdentity: "sha256:d89b770d16ec62e2248e49b9feb76b343bc14aba8d3594bcba637e0313854bcd",
    capturedAt: "2026-08-18T12:34:56.000Z",
    dnsResolutions: [{
      attempt: 1,
      hostname: "one.example",
      addresses: ["93.184.216.34"],
      observedAt: "2026-08-18T12:34:56.000Z"
    }],
    redirectChain: [],
    attemptCount: 1,
    observations: ["h1 headings: One", "main elements: 1"],
    implementationDetails: "UNKNOWN"
  });
  await validateAgainstSchema(receipt, "live-reference-receipt.schema.json");
});

test("unconfigured live lane stays NOT_EXERCISED in a schema-valid receipt", async () => {
  const receipt = await buildLiveReferenceReceipt([], {
    now: () => new Date("2026-08-18T12:34:56.000Z")
  });

  assert.equal(receipt.overall, "NOT_EXERCISED");
  assert.match(receipt.reason ?? "", /two distinct public HTTPS targets/);
  await validateAgainstSchema(receipt, "live-reference-receipt.schema.json");
});

test("live receipt rejects credential-shaped URLs without echoing private input", async () => {
  const receipt = await buildLiveReferenceReceipt([
    "https://one.example/?token=do-not-publish",
    "https://two.example/"
  ], {
    now: () => new Date("2026-08-18T12:34:56.000Z")
  });

  assert.equal(receipt.overall, "FAIL");
  assert.deepEqual(receipt.targets, []);
  assert.doesNotMatch(JSON.stringify(receipt), /do-not-publish|token=/);
});

test("redirect revalidation blocks same-host DNS rebinding before a second transport call", async () => {
  let resolutions = 0;
  let transports = 0;
  const result = await captureRemoteUrl("https://reference.example/start", {
    now: () => new Date("2026-08-18T12:34:56.000Z"),
    maxAttempts: 1,
    resolveHost: async () => {
      resolutions += 1;
      return resolutions === 1 ? ["93.184.216.34"] : ["127.0.0.1"];
    },
    transport: async () => {
      transports += 1;
      return {
        status: 302,
        headers: new Headers({ location: "https://reference.example/admin" }),
        body: new Uint8Array(),
        mode: "INJECTED_TEST"
      };
    }
  });

  assert.equal(result.state, "FAIL");
  assert.equal(result.failureKind, "POLICY");
  assert.equal(transports, 1);
  assert.equal(result.provenance.finalUrl, "https://reference.example/start");
  assert.deepEqual(result.provenance.redirectChain, []);
  assert.doesNotMatch(JSON.stringify(result.provenance), /\/admin|127\.0\.0\.1/);
});

test("live target outage keeps the receipt explicitly NOT_EXERCISED", async () => {
  const receipt = await buildLiveReferenceReceipt([
    "https://one.example/",
    "https://two.example/"
  ], {
    now: () => new Date("2026-08-18T12:34:56.000Z"),
    capture: async (_target, dependencies) => ({
      state: "NOT_EXERCISED",
      availability: "UNAVAILABLE",
      failureKind: "AVAILABILITY",
      facts: [],
      provenance: {
        adapter: "remote-url-observer/v1",
        sourceKind: "url",
        sourceMode: "REMOTE",
        attemptCount: dependencies.maxAttempts ?? 3
      },
      reason: "raw transport detail must not enter the public receipt"
    })
  });

  assert.equal(receipt.overall, "NOT_EXERCISED");
  assert.ok(receipt.targets.every((target) => target.availability === "UNAVAILABLE"));
  assert.doesNotMatch(JSON.stringify(receipt), /raw transport detail/);
  await validateAgainstSchema(receipt, "live-reference-receipt.schema.json");
});

test("changed remote bytes create a new artifact identity", async () => {
  const capture = async (html: string) => captureRemoteUrl("https://reference.example/", {
    now: () => new Date("2026-08-18T12:34:56.000Z"),
    maxAttempts: 1,
    resolveHost: async () => ["93.184.216.34"],
    fetchImpl: async () => new Response(html, {
      status: 200,
      headers: { "content-type": "text/html" }
    })
  });

  const before = await capture("<main><h1>Before</h1></main>");
  const after = await capture("<main><h1>After</h1></main>");
  assert.equal(before.state, "PASS");
  assert.equal(after.state, "PASS");
  assert.notEqual(before.provenance.responseSha256, after.provenance.responseSha256);
  assert.notEqual(before.provenance.artifactIdentity, after.provenance.artifactIdentity);
});

test("literal IPv4 and IPv6 private targets never reach transport", async () => {
  let transports = 0;
  for (const target of [
    "https://127.0.0.1/",
    "https://[::1]/",
    "https://[fe80::1]/",
    "https://[::ffff:c0a8:101]/",
    "https://[::c0a8:101]/"
  ]) {
    const result = await captureRemoteUrl(target, {
      maxAttempts: 1,
      resolveHost: async () => ["93.184.216.34"],
      transport: async () => {
        transports += 1;
        return {
          status: 200,
          headers: new Headers({ "content-type": "text/html" }),
          body: new TextEncoder().encode("<main></main>"),
          mode: "INJECTED_TEST"
        };
      }
    });
    assert.equal(result.state, "FAIL", target);
    assert.equal(result.failureKind, "POLICY", target);
  }
  assert.equal(transports, 0);
});

test("DNS resolution is included in the bounded timeout and retry policy", async () => {
  let resolutions = 0;
  const result = await captureRemoteUrl("https://reference.example/", {
    timeoutMs: 5,
    maxAttempts: 2,
    retryBackoffMs: 0,
    sleep: async () => undefined,
    resolveHost: async () => {
      resolutions += 1;
      return await new Promise<string[]>(() => undefined);
    },
    transport: async () => {
      throw new Error("transport must not be reached");
    }
  });

  assert.equal(resolutions, 2);
  assert.equal(result.state, "NOT_EXERCISED");
  assert.equal(result.availability, "UNAVAILABLE");
  assert.match(result.reason ?? "", /DNS resolution timed out after 5ms/);
});

test("receipt does not restore a URL that DNS policy classified as private", async () => {
  const receipt = await buildLiveReferenceReceipt([
    "https://private-looking.example/",
    "https://public.example/"
  ], {
    now: () => new Date("2026-08-18T12:34:56.000Z"),
    maxAttempts: 1,
    resolveHost: async (hostname) => hostname === "private-looking.example" ? ["10.0.0.8"] : ["93.184.216.34"],
    transport: async () => ({
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      body: new TextEncoder().encode("<main><h1>Public</h1></main>"),
      mode: "INJECTED_TEST"
    })
  });

  const rejected = receipt.targets.find((target) => target.failureKind === "POLICY");
  assert.equal(receipt.overall, "FAIL");
  assert.ok(rejected);
  assert.equal("targetUrl" in rejected, false);
  assert.doesNotMatch(JSON.stringify(receipt), /private-looking/);
  await validateAgainstSchema(receipt, "live-reference-receipt.schema.json");
});

test("reference manifest schema accepts the expanded production capture provenance", async () => {
  const capture = await captureRemoteUrl("https://reference.example/", {
    now: () => new Date("2026-08-18T12:34:56.000Z"),
    maxAttempts: 1,
    resolveHost: async () => ["93.184.216.34"],
    fetchImpl: async () => new Response("<main><h1>Observed</h1></main>", {
      status: 200,
      headers: { "content-type": "text/html" }
    })
  });

  await validateAgainstSchema({
    schema: "website-design-compiler/reference-manifest/v1",
    project: "live-reference-fixture",
    entries: [{
      id: "ref-001",
      kind: "url",
      source: "https://reference.example/",
      captureState: capture.state,
      observableFacts: capture.facts,
      unknownImplementationDetails: true,
      provenance: capture.provenance
    }]
  }, "reference-manifest.schema.json");
});

test("adapter enforces the byte bound even for an injected transport", async () => {
  const result = await captureRemoteUrl("https://reference.example/", {
    maxAttempts: 1,
    maxBytes: 4,
    resolveHost: async () => ["93.184.216.34"],
    transport: async () => ({
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      body: new Uint8Array(5),
      mode: "INJECTED_TEST"
    })
  });

  assert.equal(result.state, "FAIL");
  assert.equal(result.availability, "AVAILABLE");
  assert.equal(result.failureKind, "COMPILER");
  assert.match(result.reason ?? "", /exceeds 4 byte limit/);
});
