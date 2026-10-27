# Nelcy Corporate Group — Financial Control (MVP v0.1)

Aplicación Next.js 16 / React 19 / Firebase Authentication / Cloud Firestore / PWA.

## 1. Instalar dependencias

Desde el repositorio local:

```powershell
npm install firebase@12.19.0
```

Es necesario ejecutar este comando para incorporar Firebase al `package.json` y `package-lock.json` y evitar fallos de `npm ci` en Vercel.

## 2. Variables de entorno

Usar el archivo `.env.local` proporcionado por separado. Nunca incluirlo en Git.
Existe `.env.example` como referencia. En Vercel > Project > Settings > Environment Variables,
configurar las mismas siete variables `NEXT_PUBLIC_*` para Production, Preview y Development
según corresponda. Después hacer Redeploy.

El `apiKey` del SDK web es un identificador público del cliente Firebase, **no** una contraseña administrativa.
La seguridad la proporcionan Authentication y las reglas Firestore; no usar una service account ni
una `private_key` en el navegador.

## 3. Consola Firebase (obligatorio)

1. Seleccionar **nelcy-corporate-group**.
2. Authentication > Sign-in method: habilitar **Google** y configurar el correo de soporte.
3. Authentication > Settings > Authorized domains: incluir el dominio final de Vercel (y `localhost` para desarrollo si no está).
4. Firestore Database > Create database: crear la base `(default)` en **Production mode** y elegir región de Canadá cuando esté disponible. No abrir las reglas globales.
5. Firestore Database > Rules: reemplazar por **todo** el contenido de `firestore.rules`, después pulsar **Publish**.

### Alta inicial del administrador (manual, segura)

Las reglas no permiten autoasignarse privilegios. Para activar al primer usuario:

1. Abrir la aplicación y usar **Entrar con Google**.
2. La app mostrará el **UID** del usuario porque todavía no tiene acceso. Copiarlo.
3. En Firestore > Data crear el documento `organizations/nelcy-group` con:
   - `name` (string): `Nelcy Corporate Group`
4. Dentro del documento `nelcy-group`, crear subcolección `members`.
5. Crear documento `organizations/nelcy-group/members/<UID_COPIADO>` con:
   - `role` (string): `admin`
6. Volver a la aplicación y hacer clic en **Comprobar acceso**.

Las otras cuentas deben añadirse de forma explícita como miembros mediante la consola Firebase,
con `role` en `admin`, `editor` o `viewer`.
- `admin` y `editor`: lectura y creación de datos.
- `viewer`: solo lectura.
- En esta versión la administración de miembros está bloqueada desde el cliente web.
- Todos los miembros autorizados del grupo pueden leer **todas** las entidades del grupo; todavía
  no hay restricciones de lectura por empresa. Evaluar permisos por entidad antes de habilitar
  usuarios con necesidades de aislamiento.

## 4. Módulos

- Entidades: empresas y persona/ámbito personal.
- Categorías: conceptos de ingreso, costo directo y gasto operativo.
- Movimientos: ingresos, costos, gastos, transferencias, préstamos, abonos y retiros personales.
- Dashboard: ingresos, costos, gastos, resultado operativo, cambio de efectivo y participación por concepto.
- PWA: manifest, iconos y service worker. No se guardan datos financieros en caché offline.

### Clasificación y presentación de datos

- Los montos se guardan como **centavos enteros**, evitando imprecisión de punto flotante.
- `amountCents` es **importe total, con impuestos incluidos** y `taxCents` es la parte fiscal declarada.
- Rentabilidad gerencial preliminar: ingreso/costo/gasto = `amountCents - taxCents`.
- Transferencias/préstamos/retiros personales **no** afectan los márgenes operativos.
- La variación de efectivo suma entradas y salidas respecto de la selección de entidades.
  Las transferencias entre dos entidades seleccionadas se compensan, sin duplicación.
- Los abonos enlazan con el préstamo original (`loanId`); la interfaz controla el saldo en
  condiciones normales, pero el backend aún no valida concurrencia o límite acumulado.
- El dashboard muestra variación neta, **no saldo bancario ni flujo de efectivo contable completo**.
- Los préstamos se muestran desde todos los ejercicios, no solo el año filtrado.

## 5. Desarrollo y despliegue

```powershell
npm run dev
npm run lint
npm run build
git add .
git commit -m "Initialize Firebase financial MVP and PWA"
git push origin main
```

Verificar que `.env.local` **no** aparece en `git status` ni en los archivos del repositorio.
Vercel debe hacer build automáticamente a través de la integración ya establecida.

## 6. Advertencias para una segunda etapa

- Agregar auditoría de correcciones/anulaciones y saldos iniciales/reconciliación bancaria.
- Implementar catálogos jerárquicos, proveedores, cuentas bancarias, presupuestos y forecast.
- Añadir permisos granulares por entidad y administración de miembros mediante backend seguro.
- Antes de cargas masivas: paginación, índices y agregaciones por período.
- Para evitar sobreabonos de préstamos bajo concurrencia, mover las operaciones a una
  función transaccional validada en servidor. **No** usar el MVP como libro contable definitivo.
- No utilizar datos personales reales de nómina/bancos hasta validar el acceso y las reglas
  con pruebas de usuarios autorizados/no autorizados.
