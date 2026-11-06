/**
 * HSTS (EA-14, #40): la app se publica solo por HTTPS (Tailscale Funnel y
 * Render terminan TLS delante). El navegador ignora esta cabecera cuando la
 * respuesta llega por HTTP, así que `localhost` y las pruebas locales no
 * cambian. Se limita al propio host: sin `includeSubDomains` ni `preload`, que
 * comprometerían otros subdominios o la lista del navegador.
 */
const HSTS = "max-age=15552000"

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Strict-Transport-Security", value: HSTS }] }]
  },
}

export default nextConfig
