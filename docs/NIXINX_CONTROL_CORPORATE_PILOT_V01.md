# Corporate — piloto de integración con NIXINX Control (2026-11-22)

**Rama:** `feat/corporate-control-gate-v01`. No cambiar main ni publicar a Production mientras los gates estén abiertos. No copiar credenciales de Nelcy a Control.

## Estado comprobado

- Repositorio `NIXINX-Managed/nelcy_corporate_group` main actual, app Next.js 16, Auth/Firestore en navegador, Firestore del cliente `nelcy-corporate-group`, organización de datos `nelcy-group`, reglas de membresía existentes.
- Team Vercel `nixinx-projects`, proyecto `corporate`, Production `corporate.nixinx.app` con deploy anterior READY. **No equivale a acceso gobernado por Control.**
- Nuevo archivo `nixinx.manifest.json` toma sus seis módulos directamente del tipo `Tab` de `src/app/page.tsx`. El test rechaza divergencias; son identificadores de funciones de interfaz existentes, no promesa de licencia efectiva por módulo.
- Rama de Control `feat/control-corporate-service-entitlements-v05` añade `POST /api/internal/entitlements` con token servidor, binding `appInstallations/{hostname}`, tenant/app y licencia activos, autorización fail-closed y motivo de rechazo solo en logs internos.

## Domain y titularidad

- Producto NIXINX: `corporate.nixinx.app` (existente en Team NIXINX).
- Dominio de instancia de cliente **objetivo**, pendiente de autorización funcional: `nelcy.corporate.nixinx.app`.
- **Piloto aislado**, sin afectar Nelcy: `nelcy-preview.corporate.nixinx.app` → entorno Preview, rama `feat/corporate-control-gate-v01`. Necesita verificación DNS/dominio y entornos Vercel correspondientes.
- Al crear un tenant Corporate en NIXINX Control, asignar un `tenantId` propio estable. **No usar CTY** (es Cataleya) ni renombrar/transferir IDs de clientes. No crear licencia/cliente productivos para probar el piloto.

## Qué protege la rama

- Next.js RootLayout hace la comprobación en servidor antes de montar la aplicación, con tokens guardados en environment variables server-only (no `NEXT_PUBLIC_`).
- Valida hostname exacto, tenant y destino Control; si falta configuración, falla la red, hay revocación o hay discrepancia del proyecto Firebase de pruebas, muestra **Servicio no disponible** con código opaco `NX-XXXXXXXXXX`, jamás deuda o estado de facturación.
- En Preview prohíbe explícitamente el Firebase existente `nelcy-corporate-group`; solo permite un proyecto de prueba independiente y previamente autorizado. No hace escrituras ni copia datos del cliente.
- **NO certifica revocación E2E**: la PWA original usa SDK Firestore directamente, y una sesión ya autorizada podría acceder a su Firestore fuera de la página. Para terminar el contrato se requiere trasladar operaciones sensibles a un backend de la aplicación con autorización central, **o** implementar en reglas cliente un estado de licencia sincronizado en forma segura, que no puedan alterar los usuarios. Ambas opciones requieren revisión de reglas y pruebas negativas antes de Production.

## Configuración posterior, sin exponer credenciales

**Control Preview / server:**
- `NIXINX_CONTROL_CORPORATE_SERVICE_TOKEN`: secreto aleatorio de 32+ caracteres; guardado solo en servidor Vercel Control. Igual al valor privado guardado en Corporate; no subir a GitHub ni enviar por chat.
- En Firestore **de pruebas de NIXINX Control**, `tenants/nelcy` activo, `apps/corporate` activo, `licenses/nelcy_corporate` autorizado y `appInstallations/nelcy-preview.corporate.nixinx.app` con `tenantId=nelcy`, `appId=corporate`, `hostname=nelcy-preview.corporate.nixinx.app`, `environment=preview`, `status=active`, `verified=true`. Este registro requiere proceso administrativo validado: **no crearlo/activar a mano en una base que contenga clientes reales**.
- `appInstallations` no equivale a confianza automática en un hostname: el registro solo se puede activar después de comprobar DNS, app, Firebase, IAM, service credential y pruebas. La API que lo administra se implementará como próximo incremento.
- Un cliente no puede invocar esta API administrativa: el token solo puede vivir en el backend de Corporate. No se permite registrar tokens al navegador.

**Corporate Preview / server:**
- `NIXINX_CONTROL_API_URL`: URL HTTPS verificada de Control V05 Preview.
- `NIXINX_CONTROL_SERVICE_TOKEN`: mismo token secreto, servidor; nunca `NEXT_PUBLIC_`.
- `NIXINX_CONTROL_TENANT_ID=nelcy` en test; no usar CTY/HTL/HTW.
- `NIXINX_CORPORATE_HOSTNAME=nelcy-preview.corporate.nixinx.app`.
- `NIXINX_PREVIEW_FIREBASE_PROJECT_ID`: Firebase aislado de pruebas, distinto de `nelcy-corporate-group`, igual a `NEXT_PUBLIC_FIREBASE_PROJECT_ID`.
- `NEXT_PUBLIC_FIREBASE_*` y `NEXT_PUBLIC_ORG_ID` se configurarán para **ese mismo Firebase test**, no los de Nelcy.

**Gates:** QA navegador admin/usuario no autorizado, APIs directas, Firestore directo, cambios de tenant/host, suspensión, activación, errores de red, expiración de licencia, dominio alternativo, caché PWA, módulo no licenciado y auditoría. **Hasta completar estos gates, no exponer datos reales ni hacer merge a Corporate main.**

## Siguiente objetivo

1. Confirmar previews CI PASS y branch/commit real de ambos repos.
2. Asignar dominio Preview específico a rama sin tocar Production.
3. Crear/configurar Firebase de pruebas aislado y variables en Vercel por usuario autorizado; no almacenar secretos en FDV.
4. Completar registro administrado de instalación/manifest y sincronización de licencia efectiva hasta reglas Firestore.
5. Validar E2E con dos tenants sintéticos y escenarios de suspensión, luego ejecutar flujo normal de PR/merge con autorización para Production.

Aplicaciones siguientes: `initiatives` (`NIXINX-Software/initiatives-portal`) y `supply` (`NIXINX-Software/production-control`), reutilizando exactamente el contrato M2M y el gate de datos ya probado en Corporate, sin cambios a sus repos antes del piloto.
