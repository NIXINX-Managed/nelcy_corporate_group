// Server-side license gate for Corporate Preview. No customer Firestore credentials are accepted here.
// The separate client Firestore authorization still needs its own licensed-access gate before production.
import {randomBytes} from "node:crypto";

export type CorporateDecision={allowed:boolean;referenceCode:string};

function referenceCode(){return "NX-"+randomBytes(5).toString("hex").toUpperCase();}
export function previewDataIsolationVerified(options:{
 environment:string|undefined;firebaseProjectId:string|undefined;expectedPreviewProject:string|undefined
}):boolean{
 if(options.environment!=="preview")return false;
 return Boolean(
   options.firebaseProjectId &&
   options.expectedPreviewProject &&
   options.firebaseProjectId===options.expectedPreviewProject &&
   options.firebaseProjectId!=="nelcy-corporate-group"
 );
}
const pilotHostname="nelcy-preview.corporate.nixinx.app";
const controlPreviewOrigin="https://nixinx-control-git-feat-control-corporat-ceb7ed-nixinx-projects.vercel.app";

export async function checkCorporateLicense(host:string):Promise<CorporateDecision>{
 const code=referenceCode();
 const isPilot=process.env.VERCEL_ENV==="preview"&&host.toLowerCase()===pilotHostname;
 const cfg={
   endpoint:process.env.NIXINX_CONTROL_API_URL?.trim()||(isPilot?controlPreviewOrigin:undefined),
   token:process.env.NIXINX_CONTROL_SERVICE_TOKEN,
   hostname:process.env.NIXINX_CORPORATE_HOSTNAME,
   tenantId:process.env.NIXINX_CONTROL_TENANT_ID?.trim()||(isPilot?"corporate-sbx":undefined),
   env:process.env.VERCEL_ENV,
 };
 // Fail closed for noncanonical hostnames, missing secrets and shared client data.
 const canonical=cfg.hostname?.trim().toLowerCase();
 if(cfg.env!=="preview" || !canonical||host.toLowerCase()!==canonical ||
    !cfg.endpoint||!cfg.endpoint.startsWith("https://")||
    !cfg.token||cfg.token.length<32||
    !cfg.tenantId ||
    !previewDataIsolationVerified({
      environment:cfg.env,
      firebaseProjectId:process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      expectedPreviewProject:process.env.NIXINX_PREVIEW_FIREBASE_PROJECT_ID
    })){
   console.warn("corporate_control_unavailable",JSON.stringify({referenceCode:code,reason:"MISSING_CONFIG_OR_ISOLATION",checks:{
    preview:cfg.env==="preview",
    canonicalHost:Boolean(canonical&&host.toLowerCase()===canonical),
    controlUrl:Boolean(cfg.endpoint?.startsWith("https://")),
    serviceToken:Boolean(cfg.token&&cfg.token.length>=32),
    tenant:Boolean(cfg.tenantId),
    firebaseIsolated:previewDataIsolationVerified({
      environment:cfg.env,
      firebaseProjectId:process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      expectedPreviewProject:process.env.NIXINX_PREVIEW_FIREBASE_PROJECT_ID
    })
   }}));
   return {allowed:false,referenceCode:code};
 }
 try{
   const url=new URL("/api/internal/entitlements",cfg.endpoint);
   const headers:Record<string,string>={
      "Content-Type":"application/json","Authorization":"Bearer "+cfg.token
   };
   const bypass=process.env.NIXINX_CONTROL_PREVIEW_PROTECTION_BYPASS;
   if(isPilot && url.origin===controlPreviewOrigin && bypass){
     headers["x-vercel-protection-bypass"]=bypass;
   }
   const response=await fetch(url,{
      method:"POST",cache:"no-store",redirect:"error",signal:AbortSignal.timeout(5000),
      headers,
      body:JSON.stringify({
       tenantId:cfg.tenantId,appId:"corporate",hostname:canonical,
       environment:"preview"
      })
   });
   const body=await response.json().catch(()=>null) as {allowed?:unknown;referenceCode?:unknown}|null;
   if(!response.ok)console.warn("corporate_control_http",JSON.stringify({referenceCode:code,status:response.status}));
   if(!response.ok || body?.allowed!==true)return {allowed:false,referenceCode:typeof body?.referenceCode==="string"&&/^NX-[A-F0-9]{10}$/.test(body.referenceCode)?body.referenceCode:code};
   return {allowed:true,referenceCode:code};
 }catch{
   console.warn("corporate_control_unavailable",JSON.stringify({referenceCode:code,reason:"CONTROL_UNREACHABLE"}));
   return {allowed:false,referenceCode:code};
 }
}
