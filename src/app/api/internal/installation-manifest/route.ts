import {NextRequest} from "next/server";

export const runtime="nodejs";
export const dynamic="force-dynamic";

// Public, non-secret handshake. Control verifies the EXACT hostname and sandbox
// Firebase binding before approving an installation. Never exposes credentials.
export async function GET(req:NextRequest){
 const host=req.headers.get("host")?.toLowerCase()||"";
 const canonical=process.env.NIXINX_CORPORATE_HOSTNAME?.toLowerCase();
 const project=process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
 const organization=process.env.NEXT_PUBLIC_ORG_ID;
 const sandbox=process.env.NIXINX_PREVIEW_FIREBASE_PROJECT_ID;
 if(process.env.VERCEL_ENV!=="preview"||
    !canonical||host!==canonical||
    !/^([a-z0-9-]+)\.corporate\.nixinx\.app$/.test(host)||
    !project||!sandbox||project!==sandbox||
    project==="nelcy-corporate-group"||
    !organization||!/^[a-z][a-z0-9-]{1,79}$/.test(organization)){
  return Response.json({ready:false},{status:503,headers:{"Cache-Control":"no-store"}});
 }
 return Response.json({
   ready:true,
   appId:"corporate",
   environment:"preview",
   hostname:host,
   firebaseProjectId:project,
   orgId:organization
 },{headers:{"Cache-Control":"no-store"}});
}
