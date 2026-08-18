import assert from "node:assert/strict";
import test from "node:test";
import { verifyLiveReferences, type LiveReferenceAdmit, type LiveTransport } from "../src/live-reference.js";
import { validateAgainstSchema } from "../src/validate.js";

const admit:LiveReferenceAdmit={schema:"website-design-compiler/live-reference-admit/v1",approvalId:"human-admit-2026-08",approvedAt:"2026-08-18T00:00:00.000Z",targets:["https://one.example/reference","https://two.example/reference"]};
const html=new TextEncoder().encode("<!doctype html><html><head><title>Evidence</title></head><body><main><h1>Observed</h1></main></body></html>");
const transport:LiveTransport=async({resolvedAddress})=>({status:200,headers:{"content-type":"text/html"},body:html,connectedAddress:resolvedAddress});
const injected={resolveHost:async()=>["93.184.216.34"],transport,transportMode:"INJECTED" as const,now:()=>new Date("2026-08-18T01:00:00.000Z"),sleep:async()=>{}};

test("injected transport exercises controls but cannot impersonate live PASS",async()=>{
  const receipt=await verifyLiveReferences(admit,injected);
  assert.equal(receipt.overall,"NOT_EXERCISED");
  assert.ok(receipt.targets.every((target)=>target.state==="PASS"));
  assert.deepEqual(receipt.targets[0]?.facts,["document title: Evidence","h1 headings: Observed","main elements: 1"]);
  assert.equal(receipt.targets[0]?.facts.includes("live reference capture failed"),false);
  assert.match(receipt.promotionBlockedReason??"",/cannot promote live capability/);
  await validateAgainstSchema({...receipt,git:{sha:"a".repeat(40),ref:"refs/heads/test"}},"live-reference-receipt.schema.json");
});

test("receipt records DNS, peer, bytes, hashes and content drift identity",async()=>{
  const baseline=await verifyLiveReferences(admit,injected);
  const previousHashes=Object.fromEntries(baseline.targets.map((target)=>[target.target,target.responseSha256!]));
  const unchanged=await verifyLiveReferences(admit,{...injected,previousHashes});
  const target=unchanged.targets[0]!;
  assert.equal(target.drift,"UNCHANGED");
  assert.equal(target.byteCount,html.byteLength);
  assert.deepEqual(target.dns[0],{hostname:"one.example",addresses:["93.184.216.34"],selectedAddress:"93.184.216.34",connectedAddress:"93.184.216.34"});
  assert.match(target.responseSha256??"",/^[a-f0-9]{64}$/);
  assert.match(target.observationIdentity??"",/^[a-f0-9]{64}$/);
});

test("changed remote bytes create a new observation identity",async()=>{
  const baseline=await verifyLiveReferences(admit,injected);
  const previous=baseline.targets[0]!;
  const changedBody=new TextEncoder().encode("<!doctype html><html><body><main><h1>Changed</h1></main></body></html>");
  const changed=await verifyLiveReferences(admit,{...injected,previousHashes:{[admit.targets[0]!]:previous.responseSha256!},transport:async({resolvedAddress})=>({status:200,headers:{"content-type":"text/html"},body:changedBody,connectedAddress:resolvedAddress})});
  assert.equal(changed.targets[0]?.drift,"CHANGED");
  assert.notEqual(changed.targets[0]?.observationIdentity,previous.observationIdentity);
});

test("availability errors retry with bounded backoff and remain explicit",async()=>{
  let calls=0;const waits:number[]=[];
  const receipt=await verifyLiveReferences(admit,{...injected,maxAttempts:3,retryBackoffMs:10,sleep:async(ms)=>{waits.push(ms);},transport:async(input)=>{calls+=1;if(calls<3)throw new Error("availability timeout");return transport(input);}});
  assert.equal(receipt.targets[0]?.attempts,3);
  assert.deepEqual(waits,[10,20]);
});

