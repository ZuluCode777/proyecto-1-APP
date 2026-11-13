#!/usr/bin/env bash
# Arranca el backend Next.js ya compilado (`pnpm build`) detrás de un HTTPS con
# un certificado propio, para que la Consulta del iPhone hable con el servidor
# real desde el Simulator. Solo para el runner de grabación.
#
# Deja en $DEMO_HTTPS (por defecto $RUNNER_TEMP/demo-https o /tmp/demo-https):
#   ca.pem             autoridad que el Simulator debe confiar (grabar.sh la instala)
#   servidor.pem/.key  certificado de localhost y 127.0.0.1, firmado por esa autoridad
#   next.log, proxy.log
# Necesita APP_PASSWORD en el entorno (la app en producción la exige).
set -euo pipefail

: "${APP_PASSWORD:?Falta APP_PASSWORD}"
dir="${DEMO_HTTPS:-${RUNNER_TEMP:-/tmp}/demo-https}"
mkdir -p "$dir"
cd "$(dirname "$0")/../.."

cat > "$dir/ca.cnf" <<'EOF'
[req]
distinguished_name = dn
prompt = no
x509_extensions = v3_ca
[dn]
CN = TransMiVoz demo CA
[v3_ca]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
EOF
cat > "$dir/servidor.cnf" <<'EOF'
basicConstraints = CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = DNS:localhost,IP:127.0.0.1
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
EOF

openssl req -x509 -new -nodes -newkey rsa:2048 -sha256 -days 30 \
  -keyout "$dir/ca.key" -out "$dir/ca.pem" -config "$dir/ca.cnf"
openssl req -new -nodes -newkey rsa:2048 -sha256 \
  -keyout "$dir/servidor.key" -out "$dir/servidor.csr" -subj "/CN=localhost"
openssl x509 -req -in "$dir/servidor.csr" -CA "$dir/ca.pem" -CAkey "$dir/ca.key" -CAcreateserial \
  -out "$dir/servidor.pem" -days 30 -sha256 -extfile "$dir/servidor.cnf"

nohup pnpm start -H 127.0.0.1 -p 3000 > "$dir/next.log" 2>&1 &
DEMO_CERT="$dir/servidor.pem" DEMO_LLAVE="$dir/servidor.key" \
  nohup node demo/servidor-https.mjs > "$dir/proxy.log" 2>&1 &

for _ in $(seq 1 60); do
  curl -sf --cacert "$dir/ca.pem" -u "demo:$APP_PASSWORD" https://localhost:8443/ >/dev/null && break
  sleep 1
done
# Precalienta: la primera consulta espera al catálogo de TransMilenio (hasta 15 s),
# más que el plazo de 12 s de la app.
curl -sS --cacert "$dir/ca.pem" -u "demo:$APP_PASSWORD" -o /dev/null -w "catálogo: %{http_code} en %{time_total} s\n" \
  https://localhost:8443/api/transmilenio
curl -sS --cacert "$dir/ca.pem" -u "demo:$APP_PASSWORD" -H "content-type: application/json" \
  -d '{"message":"recorrido de la B23"}' https://localhost:8443/api/agent | head -c 400
echo
echo "Servidor HTTPS listo en https://localhost:8443 (autoridad: $dir/ca.pem)"
