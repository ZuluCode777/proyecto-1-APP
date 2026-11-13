// Se inyecta en cada página: dibuja un círculo donde se toca la pantalla, para
// que en el video se vea qué se pulsó. No recibe eventos (`pointer-events:
// none`), está oculto para los lectores de pantalla y se borra solo. Va fuera
// de <body> para no tocar el árbol que maneja React.
;(() => {
  function dibujar(x, y) {
    const punto = document.createElement("div")
    punto.setAttribute("aria-hidden", "true")
    punto.style.cssText = [
      "position:fixed",
      `left:${x - 24}px`,
      `top:${y - 24}px`,
      "width:48px",
      "height:48px",
      "border-radius:50%",
      "background:rgba(236,64,122,0.35)",
      "border:3px solid rgba(236,64,122,0.95)",
      "box-sizing:border-box",
      "pointer-events:none",
      "z-index:2147483647",
      "transition:transform 0.5s ease-out, opacity 0.5s ease-out",
    ].join(";")
    document.documentElement.appendChild(punto)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        punto.style.transform = "scale(1.7)"
        punto.style.opacity = "0"
      }),
    )
    setTimeout(() => punto.remove(), 700)
  }
  window.addEventListener("pointerdown", (evento) => dibujar(evento.clientX, evento.clientY), {
    capture: true,
    passive: true,
  })
})()
