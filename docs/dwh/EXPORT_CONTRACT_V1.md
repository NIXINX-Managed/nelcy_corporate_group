# Contrato de exportación — Nelcy Corporate Group / DWH (v1)

## Alcance y compatibilidad

Esta implementación agrega **un nuevo layout de clientes** y **exportaciones de solo lectura**.
No modifica `src/lib/bulk-excel.ts`, `src/components/bulk-import.tsx`, ni
`src/components/catalog-import.tsx`. Los layouts de movimientos v2, v3,
v4 y v5 y los catálogos anteriores conservan sus encabezados y semántica.

| Acción | Ubicación | Resultado |
| --- | --- | --- |
| Descargar/validar/importar clientes | Clientes | Un XLSX por empresa; clientes nuevos únicamente |
| Descargar/validar/importar empresas y conceptos | Pestañas actuales | Sin cambios |
| Descargar/validar/importar movimientos | Movimientos | Sin cambios |
| Exportar tablas y esquemas | Exportación DWH | NDJSON + BigQuery JSON schema |

Los nuevos catálogos de **cuentas/fuentes** y **medios de pago** no forman
parte de esta fase: todavía no existen sus documentos en Firestore ni sus
atributos validados. Su modelo transaccional se definirá antes de ampliar la
ingesta y los datasets de exportación. No inventar campos de pago a partir
de `counterparty` o `description`.

## Tablas

Todas las filas incluyen `schema_version` (STRING, "1"),
`organization_id` (STRING) y `extracted_at_utc` (TIMESTAMP, UTC).

- `dim_entity`: `entity_id` clave única por organización, nombre, tipo y estado.
- `dim_category`: `category_id` clave única por organización, nombre, clasificación y estado.
- `dim_customer`: `customer_id` clave única por organización, `company_id`,
  nombre, contacto, datos comerciales y estado. Puede contener información personal.
- `fact_movement`: `movement_id` clave única por organización,
  `transaction_date` (DATE), `movement_kind`, claves de origen/destino, concepto,
  cliente y préstamo, importes en centavos (INTEGER), timestamps UTC,
  revisión y estado de anulación.

Para `fact_movement`, `amount_cents` es el importe total, `tax_cents`
el impuesto capturado y `net_amount_cents = amount_cents - tax_cents`.
`currency_code = "CAD"`. El estado `voided` se conserva; **no filtrar
ni borrar esos registros en la exportación**. Los reportes financieros
deben aplicar el filtro de anulaciones al consultar el DWH.

Las transferencias/préstamos **se exportan una sola vez** con
`from_entity_id` y `to_entity_id`. No duplicarlas en la tabla
de hechos para representar ambos lados.

## Formato BigQuery

1. Acceder con `admin` o `editor`.
2. En **Exportación DWH**, elegir tabla y descargar `.ndjson`.
3. Descargar el archivo `bq_schema_<tabla>_v1.json` correspondiente.
4. Usar `NEWLINE_DELIMITED_JSON` en BigQuery con el esquema descargado,
   y respetar la región de datos que corresponda al proyecto del cliente.
5. En una carga recurrente, usar `(organization_id, <id>_id)`
   como llave de `MERGE` para actualizar versiones; no concatenar snapshots
   sin deduplicar.

Los campos opcionales ausentes se exportan como `null`, no como cadenas de
texto "null". Las fechas se conservan como `YYYY-MM-DD` **sin conversión de
zona horaria**; los timestamps Firestore son convertidos a UTC ISO-8601.
Los valores monetarios se exportan como enteros en centavos para evitar
errores de precisión.

No se incluye el historial de auditoría (subcolección `audit`) en esta
extracción manual v1; `revision`, `updated_at_utc` y `voided`
permiten conocer el estado actual de cada movimiento. La extracción
incremental de auditoría y cambios será una fase posterior.

## Limitaciones deliberadas

- Es una exportación **manual en navegador**, no un conector de BigQuery,
  ni un proceso batch automático, ni una instantánea ACID de múltiples tablas.
- Se leen documentos en páginas de 400 con tope de 100,000 registros por tabla.
  Los cambios concurrentes durante la lectura pueden producir diferencias;
  para operación del DWH se implementará un proceso automático y controlado.
- La exportación es de **todo el grupo**, sin filtrar ejercicios ni entidades,
  para preservar relaciones y evitar datasets incompletos.
- Las exportaciones de clientes contienen datos privados; conservar dentro del
  almacenamiento autorizado de la compañía y restringir su distribución.
- No se modifican reglas de Firestore, documentos históricos ni componentes
  originales de layouts por este cambio.

## Criterios de verificación antes de fusionar

