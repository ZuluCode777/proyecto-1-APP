# Instrucciones para agentes

## Máquina con Windows

La app se aloja en la máquina con Windows de Nicolás (`desktop-oa6r547`), en
la tailnet `taila37867.ts.net`. Desde el portátil se llega por SSH:

```bash
ssh -o BatchMode=yes -o IdentityAgent=none sb-windows
```

`sb-windows` es un alias de `~/.ssh/config` en el portátil
(`Nicolas@100.66.19.15`, con la llave `~/.ssh/id_ed25519_secondbrain_dev`).
La llave nunca se copia a este repositorio.

Es el computador real de Nicolás, no un entorno de pruebas, y lo usan otros
agentes al mismo tiempo. Reglas:

1. **La consola remota es PowerShell.** Separa comandos con `;`, no con `&`.
2. **Proyectos y compilaciones en `D:`**, no en `C:`.
3. **No asignes variables automáticas de PowerShell** (`$HOME`, `$PID`,
   `$INPUT`, `$ARGS`, `$HOST`, `$ERROR`, `$MATCHES`, `$PROFILE`, `$PWD`).
   La asignación falla en silencio y el valor viejo sigue ahí.
4. **Protege todo borrado de carpetas con su contenido.** Antes de borrar,
   comprueba que la ruta resuelta está dentro de la carpeta temporal o de la
   del proyecto, y aborta si no.
5. **Detén procesos solo por el PID que lanzaste**, nunca por nombre ni por
   patrón. Igual en el portátil.
6. **No dejes tokens en `.git/config`.** Para llevar código, usa
   `git bundle` y `scp`, o que Nicolás haga `git pull`.

Por qué: en otro proyecto, un script asignó `$home`, la asignación falló en
silencio y luego intentó borrar el perfil de usuario completo. No borró nada
solo por suerte.

## Idioma

Todo lo que se escribe en el repositorio va en español: código, comentarios,
documentación, issues, PR y commits. Las skills de `.claude/skills/` son de
terceros y quedan en su idioma.

## Antes de fusionar

`pnpm exec tsc --noEmit`, `pnpm test`, `pnpm build` y `pnpm verificar` en
verde. La integración continua corre lo mismo; solo se fusiona con la
integración continua en verde.
