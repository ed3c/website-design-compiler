import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPublicIpAddress, observeHtml } from "./reference-capture.js";
import { productionPinnedTransport, sameNetworkAddress } from "./pinned-http-transport.js";

export interface LiveReferenceAdmit{
  schema:"website-design-compiler/live-reference-admit/v1";
  approvalId:string;
  approvedAt:string;
  targets:string[];
}
export interface LiveTransportResponse{status:number;headers:Record<string,string>;body:Uint8Array;connectedAddress:string;}
export interface LiveTransportRequest{url:URL;resolvedAddress:string;deadlineAt:number;timeoutMs:number;maxBytes:number;}
export type LiveTransport=(request:LiveTransportRequest)=>Promise<LiveTransportResponse>;
export interface LiveReferenceDependencies{
  resolveHost?:(hostname:string)=>Promise<string[]>;
  transport?:LiveTransport;
  transportMode?:"PRODUCTION"|"INJECTED";
  now?:()=>Date;
  sleep?:(milliseconds:number)=>Promise<void>;
  previousHashes?:Record<string,string>;
  timeoutMs?:number;
  maxBytes?:number;
  maxRedirects?:number;
  maxAttempts?:number;
  retryBackoffMs?:number;
}
export interface LiveReferenceTargetReceipt{
  target:string;
  state:"PASS"|"FAIL";
  availability:"AVAILABLE"|"UNAVAILABLE";
  finalUrl:string|null;
  redirects:string[];
  dns:Array<{hostname:string;addresses:string[];selectedAddress:string;connectedAddress:string}>;
  contentType:string|null;
  byteCount:number;
  responseSha256:string|null;
  observationIdentity:string|null;
  drift:"BASELINE"|"UNCHANGED"|"CHANGED"|"NOT_OBSERVED";
  observedAt:string;
  facts:string[];
  attempts:number;
  reason:string|null;
}
export interface LiveReferenceReceipt{
  schema:"website-design-compiler/live-reference-receipt/v2";
  overall:"PASS"|"FAIL"|"NOT_EXERCISED";
  executionMode:"LIVE";
  transportMode:"PRODUCTION"|"INJECTED";
  approval:{id:string;approvedAt:string;targetCount:number};
  policy:{httpsOnly:true;credentialsForbidden:true;queryForbidden:true;maxRedirects:number;maxBytes:number;timeoutMs:number;maxAttempts:number;retryBackoffMs:number};
  targets:LiveReferenceTargetReceipt[];
  promotionBlockedReason:string|null;
}

const sha256=(value:string|Uint8Array)=>createHash("sha256").update(value).digest("hex");
const defaultResolveHost=async(hostname:string)=>(await lookup(hostname,{all:true,verbatim:true})).map((record)=>record.address);
const delay=(milliseconds:number)=>new Promise<void>((resolve)=>setTimeout(resolve,milliseconds));
function safeUrl(value:string):URL{
  const url=new URL(value);
  if(url.protocol!=="https:")throw new Error("live reference requires HTTPS");
  if(url.username||url.password)throw new Error("live reference URL credentials are forbidden");
  if(url.search||url.hash)throw new Error("live reference query and fragment are forbidden from public receipts");
  if(url.port&&url.port!=="443")throw new Error("live reference non-standard ports are forbidden");
  if(url.hostname==="localhost"||url.hostname.endsWith(".localhost")||url.hostname.endsWith(".local")||url.hostname.endsWith(".internal"))throw new Error("live reference private hostname is forbidden");
  return url;
}
function safeReason(error:unknown):string{
  const message=error instanceof Error?error.message:"live reference capture failed";
  return message.replace(/https?:\/\/\S+/gi,"[redacted-url]").replace(/\/(?:Users|private|home|tmp)\/\S+/g,"[redacted-path]").replace(/(?:token|secret|password|cookie|authorization)\s*[=:]\s*\S+/gi,"[redacted-credential]").slice(0,300);
}
export function assertPublicLiveReceipt(receipt:LiveReferenceReceipt):void{
  const serialized=JSON.stringify(receipt);
  const forbidden=[/https?:\/\/[^/\s:@]+:[^@\s]+@/i,/[?&](?:token|secret|password|key|signature)=/i,/\/(?:Users|private|home|tmp)\//i,/(?:cookie|authorization)\s*[=:]/i];
  if(forbidden.some((pattern)=>pattern.test(serialized)))throw new Error("live reference receipt contains credential or machine-private state");
}
function sameAddress(left:string,right:string):boolean{
  return sameNetworkAddress(left,right);
}
async function productionTransport(input:LiveTransportRequest):Promise<LiveTransportResponse>{
  const response=await productionPinnedTransport({url:input.url,resolvedAddress:input.resolvedAddress,deadlineAt:input.deadlineAt,maxBytes:input.maxBytes});
  return{status:response.status,headers:response.headers,body:response.body,connectedAddress:response.connectedAddress};
}
function availabilityError(error:unknown):boolean{return /availability|timeout|ECONN|ENOTFOUND|EAI_AGAIN|HTTP 429|HTTP 5\d\d/i.test(error instanceof Error?error.message:String(error));}

async function withDeadline<T>(operation:Promise<T>,deadlineAt:number,label:string):Promise<T>{
  const remaining=Math.max(0,Math.ceil(deadlineAt-Date.now()));
  if(remaining===0)throw new Error(`availability total deadline exceeded before ${label}`);
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await new Promise<T>((resolve,reject)=>{timer=setTimeout(()=>reject(new Error(`availability total deadline exceeded during ${label}`)),remaining);void operation.then(resolve,reject);});}
  finally{if(timer!==undefined)clearTimeout(timer);}
}

