// Prepara una comprobación para ejecutarla con Playwright.
// Cada plantilla es una función `async (page) => {…}` con el marcador __HTML__.
// Este guion incrusta el prototipo y abre una página nueva por corrida: setContent
// reutiliza la ventana y dejaría vivos temporizadores y escuchas de corridas anteriores.
// Uso: node generar.mjs <barrido|tareas|invariantes> <salida.js>
// La salida se ejecuta como `await (eval(codigo))(page)` con cualquier página de Playwright,
// o con la herramienta browser_run_code de Playwright MCP.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = dirname(fileURLToPath(import.meta.url))
const [nombre, salida] = process.argv.slice(2)
if (!['barrido', 'tareas', 'invariantes'].includes(nombre) || !salida) {
  console.error('Uso: node generar.mjs <barrido|tareas|invariantes> <salida.js>')
  process.exit(1)
}
const html = readFileSync(join(aqui, '..', 'prototipo.html'), 'utf8')
let codigo = readFileSync(join(aqui, nombre + '.js'), 'utf8').trim().replace('__HTML__', () => JSON.stringify(html))
if (!codigo.startsWith('async (page) => {') || !codigo.endsWith('}')) throw new Error('plantilla inesperada')
codigo = 'async (paginaBase) => {\n  const page = await paginaBase.context().newPage()\n  try {' +
  codigo.slice('async (page) => {'.length, -1) + '\n  } finally { await page.close() }\n}\n'
writeFileSync(salida, codigo)
console.log('escrito', salida)
