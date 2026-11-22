import type {Metadata,Viewport} from "next";
import {headers} from "next/headers";
import PwaRegistration from "@/components/pwa-registration";
import {checkCorporateLicense} from "@/lib/nixinx-control-server";
import "./globals.css";

export const metadata:Metadata={
 title:"Nelcy Corporate Group | Financial Control",
 description:"Control financiero de empresas, movimientos internos y ámbito personal",
 applicationName:"Nelcy Finance",
 appleWebApp:{capable:true,statusBarStyle:"black-translucent",title:"Nelcy Finance"},
 icons:{icon:"/icons/icon-192.png",apple:"/icons/icon-192.png"}
};
export const viewport:Viewport={width:"device-width",initialScale:1,themeColor:"#0b1425"};

function Suspended({referenceCode}:{referenceCode:string}){
 return <main style={{
  minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",
  background:"#0b1425",color:"#e6edf7",padding:"24px",fontFamily:"system-ui, sans-serif"
 }}>
   <section style={{maxWidth:520,padding:40,borderRadius:18,border:"1px solid #263651",background:"#121e33",textAlign:"center"}}>
    <h1 style={{fontSize:28,marginBottom:18}}>Servicio no disponible</h1>
    <p style={{lineHeight:1.6}}>Este servicio no se encuentra disponible en este momento.</p>
    <p style={{fontSize:14,opacity:.8,marginTop:24}}>Código de referencia</p>
    <p style={{fontFamily:"monospace",fontWeight:700,letterSpacing:2,fontSize:21}}>{referenceCode}</p>
    <p style={{lineHeight:1.6,marginTop:24}}>Comuníquese con soporte de NIXINX e indique el código de referencia.</p>
   </section>
 </main>;
}

export default async function RootLayout({children}:Readonly<{children:React.ReactNode}>){
 const host=(await headers()).get("host")||"";
 const decision=await checkCorporateLicense(host);
 return <html lang="es"><body>{
  decision.allowed
    ?<><PwaRegistration/>{children}</>
    :<Suspended referenceCode={decision.referenceCode}/>
 }</body></html>;
}
