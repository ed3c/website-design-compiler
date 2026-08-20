import assert from "node:assert/strict";
import test from "node:test";
import { captureRemoteUrl } from "../src/reference-capture.js";
import {
  assertPublicLiveReceipt,
  verifyLiveReferences,
  type LiveReferenceAdmit,
  type LiveReferenceReceipt
} from "../src/live-reference.js";
import { validateAgainstSchema } from "../src/validate.js";

const now = () => new Date("2026-08-18T12:34:56.000Z");
const admit: LiveReferenceAdmit = {
  schema: "website-design-compiler/live-reference-admit/v1",
  approvalId: "human-admit-2026-08",
  approvedAt: "2026-08-18T00:00:00.000Z",
  targets: ["https://one.example/reference", "https://two.example/reference"]
};
const html = new TextEncoder().encode("<main><h1>Observed</h1></main>");

async function validateReceipt(receipt: LiveReferenceReceipt): Promise<void> {
  await validateAgainstSchema({
    ...receipt,
    git: { sha: "a".repeat(40), ref: "refs/heads/test" }
  }, "live-reference-receipt.schema.json");
}

function injectedDependencies() {
  return {
    now,
    resolveHost: async () => ["93.184.216.34"],
    fetchImpl: async () => new Response(html, {
      status: 200,
      headers: { "content-type": "text/html" }
    })
  };
}

test("Human-admitted injected captures remain NOT_EXERCISED and schema-valid", async () => {
  const receipt = await verifyLiveReferences(admit, injectedDependencies());

  assert.equal(receipt.overall, "NOT_EXERCISED");
  assert.equal(receipt.transportMode, "INJECTED");
  assert.equal(receipt.approval.id, admit.approvalId);
  assert.equal(receipt.targets.length, 2);
  assert.ok(receipt.targets.every((target) => target.state === "PASS"));
  assert.match(receipt.promotionBlockedReason ?? "", /cannot promote/);
  assertPublicLiveReceipt(receipt);
  await validateReceipt(receipt);
});

test("schema refuses to relabel injected transport as live PASS", async () => {
  const receipt = await verifyLiveReferences(admit, injectedDependencies());

  await assert.rejects(
    () => validateReceipt({ ...receipt, overall: "PASS", promotionBlockedReason: null }),
    /must be equal to constant|must match/
  );
});

test("changed remote bytes create auditable baseline, unchanged, and changed drift", async () => {
  const baseline = await verifyLiveReferences(admit, injectedDependencies());
  const previousHashes = Object.fromEntries(
    baseline.targets.flatMap((target) => target.targetUrl && target.responseSha256
      ? [[target.targetUrl, target.responseSha256]]
      : [])
  );
  const unchanged = await verifyLiveReferences(admit, {
    ...injectedDependencies(),
    previousHashes
  });
  const changed = await verifyLiveReferences(admit, {
    ...injectedDependencies(),
    previousHashes,
    fetchImpl: async () => new Response("<main><h1>Changed</h1></main>", {
      status: 200,
      headers: { "content-type": "text/html" }
    })
  });

  assert.ok(baseline.targets.every((target) => target.drift === "BASELINE"));
  assert.ok(unchanged.targets.every((target) => target.drift === "UNCHANGED"));
  assert.ok(changed.targets.every((target) => target.drift === "CHANGED"));
});

