import test from "node:test";
import assert from "node:assert/strict";
import { buildOriginalityPlan, buildReferenceManifest } from "../src/reference-intelligence.js";
import { captureRemoteUrl, isPublicIpAddress, observeHtml } from "../src/reference-capture.js";
import { validateAgainstSchema } from "../src/validate.js";
import type { CompilerInput } from "../src/contracts.js";

const input: CompilerInput = {
  schema: "website-design-compiler/input/v1",
  project: "reference-fixture",
  brief: {
    pageType: "landing-page",
    audience: "design engineers",
    objective: "demonstrate evidence-first reference handling"
  },
  references: [
    { kind: "url", value: "https://example.com/reference" },
    {
      kind: "html",
      value: "<!doctype html><html><head><title>Evidence Site</title></head><body><nav><a href='/docs'>Docs</a></nav><main><h1>Compiler</h1><section><h2>Evidence first</h2><img src='hero.png' alt='Hero'></section></main></body></html>"
    }
  ],
  requestedStages: ["reference-intelligence", "release-receipt"]
};

test("remote reference remains unexercised by default while inline html is observed", async () => {
  const manifest = await buildReferenceManifest(input);
  assert.equal(manifest.entries.length, 2);
  assert.equal(manifest.entries[0]?.captureState, "NOT_EXERCISED");
  assert.deepEqual(manifest.entries[0]?.observableFacts, []);
  assert.equal(manifest.entries[1]?.captureState, "PASS");
  assert.equal(manifest.entries[1]?.provenance.sourceMode, "INLINE");
  assert.ok(manifest.entries[1]?.observableFacts.includes("document title: Evidence Site"));
  assert.ok(manifest.entries[1]?.observableFacts.includes("h1 headings: Compiler"));
  assert.ok(manifest.entries[1]?.observableFacts.includes("nav elements: 1"));
  assert.equal(manifest.entries[1]?.unknownImplementationDetails, true);
});

test("html observer only emits supported observable facts", () => {
  const facts = observeHtml("<main><h1>Hello <em>World</em></h1><canvas></canvas><video></video></main>");
  assert.deepEqual(facts, ["h1 headings: Hello World", "main elements: 1", "videos: 1", "canvas elements: 1"]);
});

test("remote capture records deterministic HTML provenance with injected public transport", async () => {
  const html = "<!doctype html><html><head><title>Remote Evidence</title></head><body><main><h1>Observed</h1></main></body></html>";
  const result = await captureRemoteUrl("https://reference.example/page", {
    resolveHost: async () => ["93.184.216.34"],
    fetchImpl: async () => new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" }
    })
  });

  assert.equal(result.state, "PASS");
  assert.equal(result.provenance.sourceMode, "REMOTE");
  assert.equal(result.provenance.transportMode, "INJECTED_TEST");
  assert.equal(result.provenance.connectedAddress, "93.184.216.34");
  assert.equal(result.provenance.finalUrl, "https://reference.example/page");
  assert.equal(result.provenance.httpStatus, 200);
  assert.equal(result.provenance.contentType, "text/html");
  assert.match(result.provenance.responseSha256 ?? "", /^[a-f0-9]{64}$/);
  assert.ok(result.facts.includes("document title: Remote Evidence"));
  assert.ok(result.facts.includes("h1 headings: Observed"));
  await validateAgainstSchema({schema:"website-design-compiler/reference-manifest/v1",project:"remote-fixture",entries:[{id:"ref-001",kind:"url",source:"https://reference.example/page",captureState:result.state,observableFacts:result.facts,unknownImplementationDetails:true,provenance:result.provenance,reason:result.reason}]},"reference-manifest.schema.json");
});

test("remote capture fails closed for private and metadata-style targets before transport", async () => {
  let fetched = false;
  const result = await captureRemoteUrl("http://metadata.internal/latest", {
    resolveHost: async () => ["169.254.169.254"],
    fetchImpl: async () => {
      fetched = true;
      return new Response("unexpected");
    }
  });
  assert.equal(result.state, "FAIL");
  assert.equal(fetched, false);
  assert.match(result.reason ?? "", /non-public address/);
});

test("remote capture revalidates redirect targets and rejects redirect to loopback", async () => {
  let calls = 0;
  const result = await captureRemoteUrl("https://reference.example/start", {
    resolveHost: async (hostname) => hostname === "reference.example" ? ["93.184.216.34"] : ["127.0.0.1"],
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status: 302, headers: { location: "http://localhost/admin" } });
    }
  });
  assert.equal(result.state, "FAIL");
  assert.equal(calls, 1);
  assert.match(result.reason ?? "", /non-public address/);
});

test("remote capture rejects a connected peer that differs from the pinned DNS address", async () => {
  const result = await captureRemoteUrl("https://reference.example/", {
    maxRedirects: 0,
    resolveHost: async () => ["93.184.216.34"],
    transport: async () => ({
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      body: new TextEncoder().encode("<main></main>"),
      connectedAddress: "127.0.0.1",
      mode: "INJECTED_TEST"
    })
  });
  assert.equal(result.state, "FAIL");
  assert.match(result.reason ?? "", /connected address/);
});

test("one deadline covers DNS and transport instead of resetting between phases", async () => {
  const timeoutMs = 100;
  const startedAt = Date.now();
  let transportDeadline: number | undefined;
  const result = await captureRemoteUrl("https://reference.example/", {
    timeoutMs,
    resolveHost: async () => ["93.184.216.34"],
    transport: async ({ deadlineAt }) => {
      transportDeadline = deadlineAt;
      return await new Promise<never>(() => {});
    }
  });
  assert.ok(transportDeadline !== undefined);
  assert.ok(transportDeadline >= startedAt + timeoutMs);
  assert.ok(transportDeadline <= startedAt + timeoutMs + 20);
  assert.equal(result.state, "NOT_EXERCISED");
  assert.match(result.reason ?? "", /total deadline exceeded during transport/);
});

test("remote target IP policy rejects private/link-local/loopback and allows public addresses", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "fe80::1", "::ffff:c0a8:101", "::c0a8:101"]) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
  assert.equal(isPublicIpAddress("93.184.216.34"), true);
  assert.equal(isPublicIpAddress("2606:4700:4700::1111"), true);
});

test("originality policy rejects identity cloning", () => {
  const plan = buildOriginalityPlan();
  assert.equal(plan.policy, "GRAMMAR_ONLY_NO_IDENTITY_CLONING");
  assert.ok(plan.reject.includes("one-to-one page reproduction"));
  assert.ok(plan.reject.includes("invented implementation details"));
});