1. Ejecutar `npm ci`, `node tests/regression-check.cjs`, `npm run lint`
   y `npm run build` en un entorno con dependencias instaladas.
2. Descargar layouts existentes v5 de ingresos, costos y gastos y comprobar
   que conservan su encabezado e interpretación.
3. Descargar un layout de clientes de una empresa activa, capturar dos clientes
   y comprobar la importación, la validación por compañía y reintento sin duplicados.
4. Exportar las cuatro tablas; confirmar que el esquema JSON descargado
   coincide exactamente con las claves de cada fila NDJSON.
5. Verificar que el ID de un movimiento entre dos compañías aparece una sola vez,
   que `voided` y `revision` se mantienen y que la fecha no se desplaza.
6. No fusionar a `main` ni publicar en Vercel hasta completar estos controles.


---

## Addendum v2 — Captura financiera y dimensiones de pagos (24 noviembre 2026)

Los layouts ya entregados (`NELCY-LAYOUT-2`, `-3`, `-4`, `-5`) siguen siendo
compatibles: se conservan los encabezados y la interpretación de importes.
Las nuevas plantillas **agregan columnas opcionales al final**. El parser
solo las procesa si sus encabezados coinciden exactamente.

Para costos y gastos con layout v5, se puede dejar vacía la columna
de subtotal y capturar exclusivamente **Total pagado**; el HST será
cero. Si se conoce, se captura en la nueva columna opcional HST.
Si se capturan subtotal e HST, sus importes deben coincidir.

### Modelo operativo

- `paymentAccounts`: cuentas/fuentes por `companyId`, CRUD con
  desactivación sin borrado físico.
- `paymentMethods`: catálogo del grupo de métodos (Cash, Cheque,
  E-Transfer, etc.), CRUD con desactivación.
- `movementTypes`: nombres de clasificaciones administrables con
  `kind` financiero inmutable para preservar los cálculos.
- `movements`: campos opcionales `fromAccountId`, `toAccountId`,
  `paymentMethodId`, `movementTypeId`. Todos referencian
  registros por ID; el cliente **no** determina la forma de pago.

Nuevas naturalezas técnicas:
- `account_transfer`: mismo `fromEntityId` y `toEntityId` de
  empresa, dos cuentas diferentes y HST cero. No impacta el resultado
  operativo ni crea una salida neta del grupo.
- `liability_payment`: salida de empresa para pago de pasivo;
  HST cero en la transferencia del pasivo, sin afectar por sí misma
  el resultado operativo.

El usuario puede instalar desde los catálogos las opciones solicitadas
(Retiros, Government Liabilities, Cataleya Debt From Loans - Liabilities,
Nelcy Personal Expenses y los rótulos Asset/Liabilities) con un botón
explícito; no se generan datos transaccionales.

### Tablas adicionales para BigQuery

| Colección Firestore | Tabla NDJSON BigQuery | PK |
| --- | --- | --- |
| `paymentAccounts` | `dim_payment_account` | (`organization_id`, `account_id`) |
| `paymentMethods` | `dim_payment_method` | (`organization_id`, `payment_method_id`) |
| `movementTypes` | `dim_movement_type` | (`organization_id`, `movement_type_id`) |

`fact_movement` agrega `from_account_id`, `to_account_id`,
`payment_method_id` y `movement_type_id` (STRING/NULLABLE).
Se preserva la fila única por movimiento y los montos en centavos.

El formato exportado sigue siendo NDJSON (`NEWLINE_DELIMITED_JSON`),
con un esquema JSON de BigQuery descargable por tabla.
**No es un conector de sincronización automática**; para ingestión
diaria en el DW segregado de Cataleya deberá implementarse un batch
Firestore → BigQuery con servicio y permisos específicos del cliente.

### Release protegido

**No usar** `firebase deploy --only firestore:rules` con el
`firebase.json` estándar: ese archivo apunta a `firestore.rules`
sin el guard de licencia de producción. Antes del frontend nuevo,
desplegar únicamente el archivo específico:

```powershell
firebase deploy --project nelcy-corporate-group --config firebase.production.json --only firestore:rules
```

El archivo `firebase.production.json` apunta a
`firestore.production.rules`, que **conserva**
`hasActiveControlLease`. Verificar que las reglas quedaron publicadas
y el acceso autorizado sigue funcionando antes de liberar el frontend
de `main`. La vista de producción NIXINX es
`https://nelcy.corporate.nixinx.app/`.

No se modifican datos existentes por la publicación de reglas.
Todas las pruebas de escritura Firestore con usuario autorizado
deben confirmarse después del despliegue antes de declarar GO-LIVE.