async function captureTarget(target:string,dependencies:Required<Pick<LiveReferenceDependencies,"resolveHost"|"transport"|"now"|"sleep"|"previousHashes"|"timeoutMs"|"maxBytes"|"maxRedirects"|"maxAttempts"|"retryBackoffMs">>):Promise<LiveReferenceTargetReceipt>{
  const observedAt=dependencies.now().toISOString();
  let current:URL;
  try{current=safeUrl(target);}catch(error){return{target:"REDACTED_INVALID_TARGET",state:"FAIL",availability:"UNAVAILABLE",finalUrl:null,redirects:[],dns:[],contentType:null,byteCount:0,responseSha256:null,observationIdentity:null,drift:"NOT_OBSERVED",observedAt,facts:[],attempts:0,reason:safeReason(error)};}
  const redirects:string[]=[];const dns:LiveReferenceTargetReceipt["dns"]=[];
  let lastPublicUrl:string|null=null;let pendingRedirect:string|null=null;
  let attempts=0;
  for(let attempt=1;attempt<=dependencies.maxAttempts;attempt+=1){
    attempts=attempt;
    let endpointAvailable=false;
    try{
      const deadlineAt=Date.now()+dependencies.timeoutMs;
      for(let redirectCount=0;redirectCount<=dependencies.maxRedirects;redirectCount+=1){
        const addresses=isIP(current.hostname)?[current.hostname]:await withDeadline(dependencies.resolveHost(current.hostname),deadlineAt,"DNS resolution");
        if(addresses.length===0)throw new Error("availability hostname resolved to no addresses");
        if(addresses.some((address)=>!isPublicIpAddress(address)))throw new Error("live reference resolved to a non-public address");
        lastPublicUrl=current.toString();
        if(pendingRedirect){redirects.push(pendingRedirect);pendingRedirect=null;}
        const selectedAddress=addresses[0]!;
        const response=await withDeadline(dependencies.transport({url:current,resolvedAddress:selectedAddress,deadlineAt,timeoutMs:dependencies.timeoutMs,maxBytes:dependencies.maxBytes}),deadlineAt,"transport");
        if(!sameAddress(response.connectedAddress,selectedAddress))throw new Error("connected peer address does not match pinned DNS resolution");
        endpointAvailable=true;
        dns.push({hostname:current.hostname,addresses:[...addresses].sort(),selectedAddress,connectedAddress:response.connectedAddress});
        if(response.status>=300&&response.status<400){
          const location=response.headers.location;if(!location)throw new Error("live reference redirect missing Location header");
          if(redirectCount===dependencies.maxRedirects)throw new Error("live reference redirect limit exceeded");
          const next=safeUrl(new URL(location,current).toString());pendingRedirect=next.toString();current=next;continue;
        }
        if(response.status===429||response.status>=500)throw new Error(`availability HTTP ${response.status}`);
        if(response.status<200||response.status>=300)throw new Error(`live reference returned HTTP ${response.status}`);
        const contentType=(response.headers["content-type"]??"").split(";")[0]!.trim().toLowerCase();
        if(contentType!=="text/html"&&contentType!=="application/xhtml+xml")throw new Error(`live reference content type is not HTML: ${contentType||"missing"}`);
        if(response.body.byteLength>dependencies.maxBytes)throw new Error(`live reference exceeds ${dependencies.maxBytes} byte limit`);
        const responseSha256=sha256(response.body);const previous=dependencies.previousHashes[target];
        const drift=previous===undefined?"BASELINE":previous===responseSha256?"UNCHANGED":"CHANGED";
        return{target,state:"PASS",availability:"AVAILABLE",finalUrl:current.toString(),redirects,dns,contentType,byteCount:response.body.byteLength,responseSha256,observationIdentity:sha256(`${current.toString()}\0${responseSha256}`),drift,observedAt,facts:observeHtml(new TextDecoder().decode(response.body)).map(safeReason),attempts,reason:null};
      }
    }catch(error){
      if(availabilityError(error)&&attempt<dependencies.maxAttempts){await dependencies.sleep(dependencies.retryBackoffMs*attempt);continue;}
      return{target,state:"FAIL",availability:availabilityError(error)||!endpointAvailable?"UNAVAILABLE":"AVAILABLE",finalUrl:lastPublicUrl,redirects,dns,contentType:null,byteCount:0,responseSha256:null,observationIdentity:null,drift:"NOT_OBSERVED",observedAt,facts:[],attempts,reason:safeReason(error)};
    }
  }
  return{target,state:"FAIL",availability:"UNAVAILABLE",finalUrl:lastPublicUrl,redirects,dns,contentType:null,byteCount:0,responseSha256:null,observationIdentity:null,drift:"NOT_OBSERVED",observedAt,facts:[],attempts,reason:"availability retry budget exhausted"};
}

