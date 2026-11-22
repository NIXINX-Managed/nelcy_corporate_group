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
const {previewDataIsolationVerified}=await import("data:text/javascript;base64,"+Buffer.from(compiled).toString("base64"));

test("Preview refuses live Nelcy Firebase and missing/mismatched sandbox",()=>{
 const a={environment:"preview",firebaseProjectId:"nelcy-corporate-group",expectedPreviewProject:"nelcy-corporate-group"};
 assert.equal(previewDataIsolationVerified(a),false);
 assert.equal(previewDataIsolationVerified({...a,expectedPreviewProject:undefined}),false);
 assert.equal(previewDataIsolationVerified({...a,firebaseProjectId:"other-test-project"}),false);
 assert.equal(previewDataIsolationVerified({...a,firebaseProjectId:"other-test-project",expectedPreviewProject:"other-test-project"}),true);
 assert.equal(previewDataIsolationVerified({...a,environment:"production",firebaseProjectId:"nelcy-corporate-group"}),false);
});