test("an injected transport cannot be labelled as production",async()=>{
  await assert.rejects(()=>verifyLiveReferences(admit,{...injected,transportMode:"PRODUCTION"}),/transport mode does not match/);
});

test("reachable non-success HTTP is a functional failure, not an availability failure",async()=>{
  const receipt=await verifyLiveReferences(admit,{...injected,transport:async({resolvedAddress})=>({status:403,headers:{"content-type":"text/html"},body:new Uint8Array(),connectedAddress:resolvedAddress})});
  assert.equal(receipt.targets[0]?.state,"FAIL");
  assert.equal(receipt.targets[0]?.availability,"AVAILABLE");
});

test("DNS rebinding-style peer mismatch fails before evidence promotion",async()=>{
  const receipt=await verifyLiveReferences(admit,{...injected,transport:async()=>({status:200,headers:{"content-type":"text/html"},body:html,connectedAddress:"127.0.0.1"})});
  assert.equal(receipt.targets[0]?.state,"FAIL");
  assert.match(receipt.targets[0]?.reason??"",/connected peer address/);
  assert.equal(receipt.targets.length,1);
});

test("private redirect fails closed and does not execute the second target",async()=>{
  let calls=0;
  const receipt=await verifyLiveReferences(admit,{...injected,resolveHost:async(hostname)=>hostname==="one.example"?["93.184.216.34"]:["127.0.0.1"],transport:async({resolvedAddress})=>{calls+=1;return{status:302,headers:{location:"https://private.example/admin"},body:new Uint8Array(),connectedAddress:resolvedAddress};}});
  assert.equal(receipt.targets[0]?.state,"FAIL");
  assert.match(receipt.targets[0]?.reason??"",/non-public address/);
  assert.equal(JSON.stringify(receipt).includes("private.example"),false);
  assert.equal(receipt.targets.length,1);
  assert.equal(calls,1);
});

test("unsafe target is redacted and never transported",async()=>{
  let calls=0;
  const receipt=await verifyLiveReferences({...admit,targets:["https://one.example/reference?token=do-not-publish","https://two.example/reference"]},{...injected,transport:async(input)=>{calls+=1;return transport(input);}});
  assert.equal(receipt.targets[0]?.target,"REDACTED_INVALID_TARGET");
  assert.equal(JSON.stringify(receipt).includes("do-not-publish"),false);
  assert.equal(calls,0);
  assert.equal(receipt.targets.length,1);
});

test("observable text cannot leak credentials or machine-private paths",async()=>{
  const unsafeBody=new TextEncoder().encode("<html><head><title>token=do-not-publish</title></head><body><h1>/Users/person/private.txt</h1></body></html>");
  const receipt=await verifyLiveReferences(admit,{...injected,transport:async({resolvedAddress})=>({status:200,headers:{"content-type":"text/html"},body:unsafeBody,connectedAddress:resolvedAddress})});
  const serialized=JSON.stringify(receipt);
  assert.equal(serialized.includes("do-not-publish"),false);
  assert.equal(serialized.includes("/Users/person"),false);
});

test("live capture applies one deadline across DNS and transport",async()=>{
  const timeoutMs=100;
  const startedAt=Date.now();
  let transportDeadline:number|undefined;
  const receipt=await verifyLiveReferences(admit,{
    ...injected,
    timeoutMs,
    maxAttempts:1,
    resolveHost:async()=>["93.184.216.34"],
    transport:async({deadlineAt})=>{
      transportDeadline=deadlineAt;
      return await new Promise<never>(()=>{});
    }
  });
  assert.ok(transportDeadline!==undefined);
  assert.ok(transportDeadline>=startedAt+timeoutMs);
  assert.ok(transportDeadline<=startedAt+timeoutMs+20);
  assert.equal(receipt.targets[0]?.state,"FAIL");
  assert.match(receipt.targets[0]?.reason??"",/total deadline exceeded during transport/);
});