export async function verifyLiveReferences(admit:LiveReferenceAdmit,dependencies:LiveReferenceDependencies={}):Promise<LiveReferenceReceipt>{
  if(admit.schema!=="website-design-compiler/live-reference-admit/v1")throw new Error("live reference admit schema is invalid");
  if(!/^[a-zA-Z0-9._:-]{3,80}$/.test(admit.approvalId))throw new Error("live reference approvalId is invalid");
  if(!Number.isFinite(Date.parse(admit.approvedAt)))throw new Error("live reference approvedAt is invalid");
  if(admit.targets.length<2||new Set(admit.targets).size!==admit.targets.length)throw new Error("live reference admit requires at least two distinct targets");
  const inferredTransportMode=dependencies.transport||dependencies.resolveHost?"INJECTED":"PRODUCTION";
  if(dependencies.transportMode&&dependencies.transportMode!==inferredTransportMode)throw new Error("live reference transport mode does not match its dependencies");
  const transportMode=inferredTransportMode;
  const policy={httpsOnly:true as const,credentialsForbidden:true as const,queryForbidden:true as const,maxRedirects:dependencies.maxRedirects??3,maxBytes:dependencies.maxBytes??2*1024*1024,timeoutMs:dependencies.timeoutMs??10_000,maxAttempts:dependencies.maxAttempts??3,retryBackoffMs:dependencies.retryBackoffMs??250};
  const resolved={resolveHost:dependencies.resolveHost??defaultResolveHost,transport:dependencies.transport??productionTransport,now:dependencies.now??(()=>new Date()),sleep:dependencies.sleep??delay,previousHashes:dependencies.previousHashes??{},...policy};
  const targets=[] as LiveReferenceTargetReceipt[];
  for(const target of admit.targets){const result=await captureTarget(target,resolved);targets.push(result);if(result.state==="FAIL")break;}
  const allPass=targets.length===admit.targets.length&&targets.every((target)=>target.state==="PASS");
  const overall=transportMode!=="PRODUCTION"?"NOT_EXERCISED":allPass?"PASS":"FAIL";
  const receipt:LiveReferenceReceipt={schema:"website-design-compiler/live-reference-receipt/v2",overall,executionMode:"LIVE",transportMode,approval:{id:admit.approvalId,approvedAt:admit.approvedAt,targetCount:admit.targets.length},policy,targets,promotionBlockedReason:transportMode!=="PRODUCTION"?"Injected transport cannot promote live capability evidence.":allPass?null:"One or more approved live targets did not produce runtime PASS."};
  assertPublicLiveReceipt(receipt);
  return receipt;
}
