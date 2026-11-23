import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const manifest=JSON.parse(fs.readFileSync(new URL("../nixinx.manifest.json",import.meta.url),"utf8"));
const page=fs.readFileSync(new URL("../src/app/page.tsx",import.meta.url),"utf8");
const found=page.match(/type Tab = ([^;]+);/);
const ids=[...found[1].matchAll(/"([^"]+)"/g)].map(x=>x[1]);
const declared=manifest.modules.map(x=>x.id);

test("Corporate manifest exactly reflects implemented top-level tab IDs",()=>{
 assert.equal(manifest.applicationId,"corporate");
 assert.deepEqual(declared,ids);
 assert.equal(new Set(declared).size,declared.length);
});
const source=fs.readFileSync(new URL("../src/lib/nixinx-control-server.ts",import.meta.url),"utf8");
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {previewDataIsolationVerified,checkCorporateLicense}=await import("data:text/javascript;base64,"+Buffer.from(compiled).toString("base64"));

test("Preview refuses live Nelcy Firebase and missing/mismatched sandbox",()=>{
 const a={environment:"preview",firebaseProjectId:"nelcy-corporate-group",expectedPreviewProject:"nelcy-corporate-group"};
 assert.equal(previewDataIsolationVerified(a),false);
 assert.equal(previewDataIsolationVerified({...a,expectedPreviewProject:undefined}),false);
 assert.equal(previewDataIsolationVerified({...a,firebaseProjectId:"other-test-project"}),false);
 assert.equal(previewDataIsolationVerified({...a,firebaseProjectId:"other-test-project",expectedPreviewProject:"other-test-project"}),true);
 assert.equal(previewDataIsolationVerified({...a,environment:"production",firebaseProjectId:"nelcy-corporate-group"}),false);
});

test("Production license requests are scoped to the Nelcy host and Firebase",async context=>{
 const config={
  VERCEL_ENV:"production",
  NIXINX_CORPORATE_PRODUCTION_GATE:"enabled",
  NIXINX_CORPORATE_HOSTNAME:"nelcy.corporate.nixinx.app",
  NIXINX_CONTROL_API_URL:"https://nixinx-control.nixinx.org",
  NIXINX_CONTROL_SERVICE_TOKEN:"x".repeat(32),
  NIXINX_CONTROL_TENANT_ID:"nelcy",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID:"nelcy-corporate-group"
 };
 const previous=Object.fromEntries(Object.keys(config).map(key=>[key,process.env[key]]));
 context.after(()=>{
  for(const [key,value] of Object.entries(previous)){
   if(value===undefined)delete process.env[key];
   else process.env[key]=value;
  }
 });
 Object.assign(process.env,config);
 const request=context.mock.method(globalThis,"fetch",async(url,options)=>{
  assert.equal(url.origin,config.NIXINX_CONTROL_API_URL);
  assert.equal(JSON.parse(options.body).environment,"production");
  return Response.json({allowed:true});
 });
 assert.equal((await checkCorporateLicense("nelcy.corporate.nixinx.app")).allowed,true);
 assert.equal((await checkCorporateLicense("corporate.nixinx.app")).allowed,false);
 process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID="nixinx-corporate-sbx-26";
 assert.equal((await checkCorporateLicense("nelcy.corporate.nixinx.app")).allowed,false);
 delete process.env.NIXINX_CORPORATE_PRODUCTION_GATE;
 assert.equal((await checkCorporateLicense("corporate.example.com")).allowed,true);
 assert.equal(request.mock.callCount(),1);
});
