import Foundation

/// Respuestas JSON de `POST /api/planificador` con VALORES INVENTADOS (estaciones «Ejemplo», rutas «Z99» y «Z98»).
/// No vienen de un servidor real ni de ninguna ejecución: reproducen la FORMA de los esquemas de
/// `lib/contrato-planificador.ts` para probar el cliente sin red ni secretos. Son simulaciones de contrato, no
/// evidencia de que el backend real responda así. `lib/ea25-planificador.test.ts` lee los bloques FIXTURE y comprueba
/// que cumplen esos esquemas; los de «Inválidas» son los que el cliente debe RECHAZAR (o, el último, ignorar en lo
/// que no debe usar) y no se comprueban allí.
enum FixturesPlanificador {
    // FIXTURE-INICIO peticionBuscar
    static let peticionBuscar = #"""
    {"consulta":"Z99","operacion":"buscar-rutas"}
    """#
    // FIXTURE-FIN

    // FIXTURE-INICIO peticionDetalle
    static let peticionDetalle = #"""
    {"codigo":"Z99","operacion":"detalle-ruta"}
    """#
    // FIXTURE-FIN

    // FIXTURE-INICIO peticionLugares
    static let peticionLugares = #"""
    {"operacion":"listar-lugares"}
    """#
    // FIXTURE-FIN

    // FIXTURE-INICIO peticionViaje
    static let peticionViaje = #"""
    {"destino":"Estación Ejemplo Sur","operacion":"planear-viaje","origen":"Estación Ejemplo Norte"}
    """#
    // FIXTURE-FIN

    // FIXTURE-INICIO buscar
    static let buscar = #"""
    {"catalogo":{"antiguo":false,"procedencia":"Datos de prueba consultados el 1/1/2026."},"rutas":[{"codigo":"Z99","desde":"Estación Ejemplo Norte","hacia":"Estación Ejemplo Sur"},{"codigo":"Z98","desde":"Estación Ejemplo Sur","hacia":"Estación Ejemplo Norte"}],"total":2}
    """#
    // FIXTURE-FIN

    // FIXTURE-INICIO buscarTruncada
    static let buscarTruncada = #"""
    {"catalogo":{"antiguo":true,"procedencia":"Datos de una copia guardada de prueba."},"rutas":[{"codigo":"Z99","desde":"Estación Ejemplo Norte","hacia":"Estación Ejemplo Sur"},{"codigo":"Z98","desde":"Estación Ejemplo Sur","hacia":"Estación Ejemplo Norte"}],"total":63}
    """#
    // FIXTURE-FIN

    // FIXTURE-INICIO buscarVacia
    static let buscarVacia = #"""
    {"catalogo":{"antiguo":false,"procedencia":"Datos de prueba consultados el 1/1/2026."},"rutas":[],"total":0}
    """#
    // FIXTURE-FIN

    // FIXTURE-INICIO detalle
    static let detalle = #"""
    {"calendario":"opera","catalogo":{"antiguo":false,"procedencia":"Datos de prueba consultados el 1/1/2026."},"codigo":"Z99","desde":"Estación Ejemplo Norte","estaciones":[{"coordenada":{"lat":4.7,"lng":-74.08},"nombre":"Estación Ejemplo Norte","paradaVerificada":true},{"coordenada":{"lat":4.65,"lng":-74.085},"nombre":"Estación Ejemplo Centro","paradaVerificada":true},{"coordenada":{"lat":4.6,"lng":-74.09},"nombre":"Estación Ejemplo Sur","paradaVerificada":true}],"etiqueta":"Ejemplo Norte hacia Ejemplo Sur","hacia":"Estación Ejemplo Sur","horario":{"entreSemana":"5:00 a. m. - 11:00 p. m.","festivo":"","sabado":""},"sentido":"confirmado","trazado":[{"lat":4.7,"lng":-74.08},{"lat":4.65,"lng":-74.085},{"lat":4.6,"lng":-74.09}]}
    """#
    // FIXTURE-FIN

    // FIXTURE-INICIO detalleSinVerificar
    static let detalleSinVerificar = #"""
    {"calendario":"sin-verificar","catalogo":{"antiguo":true,"procedencia":"Datos de una copia guardada de prueba."},"codigo":"Z98","desde":"Estación Ejemplo Norte","estaciones":[{"coordenada":{"lat":4.7,"lng":-74.08},"nombre":"Estación Ejemplo Norte","paradaVerificada":false},{"coordenada":null,"nombre":"Estación Ejemplo Centro","paradaVerificada":false},{"coordenada":{"lat":4.6,"lng":-74.09},"nombre":"Estación Ejemplo Sur","paradaVerificada":false}],"etiqueta":"Ejemplo Norte hacia Ejemplo Sur","hacia":"Estación Ejemplo Sur","horario":{"entreSemana":"5:00 a. m. - 11:00 p. m.","festivo":"","sabado":""},"sentido":"sin-confirmar","trazado":[{"lat":4.7,"lng":-74.08},{"lat":4.65,"lng":-74.085},{"lat":4.6,"lng":-74.09}]}
    """#
    // FIXTURE-FIN

    // FIXTURE-INICIO lugares
    static let lugares = #"""
    {"catalogo":{"antiguo":false,"procedencia":"Datos de prueba consultados el 1/1/2026."},"lugares":["Estación Ejemplo Centro","Estación Ejemplo Norte","Estación Ejemplo Sur"]}
    """#
    // FIXTURE-FIN

    // FIXTURE-INICIO viajeOperativo
    static let viajeOperativo = #"""
    {"catalogo":{"antiguo":false,"procedencia":"Datos de prueba consultados el 1/1/2026."},"destino":"Estación Ejemplo Sur","origen":"Estación Ejemplo Norte","resultado":"operativo","rutasPorElTrazado":[],"tramos":[{"abordaje":{"coordenada":{"lat":4.7,"lng":-74.08},"nombre":"Estación Ejemplo Norte"},"codigoRuta":"Z99","conteoVerificado":true,"descenso":{"coordenada":{"lat":4.6,"lng":-74.09},"nombre":"Estación Ejemplo Sur"},"estacionesRecorridas":3,"trazado":[{"lat":4.7,"lng":-74.08},{"lat":4.65,"lng":-74.085},{"lat":4.6,"lng":-74.09}]}]}
    """#
    // FIXTURE-FIN

    // FIXTURE-INICIO viajeTransbordo
    static let viajeTransbordo = #"""
    {"catalogo":{"antiguo":false,"procedencia":"Datos de prueba consultados el 1/1/2026."},"destino":"Estación Ejemplo Sur","origen":"Estación Ejemplo Norte","resultado":"operativo","rutasPorElTrazado":[],"tramos":[{"abordaje":{"coordenada":{"lat":4.7,"lng":-74.08},"nombre":"Estación Ejemplo Norte"},"codigoRuta":"Z99","conteoVerificado":true,"descenso":{"coordenada":{"lat":4.65,"lng":-74.085},"nombre":"Estación Ejemplo Centro"},"estacionesRecorridas":2,"trazado":[{"lat":4.7,"lng":-74.08},{"lat":4.65,"lng":-74.085}]},{"abordaje":{"coordenada":{"lat":4.65,"lng":-74.085},"nombre":"Estación Ejemplo Centro"},"codigoRuta":"Z98","conteoVerificado":false,"descenso":{"coordenada":{"lat":4.6,"lng":-74.09},"nombre":"Estación Ejemplo Sur"},"estacionesRecorridas":1,"trazado":[{"lat":4.65,"lng":-74.085},{"lat":4.6,"lng":-74.09}]}]}
    """#
    // FIXTURE-FIN

    // FIXTURE-INICIO viajeCandidato
    static let viajeCandidato = #"""
    {"catalogo":{"antiguo":false,"procedencia":"Datos de prueba consultados el 1/1/2026."},"destino":"Estación Ejemplo Sur","origen":"Estación Ejemplo Norte","resultado":"candidato","rutasPorElTrazado":[],"tramos":[{"codigoRuta":"Z99"}]}
    """#
    // FIXTURE-FIN

    // FIXTURE-INICIO viajeCandidatoConTransbordo
    static let viajeCandidatoConTransbordo = #"""
    {"catalogo":{"antiguo":false,"procedencia":"Datos de prueba consultados el 1/1/2026."},"destino":"Estación Ejemplo Sur","origen":"Estación Ejemplo Norte","resultado":"candidato","rutasPorElTrazado":[],"tramos":[{"codigoRuta":"Z99"},{"codigoRuta":"Z98"}]}
    """#
    // FIXTURE-FIN

    // FIXTURE-INICIO viajeRecorrido
    static let viajeRecorrido = #"""
    {"catalogo":{"antiguo":false,"procedencia":"Datos de prueba consultados el 1/1/2026."},"destino":"Estación Ejemplo Sur","origen":"Estación Ejemplo Norte","resultado":"recorrido","rutasPorElTrazado":[{"codigo":"Z98","desde":"Estación Ejemplo Sur","hacia":"Estación Ejemplo Norte"}],"tramos":[]}
    """#
    // FIXTURE-FIN

    // FIXTURE-INICIO viajeSinRecorrido
    static let viajeSinRecorrido = #"""
    {"catalogo":{"antiguo":false,"procedencia":"Datos de prueba consultados el 1/1/2026."},"destino":"Estación Ejemplo Sur","origen":"Estación Ejemplo Norte","resultado":"sin-recorrido","rutasPorElTrazado":[],"tramos":[]}
    """#
    // FIXTURE-FIN

    // FIXTURE-INICIO viajeMismoLugar
    static let viajeMismoLugar = #"""
    {"catalogo":{"antiguo":false,"procedencia":"Datos de prueba consultados el 1/1/2026."},"destino":"Estación Ejemplo Norte","origen":"Estación Ejemplo Norte","resultado":"mismo-lugar","rutasPorElTrazado":[],"tramos":[]}
    """#
    // FIXTURE-FIN

    // Inválidas: el cliente las rechaza como respuesta incompatible.
    static let detalleLatitudInvalida = #"""
    {"calendario":"opera","catalogo":{"antiguo":false,"procedencia":"Datos de prueba consultados el 1/1/2026."},"codigo":"Z99","desde":"Estación Ejemplo Norte","estaciones":[{"coordenada":{"lat":91.0,"lng":-74.08},"nombre":"Estación Ejemplo Norte","paradaVerificada":false}],"etiqueta":"Ejemplo Norte hacia Ejemplo Sur","hacia":"Estación Ejemplo Sur","horario":{"entreSemana":"5:00 a. m. - 11:00 p. m.","festivo":"","sabado":""},"sentido":"confirmado","trazado":[{"lat":4.7,"lng":-74.08},{"lat":4.65,"lng":-74.085},{"lat":4.6,"lng":-74.09}]}
    """#

    static let detalleSentidoDesconocido = #"""
    {"calendario":"opera","catalogo":{"antiguo":false,"procedencia":"Datos de prueba consultados el 1/1/2026."},"codigo":"Z99","desde":"Estación Ejemplo Norte","estaciones":[],"etiqueta":"Ejemplo Norte hacia Ejemplo Sur","hacia":"Estación Ejemplo Sur","horario":{"entreSemana":"5:00 a. m. - 11:00 p. m.","festivo":"","sabado":""},"sentido":"al-reves","trazado":[{"lat":4.7,"lng":-74.08},{"lat":4.65,"lng":-74.085},{"lat":4.6,"lng":-74.09}]}
    """#

    static let detalleSinCatalogo = #"""
    {"calendario":"opera","codigo":"Z99","desde":"Estación Ejemplo Norte","estaciones":[{"coordenada":{"lat":4.7,"lng":-74.08},"nombre":"Estación Ejemplo Norte","paradaVerificada":true},{"coordenada":{"lat":4.65,"lng":-74.085},"nombre":"Estación Ejemplo Centro","paradaVerificada":true},{"coordenada":{"lat":4.6,"lng":-74.09},"nombre":"Estación Ejemplo Sur","paradaVerificada":true}],"etiqueta":"Ejemplo Norte hacia Ejemplo Sur","hacia":"Estación Ejemplo Sur","horario":{"entreSemana":"5:00 a. m. - 11:00 p. m.","festivo":"","sabado":""},"sentido":"confirmado","trazado":[{"lat":4.7,"lng":-74.08},{"lat":4.65,"lng":-74.085},{"lat":4.6,"lng":-74.09}]}
    """#

    static let detalleProcedenciaVacia = #"""
    {"calendario":"opera","catalogo":{"antiguo":false,"procedencia":"  "},"codigo":"Z99","desde":"Estación Ejemplo Norte","estaciones":[],"etiqueta":"Ejemplo Norte hacia Ejemplo Sur","hacia":"Estación Ejemplo Sur","horario":{"entreSemana":"5:00 a. m. - 11:00 p. m.","festivo":"","sabado":""},"sentido":"confirmado","trazado":[{"lat":4.7,"lng":-74.08},{"lat":4.65,"lng":-74.085},{"lat":4.6,"lng":-74.09}]}
    """#

    static let buscarTotalMenorQueRutas = #"""
    {"catalogo":{"antiguo":false,"procedencia":"Datos de prueba consultados el 1/1/2026."},"rutas":[{"codigo":"Z99","desde":"Estación Ejemplo Norte","hacia":"Estación Ejemplo Sur"},{"codigo":"Z98","desde":"Estación Ejemplo Sur","hacia":"Estación Ejemplo Norte"}],"total":1}
    """#

    static let buscarRutaSinCodigo = #"""
    {"catalogo":{"antiguo":false,"procedencia":"Datos de prueba consultados el 1/1/2026."},"rutas":[{"codigo":" ","desde":"Estación Ejemplo Norte","hacia":"Estación Ejemplo Sur"}],"total":1}
    """#

    static let lugaresRepetidos = #"""
    {"catalogo":{"antiguo":false,"procedencia":"Datos de prueba consultados el 1/1/2026."},"lugares":["Estación Ejemplo Norte","Estación Ejemplo Norte"]}
    """#

    static let viajeResultadoDesconocido = #"""
    {"catalogo":{"antiguo":false,"procedencia":"Datos de prueba consultados el 1/1/2026."},"destino":"Estación Ejemplo Sur","origen":"Estación Ejemplo Norte","resultado":"teletransporte","rutasPorElTrazado":[],"tramos":[]}
    """#

    static let viajeOperativoSinTramos = #"""
    {"catalogo":{"antiguo":false,"procedencia":"Datos de prueba consultados el 1/1/2026."},"destino":"Estación Ejemplo Sur","origen":"Estación Ejemplo Norte","resultado":"operativo","rutasPorElTrazado":[],"tramos":[]}
    """#

    static let viajeCandidatoSinRutas = #"""
    {"catalogo":{"antiguo":false,"procedencia":"Datos de prueba consultados el 1/1/2026."},"destino":"Estación Ejemplo Sur","origen":"Estación Ejemplo Norte","resultado":"candidato","rutasPorElTrazado":[],"tramos":[]}
    """#

    static let viajeRecorridoSinRutas = #"""
    {"catalogo":{"antiguo":false,"procedencia":"Datos de prueba consultados el 1/1/2026."},"destino":"Estación Ejemplo Sur","origen":"Estación Ejemplo Norte","resultado":"recorrido","rutasPorElTrazado":[],"tramos":[]}
    """#

    static let viajeMismoLugarConTramos = #"""
    {"catalogo":{"antiguo":false,"procedencia":"Datos de prueba consultados el 1/1/2026."},"destino":"Estación Ejemplo Norte","origen":"Estación Ejemplo Norte","resultado":"mismo-lugar","rutasPorElTrazado":[],"tramos":[{"abordaje":{"coordenada":{"lat":4.7,"lng":-74.08},"nombre":"Estación Ejemplo Norte"},"codigoRuta":"Z99","conteoVerificado":true,"descenso":{"coordenada":{"lat":4.6,"lng":-74.09},"nombre":"Estación Ejemplo Sur"},"estacionesRecorridas":3,"trazado":[{"lat":4.7,"lng":-74.08},{"lat":4.6,"lng":-74.09}]}]}
    """#

    static let viajeConTresTramos = #"""
    {"catalogo":{"antiguo":false,"procedencia":"Datos de prueba consultados el 1/1/2026."},"destino":"Estación Ejemplo Sur","origen":"Estación Ejemplo Norte","resultado":"operativo","rutasPorElTrazado":[],"tramos":[{"abordaje":{"coordenada":{"lat":4.7,"lng":-74.08},"nombre":"Estación Ejemplo Norte"},"codigoRuta":"Z99","conteoVerificado":true,"descenso":{"coordenada":{"lat":4.65,"lng":-74.085},"nombre":"Estación Ejemplo Centro"},"estacionesRecorridas":1,"trazado":[{"lat":4.7,"lng":-74.08},{"lat":4.65,"lng":-74.085}]},{"abordaje":{"coordenada":{"lat":4.7,"lng":-74.08},"nombre":"Estación Ejemplo Norte"},"codigoRuta":"Z99","conteoVerificado":true,"descenso":{"coordenada":{"lat":4.65,"lng":-74.085},"nombre":"Estación Ejemplo Centro"},"estacionesRecorridas":1,"trazado":[{"lat":4.7,"lng":-74.08},{"lat":4.65,"lng":-74.085}]},{"abordaje":{"coordenada":{"lat":4.7,"lng":-74.08},"nombre":"Estación Ejemplo Norte"},"codigoRuta":"Z99","conteoVerificado":true,"descenso":{"coordenada":{"lat":4.65,"lng":-74.085},"nombre":"Estación Ejemplo Centro"},"estacionesRecorridas":1,"trazado":[{"lat":4.7,"lng":-74.08},{"lat":4.65,"lng":-74.085}]}]}
    """#

    static let viajeEstacionesNegativas = #"""
    {"catalogo":{"antiguo":false,"procedencia":"Datos de prueba consultados el 1/1/2026."},"destino":"Estación Ejemplo Sur","origen":"Estación Ejemplo Norte","resultado":"operativo","rutasPorElTrazado":[],"tramos":[{"abordaje":{"coordenada":{"lat":4.7,"lng":-74.08},"nombre":"Estación Ejemplo Norte"},"codigoRuta":"Z99","conteoVerificado":true,"descenso":{"coordenada":{"lat":4.6,"lng":-74.09},"nombre":"Estación Ejemplo Sur"},"estacionesRecorridas":-1,"trazado":[{"lat":4.7,"lng":-74.08},{"lat":4.6,"lng":-74.09}]}]}
    """#

    static let viajeCandidatoConParadasDeUnServidorAnterior = #"""
    {"catalogo":{"antiguo":false,"procedencia":"Datos de prueba consultados el 1/1/2026."},"destino":"Estación Ejemplo Sur","origen":"Estación Ejemplo Norte","resultado":"candidato","rutasPorElTrazado":[],"tramos":[{"abordaje":{"coordenada":{"lat":4.7,"lng":-74.08},"nombre":"Estación Ejemplo Norte"},"codigoRuta":"Z99","conteoVerificado":true,"descenso":{"coordenada":{"lat":4.6,"lng":-74.09},"nombre":"Estación Ejemplo Sur"},"estacionesRecorridas":3,"trazado":[{"lat":4.7,"lng":-74.08},{"lat":4.65,"lng":-74.085},{"lat":4.6,"lng":-74.09}]}]}
    """#

    static func datos(_ json: String) -> Data { Data(json.utf8) }
}
