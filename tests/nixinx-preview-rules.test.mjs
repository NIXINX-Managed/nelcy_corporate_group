import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const file=new URL("../firestore.preview.rules",import.meta.url);
const original=readFileSync(new URL("../firestore.rules",import.meta.url),"utf8");
const preview=readFileSync(file,"utf8");
const cfg=JSON.parse(readFileSync(new URL("../firebase.preview.json",import.meta.url),"utf8"));

test("preview rules are opt-in, separate from production rules",()=>{
  assert.equal(cfg.firestore.rules,"firestore.preview.rules");
  assert.notEqual(preview,original);
  assert.ok(!original.includes("hasActiveControlLease"),"production rules cannot be changed by the pilot");
});

test("every normal Corporate data path reuses guarded membership",()=>{
  assert.match(preview,/function isMember\(orgId\)\s*\{\s*return signedIn\(\) && hasActiveControlLease\(orgId\) && exists\(memberDoc\(orgId\)\);/);
  assert.match(preview,/function isWriter\(orgId\)\s*\{\s*return isMember\(orgId\)/);
  assert.match(preview,/match \/members\/\{uid\} \{[\s\S]*?allow get: if signedIn\(\) && hasActiveControlLease\(orgId\)/);
  assert.match(preview,/match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
});

test("preview lease is server-managed, scoped and expires according to Firestore time",()=>{
  assert.match(preview,/match \/nixinxControl\/\{docId\} \{[\s\S]*?allow read, write: if false;/);
  for(const c of [
    "exists(controlLeaseDoc(orgId))",
    "get(controlLeaseDoc(orgId)).data.active == true",
    "get(controlLeaseDoc(orgId)).data.appId == 'corporate'",
    "get(controlLeaseDoc(orgId)).data.environment == 'preview'",
    "get(controlLeaseDoc(orgId)).data.expiresAt > request.time"
  ])assert.ok(preview.includes(c),"missing lease guard: "+c);
});
