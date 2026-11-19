/*
 * Cálculos hidroquímicos — port fiel de calculadora_hidrica (Python):
 * models.py + input_cli.py (factores) + calculations.py + reports.py.
 * Funciona en el navegador (window.Calculos) y en Node (module.exports).
 * Todo valor ausente se representa con null (equivale a None en Python).
 */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------
  // Utilidades para imitar el redondeo y formato de Python
  // ---------------------------------------------------------------

  /** Equivale a f"{x:.{d}f}" de Python (empates exactos → par). */
  function pyFixed(x, d) {
    if (Number.isNaN(x)) return "nan";
    if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
    const neg = x < 0 || Object.is(x, -0);
    const a = Math.abs(x);
    let out;
    if (a >= 1e21) {
      out = BigInt(a).toString() + (d > 0 ? "." + "0".repeat(d) : "");
    } else {
      const largo = a.toFixed(100);
      const punto = largo.indexOf(".");
      const resto = largo.slice(punto + 1 + d);
      const esEmpate = /^50*$/.test(resto);
      out = a.toFixed(d); // JS redondea los empates hacia arriba
      if (esEmpate) {
        const truncado = d > 0 ? largo.slice(0, punto + 1 + d) : largo.slice(0, punto);
        const ultimo = Number(truncado[truncado.length - 1]);
        if (ultimo % 2 === 0) out = truncado; // Python: mitad hacia el par
      }
    }
    return (neg ? "-" : "") + out;
  }

  /** Equivale a round(x, d) de Python. */
  function pyRound(x, d) {
    return parseFloat(pyFixed(x, d));
  }

  /** Equivale a str(x) / repr(x) de un float de Python. */
  function pyStr(x) {
    if (x === null || x === undefined) return "None";
    if (Number.isNaN(x)) return "nan";
    if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
    const a = Math.abs(x);
    if (Number.isInteger(x) && a < 1e16) return (Object.is(x, -0) ? "-" : "") + x.toFixed(1);
    if (a !== 0 && (a < 1e-4 || a >= 1e16)) {
      const [m, e] = x.toExponential().split("e");
      const signo = e[0] === "-" ? "-" : "+";
      return m + "e" + signo + e.replace(/^[+-]/, "").padStart(2, "0");
    }
    return String(x);
  }

  // ---------------------------------------------------------------
  // Modelo de datos
  // ---------------------------------------------------------------

  const CAMPOS_MUESTRA = [
    "residuo_seco", "conductividad", "ph", "alcalinidad_carbonato",
    "alcalinidad_bicarbonato", "cloruro", "r_cloruro", "sulfato", "r_sulfato",
    "carbonato", "r_carbonato", "bicarbonato", "r_bicarbonato", "calcio",
    "r_calcio", "magnesio", "r_magnesio", "sodio", "r_sodio", "potasio",
    "r_potasio", "nitrato", "r_nitrato", "silice", "mol_silice", "estroncio",
    "r_estroncio", "precipitacion_calcita", "hidrolisis_silice_biogenica",
  ];

  function crearMuestra(datos) {
    const m = { identificacion: "" };
    CAMPOS_MUESTRA.forEach((c) => { m[c] = null; });
    return Object.assign(m, datos);
  }

  // Factores de conversión mg/L → meq/L (o mmol/L en sílice) de input_cli.py
  const FACTORES = {
    cloruro: ["r_cloruro", 0.028],
    sulfato: ["r_sulfato", 0.021],
    carbonato: ["r_carbonato", 0.033],
    bicarbonato: ["r_bicarbonato", 0.016],
    calcio: ["r_calcio", 0.05],
    magnesio: ["r_magnesio", 0.083],
    sodio: ["r_sodio", 0.043],
    potasio: ["r_potasio", 0.026],
    nitrato: ["r_nitrato", 0.016],
    silice: ["mol_silice", 1 / 60],
    estroncio: ["r_estroncio", 0.0228],
  };

  /**
   * Arma la muestra a partir de las concentraciones ingresadas (mg/L).
   * Calcula los equivalentes igual que cargar_muestra(); si el potasio
   * queda vacío se toma 0, como en el programa original.
   */
  function muestraDesdeEntradas(entradas) {
    const valores = {};
    const campos = [
      "residuo_seco", "conductividad", "ph", "alcalinidad_carbonato",
      "alcalinidad_bicarbonato", "cloruro", "sulfato", "carbonato",
      "bicarbonato", "calcio", "magnesio", "sodio", "potasio", "nitrato",
      "silice", "estroncio",
    ];
    campos.forEach((campo) => {
      let v = entradas[campo];
      if (v === undefined) v = null;
      if (campo === "potasio" && v === null) v = 0.0;
      valores[campo] = v;
      if (FACTORES[campo]) {
        const [eq, factor] = FACTORES[campo];
        valores[eq] = v !== null ? v * factor : null;
      }
    });
    return crearMuestra(Object.assign(valores, {
      identificacion: entradas.identificacion || "",
      precipitacion_calcita: entradas.precipitacion_calcita ?? null,
      hidrolisis_silice_biogenica: entradas.hidrolisis_silice_biogenica ?? null,
    }));
  }

  // ---------------------------------------------------------------
  // Cálculos (calculations.py)
  // ---------------------------------------------------------------

  const hay = (v) => v !== null && v !== undefined;

  function sumaDisponibles(...valores) {
    return valores.reduce((acc, v) => (hay(v) ? acc + v : acc), 0);
  }

  // Devuelve [redondeado a 1 decimal, redondeado a 2 decimales]; nunca divide por cero.
  function relacion(num, den) {
    if (!hay(num) || !hay(den) || den === 0) return [null, null];
    const v = num / den;
    return [pyRound(v, 1), pyRound(v, 2)];
  }

  function calcularRelaciones(m, bicarbonatoEq, carbonatoEq, sumaAniones) {
    const [r1, r1m] = relacion(m.r_calcio, m.r_magnesio);
    const [r2, r2m] = relacion(m.r_sodio, m.r_cloruro);
    const [r3, r3m] = relacion(m.r_calcio, m.r_sodio);
    const [r4, r4m] = relacion(m.r_calcio, m.r_sulfato);

    let r5 = null, r5m = null;
    if (hay(m.r_cloruro) && hay(m.r_sodio) && hay(m.r_potasio) && m.r_cloruro !== 0) {
      const v = (m.r_cloruro - (m.r_sodio + m.r_potasio)) / m.r_cloruro;
      r5 = pyRound(v, 1); r5m = pyRound(v, 2);
    }

    let r6 = null, r6m = null;
    if (hay(m.mol_silice) && hay(bicarbonatoEq) && bicarbonatoEq !== 0) {
      const den = bicarbonatoEq + (carbonatoEq || 0.0);
      [r6, r6m] = relacion(m.mol_silice, den);
    }

    let r7 = null, r7m = null;
    if (hay(m.mol_silice) && hay(m.r_sodio) && hay(m.r_potasio) && hay(m.r_cloruro)) {
      const den = m.r_sodio + m.r_potasio - m.r_cloruro;
      [r7, r7m] = relacion(m.mol_silice, den);
    }

    let r8 = null, r8m = null;
    if (hay(m.r_calcio) && hay(m.r_sodio) && hay(m.r_potasio) && hay(m.r_cloruro)) {
      const alcalinosNetos = m.r_sodio + m.r_potasio - m.r_cloruro;
      [r8, r8m] = relacion(alcalinosNetos, alcalinosNetos + m.r_calcio);
    }

    const [r9, r9m] = relacion(m.r_estroncio, m.r_calcio);

    let r10 = null, r10m = null;
    if (hay(bicarbonatoEq) && sumaAniones !== 0) {
      const num = bicarbonatoEq + (carbonatoEq || 0.0);
      [r10, r10m] = relacion(num, sumaAniones);
    }

    return [
      { R1: r1, R2: r2, R3: r3, R4: r4, R5: r5, R6: r6, R7: r7, R8: r8, R9: r9, R10: r10 },
      { R1: r1m, R2: r2m, R3: r3m, R4: r4m, R5: r5m, R6: r6m, R7: r7m, R8: r8m, R9: r9m, R10: r10m },
    ];
  }

  function contarProcesos(r, rm) {
    const p = {};
    for (let i = 1; i <= 8; i++) p["P" + i] = 0;
    const ok = hay;

    if (ok(r.R1) && r.R1 > 4) p.P3 += 1;
    if (ok(r.R2) && r.R2 >= 0.9 && r.R2 <= 1.1) p.P1 += 1;
    if (ok(r.R2) && r.R2 > 1.1) { p.P6 += 1; p.P7 += 1; }
    if (ok(r.R2) && r.R2 < 0.9) p.P8 += 1;

    if (ok(r.R3) && r.R3 < 0.9) { p.P5 += 1; p.P7 += 1; }
    if (ok(r.R3) && r.R3 > 1.1) { p.P4 += 1; p.P8 += 1; }
    if (ok(r.R4) && r.R4 >= 0.9 && r.R4 <= 1.1) p.P2 += 1;
    if (ok(r.R4) && r.R4 < 0.9) p.P7 += 1;

    if (ok(r.R5) && r.R5 <= -1.0) { p.P5 += 1; p.P7 += 1; }
    if (ok(r.R5) && r.R5 >= 1.0) p.P8 += 1;
    if (ok(r.R6) && r.R6 > 0.22) p.P6 += 1;
    if (ok(r.R6) && r.R6 < 0.09) p.P3 += 1;

    if (ok(r.R7) && r.R7 < 0.9) p.P7 += 1;
    if (ok(r.R7) && r.R7 >= 0.9 && r.R7 <= 2.2) p.P6 += 1;
    if (ok(r.R7) && r.R7 > 2.2) p.P4 += 1;
    if (ok(r.R8) && r.R8 >= 0.2 && r.R8 <= 0.8) p.P6 += 1;
    if (ok(r.R9) && r.R9 < 0.009) p.P3 += 1;
    if (ok(r.R9) && r.R9 > 0.01) p.P6 += 1;
    if (ok(r.R10) && r.R10 <= 0.7) { p.P1 += 1; p.P2 += 1; }
    if (ok(r.R10) && r.R10 > 0.9) p.P6 += 1;
    if (ok(rm.R10) && rm.R10 >= 0.9) p.P3 += 1;
    return p;
  }

  function calcularPuntajes(m, procesos) {
    const tieneSilice = hay(m.silice);
    const tieneEstroncio = hay(m.estroncio);
    let f;
    if (tieneSilice && tieneEstroncio) {
      f = { P1: 3.3 / 2, P2: 3.3 / 2, P3: 6.6 / 4, P4: 3.3 / 2, P5: 3.3 / 2, P6: 10 / 6, P7: 8.3 / 5, P8: 5.0 / 3 };
    } else if (tieneSilice) {
      f = { P1: 4.0 / 2, P2: 4.0 / 2, P3: 6.0 / 3, P4: 4.0 / 2, P5: 4.0 / 2, P6: 10 / 5, P7: 10 / 5, P8: 6.0 / 3 };
    } else if (tieneEstroncio) {
      f = { P1: 0, P2: 0, P3: 7.5 / 3, P4: 2.5 / 2, P5: 0, P6: 10 / 4, P7: 10 / 4, P8: 7.5 / 3 };
    } else {
      f = { P1: 5.0 / 2, P2: 5.0 / 2, P3: 5.0 / 2, P4: 2.5 / 2, P5: 5.0 / 2, P6: 7.5 / 3, P7: 10 / 4, P8: 7.5 / 3 };
    }
    const out = {};
    Object.keys(f).forEach((k) => { out[k] = f[k] * procesos[k]; });
    return out;
  }

  function calcular(m) {
    const sumaCationes = sumaDisponibles(m.r_calcio, m.r_magnesio, m.r_sodio, m.r_potasio);
    const sumaAniones = sumaDisponibles(m.r_cloruro, m.r_sulfato, m.r_bicarbonato, m.r_carbonato, m.r_nitrato);

    let bicarbonatoEq = m.r_bicarbonato;
    let carbonatoEq = m.r_carbonato;
    const tieneAlcalinidades = hay(m.alcalinidad_bicarbonato) && hay(m.alcalinidad_carbonato);
    if (!hay(m.bicarbonato) && tieneAlcalinidades) {
      bicarbonatoEq = (m.alcalinidad_bicarbonato - 2 * m.alcalinidad_carbonato) / 50.0;
    }
    if (!hay(m.carbonato) && tieneAlcalinidades) {
      if (m.alcalinidad_bicarbonato < 2 * m.alcalinidad_carbonato) {
        carbonatoEq = (2 * (m.alcalinidad_bicarbonato - m.alcalinidad_carbonato)) / 50.0;
      } else {
        carbonatoEq = (2 * m.alcalinidad_carbonato) / 50.0;
      }
    }

    let tdsLab = 0.0;
    if (hay(m.residuo_seco) && hay(m.bicarbonato) && hay(m.carbonato)) {
      tdsLab = m.residuo_seco + 0.5 * (m.bicarbonato + m.carbonato);
    }
    const tdsCalc = sumaDisponibles(
      m.cloruro, m.sulfato, m.carbonato, m.bicarbonato, m.calcio,
      m.magnesio, m.sodio, m.potasio, m.nitrato, m.silice
    );

    const total = sumaCationes + sumaAniones;
    const dif = Math.abs(sumaCationes - sumaAniones);
    const controles = {
      PC1: total !== 0 ? (dif / total) * 200 : null,
      PC2: total !== 0 ? (dif / total) * 100 : null,
      PC3: hay(m.conductividad) && total !== 0 ? m.conductividad / ((sumaAniones + sumaCationes) / 2) : null,
      PC4: hay(m.conductividad) && hay(m.residuo_seco) && m.residuo_seco !== 0 ? m.conductividad / m.residuo_seco : null,
      PC5: tdsLab !== 0 ? tdsCalc / tdsLab : null,
    };

    let puntos = 0;
    const { PC1: pc1, PC2: pc2, PC3: pc3, PC4: pc4, PC5: pc5 } = controles;
    if (hay(m.conductividad)) {
      const limites = [[2000, Infinity, 4], [500, 2000, 8], [200, 500, 10], [50, 200, 30]];
      for (const [min, max, lim] of limites) {
        if (min < m.conductividad && m.conductividad <= max && hay(pc1) && pc1 <= lim) {
          puntos += 1;
          break;
        }
      }
    }
    if (hay(pc2) && pc2 <= 5) puntos += 1;
    if (hay(pc3) && pc3 >= 90 && pc3 <= 110) puntos += 1;
    if (hay(pc4) && pc4 >= 1.3 && pc4 <= 1.8) puntos += 1;
    if (hay(pc5) && pc5 >= 0.95 && pc5 <= 1.05) puntos += 1;

    const calidad = { 5: "O", 4: "MB", 3: "B", 2: "S", 1: "S", 0: "NS" }[puntos];
    const [relaciones, relacionesMostradas] = calcularRelaciones(m, bicarbonatoEq, carbonatoEq, sumaAniones);
    const procesos = contarProcesos(relaciones, relacionesMostradas);
    const puntajes = calcularPuntajes(m, procesos);

    return {
      suma_cationes: sumaCationes,
      suma_aniones: sumaAniones,
      solidos_disueltos_laboratorio: tdsLab,
      solidos_disueltos_calculados: tdsCalc,
      controles,
      puntaje_consistencia: puntos,
      calidad_analitica: calidad,
      relaciones,
      relaciones_mostradas: relacionesMostradas,
      conteos_procesos: procesos,
      puntajes_procesos: puntajes,
    };
  }

  // ---------------------------------------------------------------
  // Informe de texto (reports.py)
  // ---------------------------------------------------------------

  const RELACIONES = [
    ["R1", "Ca/Mg"], ["R2", "Na/Cl"], ["R3", "Ca/Na"], ["R4", "Ca/SO4"],
    ["R5", "Cl-(Na+K)/Cl"], ["R6", "SiO2/HCO3"], ["R7", "SiO2/Na+K-Cl"],
    ["R8", "Na+K-Cl/Na+K-Cl+Ca"], ["R9", "Sr/Ca"], ["R10", "HCO3/SA"],
  ];

  const PROCESOS = [
    ["P1", "Disolución de halita"],
    ["P2", "Disolución de yeso"],
    ["P3", "Disolución de calizas"],
    ["P4", "Meteorización de rocas básicas"],
    ["P5", "Meteorización de rocas ácidas"],
    ["P6", "Hidrólisis de plagioclasas intermedias y/o vitroclastos"],
    ["P7", "Intercambio catiónico con liberación de Na"],
    ["P8", "Intercambio catiónico con adsorción de Na"],
  ];

  const DATOS = [
    ["Residuo seco (105-110 C)", "residuo_seco"],
    ["Conductividad eléctrica (microS/cm a 25 C)", "conductividad"],
    ["pH (-)", "ph"],
    ["Alcalinidad de carbonato (mg/L de CaCO3)", "alcalinidad_carbonato"],
    ["Alcalinidad de bicarbonato (mg/L de CaCO3)", "alcalinidad_bicarbonato"],
    ["Cloruro", "cloruro"], ["Sulfato", "sulfato"], ["Carbonato", "carbonato"],
    ["Bicarbonato", "bicarbonato"], ["Calcio", "calcio"], ["Magnesio", "magnesio"],
    ["Sodio", "sodio"], ["Potasio", "potasio"], ["Nitrato", "nitrato"],
    ["Sílice", "silice"], ["Estroncio", "estroncio"],
  ];

  /** ¿Lleva la marca IPNC (Incertidumbre por Procesos No Considerados)? */
  function marcaIPNC(clave, m) {
    return (
      (clave === "P4" && m.hidrolisis_silice_biogenica === 1) ||
      (clave === "P6" && (m.hidrolisis_silice_biogenica === 1 || m.precipitacion_calcita === 1)) ||
      (clave === "P7" && m.precipitacion_calcita === 1)
    );
  }

  const SEP1 = "__________________________________________";
  const SEP2 = "________________________________________________";

  function generarReporte(m, res) {
    const l = [
      SEP1, "RESULTADOS", SEP1,
      "Identificación de la muestra: " + m.identificacion,
      "Calidad analítica (*): " + res.calidad_analitica,
      "(*) O=Óptima, MB=Muy Buena, B=Buena, S=Satisfactoria, NS=No Satisfactoria",
      "",
      "Datos ingresados (None indica que no se ingresó el dato)",
    ];
    DATOS.forEach(([etq, campo]) => l.push(etq + ": " + pyStr(m[campo])));
    l.push(
      "Precipitación de calcita: " + pyStr(m.precipitacion_calcita).replace(/\.0$/, ""),
      "Hidrólisis de sílice biogénica: " + pyStr(m.hidrolisis_silice_biogenica).replace(/\.0$/, ""),
      "",
      "Valores de las relaciones iónicas"
    );
    RELACIONES.forEach(([k, etq]) => {
      const v = res.relaciones_mostradas[k];
      l.push(etq + ": " + (v !== null ? pyFixed(v, 2) : "No se calculó por falta de datos ingresados"));
    });
    l.push("", "Puntajes de los procesos evaluados");
    PROCESOS.forEach(([k, etq]) => {
      l.push(etq + ": " + pyFixed(res.puntajes_procesos[k], 2) + (marcaIPNC(k, m) ? " IPNC" : ""));
    });
    l.push("", "(*) IPNC = Incertidumbre por Procesos No Considerados", SEP2);
    return l.join("\n");
  }

  const ENCABEZADO_ARCHIVO = "Programa MARI (*)\n\n";

  const REFERENCIA_ARCHIVO =
    "\n(*) Mariño, E. E. y Willging, P. A. (2024). Desarrollo de una " +
    "herramienta para la interpretación de relaciones hidroquímicas.\n" +
    "En: Martínez, D. y Mariño, E. (ed.). Aguas subterráneas: Retos para " +
    "una gestión sostenible. EdUNLPam, Tomo II: 140-147.\n" +
    "Consultas: emarinio@exactas.unlpam.edu.ar\n";

  /** Texto que se agrega al archivo por cada muestra guardada. */
  function bloqueParaArchivo(m, res, esNuevoArchivo) {
    return (esNuevoArchivo ? ENCABEZADO_ARCHIVO : "") + "\n\n" + generarReporte(m, res) + "\n";
  }

  const api = {
    pyFixed, pyRound, pyStr, crearMuestra, muestraDesdeEntradas, calcular,
    generarReporte, bloqueParaArchivo, marcaIPNC, RELACIONES, PROCESOS, DATOS,
    REFERENCIA_ARCHIVO,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Calculos = api;
})(typeof window !== "undefined" ? window : globalThis);
