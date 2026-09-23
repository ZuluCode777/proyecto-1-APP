# Skills instaladas

Dos conjuntos de skills, elegidos para este repositorio en vez de instalarlos
completos. Las skills en sí son de terceros y se dejan en su idioma original.

- **Conjunto de ingeniería** (`domain-modeling`, `tdd`, `diagnosing-bugs`,
  `prototype`, `codebase-design`, `grill-with-docs`, `setup-matt-pocock-skills`,
  `to-spec`, `to-tickets`, `triage`, `code-review`): las skills de Matt Pocock,
  copiadas del repositorio Second Brain App.
- **pstack** (todas las demás): de
  https://github.com/cursor/plugins/tree/main/pstack/skills.

## Por qué estas

TransMiVoz es una app Next.js pequeña cuya superficie son casi solo APIs del
dispositivo: micrófono, cámara, ubicación, brújula y síntesis de voz. La
selección sale de eso:

| Necesidad | Skills |
| --- | --- |
| Poner por escrito el dominio (estación, portal, ruta, modos) y de dónde salen los datos | `domain-modeling`, `principle-model-the-domain`, `grill-with-docs`, `codebase-design` |
| Demostrar que las funciones del dispositivo responden de verdad | `create-verification-skill`, `maintain-verification-skill`, `principle-prove-it-works` |
| Mantener correcta la lógica pura de `lib/` | `tdd`, `principle-fix-root-causes`, `diagnosing-bugs` |
| Proteger las rutas de la API | `principle-boundary-discipline` |
| Todo el repositorio es TypeScript | `typescript-best-practices` (se aplica sola por `paths`) |
| La accesibilidad es el producto, no una función | `principle-experience-first` |
| Documentación y el informe del curso | `technical-writing`, `unslop`, `teach`, `how`, `why` |
| Dar forma a trabajo no trivial antes de programar | `architect`, `prototype` |
| Backlog, si llega un equipo o un backlog calificado | `setup-matt-pocock-skills`, `to-spec`, `to-tickets`, `triage`, `code-review` |

## Notas

- La cadena del gestor de issues necesita correr una vez
  `/setup-matt-pocock-skills` antes de que `to-spec`, `to-tickets` o `triage`
  funcionen.
- `create-verification-skill` escribe en `.cursor/skills/`, la convención de
  pstack. Para Claude Code, apúntala a `.claude/skills/`.
- `domain-modeling` y `principle-model-the-domain` se solapan. Están las dos a
  pedido; `domain-modeling` es la que produce archivos (`CONTEXT.md`, ADR) y
  `principle-model-the-domain` es una regla para invocar en medio de una tarea.
- `code-review` de aquí tapa el comando `/code-review` que trae el entorno.
- Se dejaron fuera a propósito: `wayfinder` e `implement` del conjunto de
  ingeniería; `arena`, `swarm`, `interrogate`, `blast-radius`,
  `figure-it-out`, `no-comments`, el `tdd` de pstack y los `principle-*` sobre
  concurrencia, idempotencia y migración de APIs, que este código no tiene.
