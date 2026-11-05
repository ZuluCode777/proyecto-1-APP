/**
 * Ayuda de PRUEBA de EA-10 (#36): ejecuta un caso con `NODE_ENV` y `APP_PASSWORD`
 * fijados y restaura ambos pase lo que pase (éxito o error), para no filtrar
 * estado entre pruebas. Solo la usan las pruebas; no es código de la app.
 */

function fijarEnv({ nombre, valor }: { nombre: string; valor: string | undefined }): void {
  // Con clave dinámica se usa la firma de índice: `NODE_ENV` es de solo lectura
  // solo al accederlo por nombre literal.
  if (valor === undefined) delete process.env[nombre]
  else process.env[nombre] = valor
}

export async function conEntorno(
  { nodeEnv, clave }: { nodeEnv: string | undefined; clave: string | undefined },
  cuerpo: () => void | Promise<void>,
): Promise<void> {
  const nodeEnvPrevio = process.env.NODE_ENV
  const clavePrevia = process.env.APP_PASSWORD
  fijarEnv({ nombre: "NODE_ENV", valor: nodeEnv })
  fijarEnv({ nombre: "APP_PASSWORD", valor: clave })
  try {
    await cuerpo()
  } finally {
    fijarEnv({ nombre: "NODE_ENV", valor: nodeEnvPrevio })
    fijarEnv({ nombre: "APP_PASSWORD", valor: clavePrevia })
  }
}
