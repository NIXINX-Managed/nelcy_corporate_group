// Regresión local: ejecuta con node tests/regression-check.cjs.
// Importaciones dinámicas para que ESLint aplique las mismas reglas al test.
async function main() {
const [{ default: fs }, { default: assert }, { default: ts }, { default: path }] = await Promise.all([
  import('node:fs'), import('node:assert/strict'), import('typescript'), import('node:path'),
]);
const base = path.resolve(__dirname, '..');
function compile(file, testInjection='') {
  const source = fs.readFileSync(`${base}/${file}`, 'utf8')+testInjection;
  const result = ts.transpileModule(source, {fileName:file,reportDiagnostics:true,compilerOptions:{
    target:ts.ScriptTarget.ES2022, jsx:ts.JsxEmit.ReactJSX, module:ts.ModuleKind.CommonJS,
    moduleResolution:ts.ModuleResolutionKind.Node10
  }});
  const errors=(result.diagnostics||[]).filter(d=>d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length,0, `${file} syntax: ${errors.map(e=>ts.flattenDiagnosticMessageText(e.messageText,' ')).join('; ')}`);
  return result.outputText;
}
function load(file, injector='', shim={}) {
  const localModule={exports:{}};const exports=localModule.exports;
  const code=compile(file,injector);
  new Function('module','exports','require',code)(localModule,exports,name=>{if(name in shim)return shim[name]; if(name==='react/jsx-runtime')return {}; throw Error(`Unexpected import: ${name}`);});
  return localModule.exports;
}
const fin=load('src/lib/finance.ts');
const money=[['13,808.20',1380820],['2,450.00',245000],['1750.25',175025],['1,000',100000],['$ 1,250.30 CAD',125030],['0.01',1]];
for(const [input,want] of money)assert.equal(fin.dollarsToCents(input),want,`money ${input}`);
for(const input of ['13,80','1,20.00','12.123','foo','-123.45','13,80,82','99999999999999999999999999'])assert.ok(Number.isNaN(fin.dollarsToCents(input)),`invalid ${input}`);
const bulk=load('src/lib/bulk-excel.ts','\nexport const __testDateValue=dateValue; export const __testMoneyValue=moneyValue;',{'@/lib/finance':fin});
assert.equal(bulk.__testDateValue(new Date('2026-06-01T00:00:00.000Z')),'2026-06-01','Excel date UTC midnight');
assert.equal(bulk.__testDateValue(new Date('2026-01-01T00:00:00.000Z')),'2026-01-01','New years date UTC midnight');
assert.equal(bulk.__testDateValue('2026-06-01'),'2026-06-01');
assert.equal(bulk.__testDateValue((Date.parse('2026-06-01T00:00:00Z') / 86400000) + 25569),'2026-06-01','Excel numeric serial');
assert.equal(bulk.__testMoneyValue('13,808.20'),1380820);
assert.equal(bulk.__testMoneyValue(13808.20),1380820);
for(const f of ['src/app/page.tsx','src/components/movement-actions.tsx','src/components/bulk-import.tsx','src/components/customer-catalog.tsx','src/components/catalog-import.tsx'])compile(f);
const rules=fs.readFileSync(`${base}/firestore.rules`,'utf8');
for(const v of ['validMovementUpdate','validAuditCreate','match /customers/{customerId}','match /audit/{revisionId}','allow update: if isWriter(orgId) && validMovementUpdate(orgId, movementId);', 'allow create: if isWriter(orgId) && validAuditCreate(orgId, movementId, revisionId);'])assert.ok(rules.includes(v),`rules missing ${v}`);
console.log(`OK: ${money.length} money normalization, 7 invalids, 5 date parsing/money, 5 syntax modules, audited rules guards`);
console.log('TZ:',Intl.DateTimeFormat().resolvedOptions().timeZone);

}
main().catch((error) => { console.error(error); process.exitCode = 1; });