test("availability retries are bounded and remain NOT_EXERCISED", async () => {
  let calls = 0;
  const backoffs: number[] = [];
  const receipt = await verifyLiveReferences(admit, {
    now,
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

  assert.equal(receipt.overall, "NOT_EXERCISED");
  assert.equal(calls, 6);
  assert.deepEqual(backoffs, [10, 20, 10, 20]);
  assert.ok(receipt.targets.every((target) => target.availability === "UNAVAILABLE"));
  assert.ok(receipt.targets.every((target) => target.failureKind === "AVAILABILITY"));
  await validateReceipt(receipt);
});

test("policy and compiler failures are FAIL rather than availability failures", async () => {
  const receipt = await verifyLiveReferences(admit, {
    now,
    maxAttempts: 1,
    resolveHost: async () => ["93.184.216.34"],
    fetchImpl: async () => new Response("forbidden", {
      status: 403,
      headers: { "content-type": "text/plain" }
    })
  });

  assert.equal(receipt.overall, "FAIL");
  assert.equal(receipt.targets[0]?.state, "FAIL");
  assert.equal(receipt.targets[0]?.availability, "AVAILABLE");
  assert.equal(receipt.targets[0]?.failureKind, "COMPILER");
  await validateReceipt(receipt);
});

test("connected peer mismatch fails closed without publishing the private address", async () => {
  const receipt = await verifyLiveReferences(admit, {
    now,
    maxAttempts: 1,
    resolveHost: async () => ["93.184.216.34"],
    transport: async () => ({
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      body: html,
      connectedAddress: "127.0.0.1",
      mode: "PINNED_NETWORK"
    })
  });

  assert.equal(receipt.overall, "FAIL");
  assert.equal(receipt.targets[0]?.failureKind, "POLICY");
  assert.doesNotMatch(JSON.stringify(receipt), /127\.0\.0\.1/);
  await validateReceipt(receipt);
});

test("public receipt guard rejects private address families without false-positive public IPv4", async () => {
  const receipt = await verifyLiveReferences(admit, injectedDependencies());
  const withObservation = (value: string): LiveReferenceReceipt => ({
    ...receipt,
    targets: receipt.targets.map((target, index) => index === 0
      ? { ...target, observations: [value] }
      : target)
  });

  assert.doesNotThrow(() => assertPublicLiveReceipt(withObservation("peer 210.0.0.1")));
  for (const privateAddress of ["10.0.0.1", "172.31.255.1", "192.168.0.1", "fe80::1", "fd12::1"]) {
    assert.throws(
      () => assertPublicLiveReceipt(withObservation(`peer ${privateAddress}`)),
      /private-network/
    );
  }
});

test("redirect revalidation blocks same-host DNS rebinding before a second transport call", async () => {
  let resolutions = 0;
  let transports = 0;
  const result = await captureRemoteUrl("https://reference.example/start", {
    now,
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
  assert.doesNotMatch(JSON.stringify(result.provenance), /\/admin|127\.0\.0\.1/);
});

test("credential or query-bearing Human-admit packets fail before transport without echo", async () => {
  let transports = 0;
  const unsafe = {
    ...admit,
    targets: [
      "https://one.example/?token=do-not-publish",
      "https://two.example/reference"
    ]
  };

  await assert.rejects(
    () => verifyLiveReferences(unsafe, {
      resolveHost: async () => ["93.184.216.34"],
      transport: async () => {
        transports += 1;
        throw new Error("transport must not run");
      }
    }),
    (error: unknown) => {
      assert.doesNotMatch(String(error), /do-not-publish|token=/);
      return true;
    }
  );
  assert.equal(transports, 0);
});

test("literal IPv4, IPv6, mapped, and embedded private targets never reach transport", async () => {
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
          body: html,
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

  assert.equal(resolutions, 1);
  assert.equal(result.state, "NOT_EXERCISED");
  assert.equal(result.availability, "UNAVAILABLE");
  assert.match(result.reason ?? "", /DNS resolution timed out after \d+ms/);
});

test("receipt never restores a URL that DNS policy classified as private", async () => {
  const privateAdmit: LiveReferenceAdmit = {
    ...admit,
    targets: ["https://private-looking.example/", "https://public.example/"]
  };
  const receipt = await verifyLiveReferences(privateAdmit, {
    now,
    maxAttempts: 1,
    resolveHost: async (hostname) => hostname === "private-looking.example"
      ? ["10.0.0.8"]
      : ["93.184.216.34"],
    transport: async () => ({
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      body: html,
      mode: "INJECTED_TEST"
    })
  });

  assert.equal(receipt.overall, "FAIL");
  assert.equal("targetUrl" in (receipt.targets[0] ?? {}), false);
  assert.doesNotMatch(JSON.stringify(receipt), /private-looking|10\.0\.0\.8/);
  await validateReceipt(receipt);
});

test("artifact identity and expanded provenance validate in the reference manifest", async () => {
  const capture = await captureRemoteUrl("https://reference.example/", injectedDependencies());

  assert.equal(capture.state, "PASS");
  assert.match(capture.provenance.responseSha256 ?? "", /^[a-f0-9]{64}$/);
  assert.equal(capture.provenance.artifactIdentity, "sha256:" + capture.provenance.responseSha256);
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

test("adapter enforces the byte bound for injected transports", async () => {
  const result = await captureRemoteUrl("https://reference.example/", {
    maxAttempts: 1,
    maxBytes: 4,
    resolveHost: async () => ["93.184.216.34"],
    transport: async () => ({
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      body: new Uint8Array([1, 2, 3, 4, 5]),
      mode: "INJECTED_TEST"
    })
  });

  assert.equal(result.state, "FAIL");
  assert.equal(result.failureKind, "COMPILER");
});

test("raw transport errors and machine-private paths do not enter public receipts", async () => {
  const receipt = await verifyLiveReferences(admit, {
    capture: async () => ({
      state: "NOT_EXERCISED",
      availability: "UNAVAILABLE",
      failureKind: "AVAILABILITY",
      facts: [],
      provenance: {
        adapter: "remote-url-observer/v1",
        sourceKind: "url",
        sourceMode: "REMOTE",
        attemptCount: 3
      },
      reason: "token=secret /Users/private/file"
    })
  });

  assert.equal(receipt.overall, "NOT_EXERCISED");
  assert.doesNotMatch(JSON.stringify(receipt), /secret|\/Users\/private/);
  assertPublicLiveReceipt(receipt);
  await validateReceipt(receipt);
});
