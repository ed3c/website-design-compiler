import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSpdxExpression, parseSpdxExpression } from "../src/spdx-policy.js";
import { validateAgainstSchema } from "../src/validate.js";

test("simple permissive identifiers evaluate ALLOW with a schema-valid receipt", async () => {
  const result = evaluateSpdxExpression("MIT");
  assert.equal(result.state, "ALLOW");
  assert.deepEqual(result.identifiers, ["MIT"]);
  assert.equal(result.diagnostics.length, 0);
  await validateAgainstSchema(result, "spdx-policy-evaluation.schema.json");
});

test("OR chooses an admitted alternative while AND keeps the strictest obligation", () => {
  assert.equal(evaluateSpdxExpression("MIT OR GPL-3.0-only").state, "ALLOW");
  assert.equal(evaluateSpdxExpression("MIT AND GPL-3.0-only").state, "REVIEW_REQUIRED");
  assert.equal(evaluateSpdxExpression("MIT AND PolyForm-Noncommercial-1.0.0").state, "DENY");
});

test("parser respects AND precedence over OR and explicit parentheses", () => {
  const loose = evaluateSpdxExpression("MIT OR Apache-2.0 AND LicenseRef-Unknown");
  const grouped = evaluateSpdxExpression("(MIT OR Apache-2.0) AND LicenseRef-Unknown");
  assert.equal(loose.state, "ALLOW");
  assert.equal(grouped.state, "UNKNOWN");
  assert.notEqual(loose.astSha256, grouped.astSha256);
});

test("WITH exceptions never auto-promote a subject to ALLOW", () => {
  const known = evaluateSpdxExpression("Apache-2.0 WITH LLVM-exception");
  const unknown = evaluateSpdxExpression("Apache-2.0 WITH Vendor-exception-1.0");
  assert.equal(known.state, "REVIEW_REQUIRED");
  assert.match(known.diagnostics.join("; "), /requires explicit review/);
  assert.equal(unknown.state, "UNKNOWN");
  assert.match(unknown.diagnostics.join("; "), /not classified/);
});

test("unknown and custom identifiers stay UNKNOWN instead of substring-matching permissive names", () => {
  assert.equal(evaluateSpdxExpression("MITish").state, "UNKNOWN");
  assert.equal(evaluateSpdxExpression("LicenseRef-Proprietary").state, "UNKNOWN");
  assert.equal(evaluateSpdxExpression("DocumentRef-vendor:LicenseRef-custom").state, "UNKNOWN");
});

test("copyleft families are review-required while explicit non-commercial policy markers deny", () => {
  assert.equal(evaluateSpdxExpression("AGPL-3.0-only").state, "REVIEW_REQUIRED");
  assert.equal(evaluateSpdxExpression("LGPL-3.0-only").state, "REVIEW_REQUIRED");
  assert.equal(evaluateSpdxExpression("MPL-2.0").state, "REVIEW_REQUIRED");
  assert.equal(evaluateSpdxExpression("CC-BY-NC-4.0").state, "DENY");
});

test("OR remains fail-closed when no known viable alternative exists", () => {
  assert.equal(evaluateSpdxExpression("GPL-3.0-only OR LicenseRef-Unknown").state, "REVIEW_REQUIRED");
  assert.equal(evaluateSpdxExpression("PolyForm-Noncommercial-1.0.0 OR LicenseRef-Unknown").state, "UNKNOWN");
});

test("evaluation is deterministic and policy identity is explicit", () => {
  const first = evaluateSpdxExpression("MIT OR Apache-2.0");
  const second = evaluateSpdxExpression("MIT OR Apache-2.0");
  assert.equal(first.evaluationIdentitySha256, second.evaluationIdentitySha256);
  assert.match(first.policyIdentitySha256, /^[a-f0-9]{64}$/);
  assert.equal(first.normalizedExpression, "(MIT OR Apache-2.0)");
});

test("malformed expressions fail before an evaluation receipt can be emitted", () => {
  assert.throws(() => parseSpdxExpression(""), /must be non-empty/);
  assert.throws(() => parseSpdxExpression("MIT AND"), /expected SPDX license identifier/);
  assert.throws(() => parseSpdxExpression("(MIT OR Apache-2.0"), /unclosed parenthesis/);
  assert.throws(() => parseSpdxExpression("(MIT OR Apache-2.0) WITH LLVM-exception"), /WITH must apply to one license identifier/);
  assert.throws(() => parseSpdxExpression("MIT WITH"), /requires one exception identifier/);
  assert.throws(() => parseSpdxExpression("MIT @ Apache-2.0"), /invalid SPDX token/);
});
