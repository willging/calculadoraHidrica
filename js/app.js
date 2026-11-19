(function () {
  "use strict";
  const C = window.Calculos;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // ------------------------------------------------------------
  // Campos del formulario (mismo orden y rótulos que input_cli.py)
  // ------------------------------------------------------------
  const GRUPOS = [
    {
      titulo: "Datos generales",
      ayuda: "Mediciones de laboratorio de la muestra.",
      campos: [
        { id: "residuo_seco", etq: "Residuo seco (105-110 °C)", unidad: "mg/L" },
        { id: "conductividad", etq: "Conductividad eléctrica (25 °C)", unidad: "µS/cm" },
        { id: "ph", etq: "pH", unidad: "–" },
        { id: "alcalinidad_carbonato", etq: "Alcalinidad de carbonato", unidad: "mg/L CaCO₃" },
        { id: "alcalinidad_bicarbonato", etq: "Alcalinidad de bicarbonato", unidad: "mg/L CaCO₃" },
      ],
    },
    {
      titulo: "Iones mayoritarios",
      ayuda: "Concentraciones en mg/L. Si no ingresa carbonato y bicarbonato, se estiman a partir de las alcalinidades.",
      campos: [
        { id: "cloruro", etq: "Cloruro (Cl⁻)", unidad: "mg/L" },
        { id: "sulfato", etq: "Sulfato (SO₄²⁻)", unidad: "mg/L" },
        { id: "carbonato", etq: "Carbonato (CO₃²⁻)", unidad: "mg/L" },
        { id: "bicarbonato", etq: "Bicarbonato (HCO₃⁻)", unidad: "mg/L" },
        { id: "calcio", etq: "Calcio (Ca²⁺)", unidad: "mg/L" },
        { id: "magnesio", etq: "Magnesio (Mg²⁺)", unidad: "mg/L" },
        { id: "sodio", etq: "Sodio (Na⁺)", unidad: "mg/L" },
        { id: "potasio", etq: "Potasio (K⁺)", unidad: "mg/L", nota: "Si queda vacío se toma como 0." },
        { id: "nitrato", etq: "Nitrato (NO₃⁻)", unidad: "mg/L", nota: "Se recomienda ingresarlo: interviene en PC1 y PC2." },
      ],
    },
    {
      titulo: "Datos opcionales",
      ayuda: "Si no los tiene, deje las casillas vacías: se omiten las relaciones que dependen de ellos.",
      campos: [
        { id: "silice", etq: "Sílice (SiO₂)", unidad: "mg/L" },
        { id: "estroncio", etq: "Estroncio (Sr)", unidad: "mg/L" },
      ],
    },
  ];
  const IDS_NUMERICOS = GRUPOS.flatMap((g) => g.campos.map((c) => c.id));
  const ETIQUETA = {};
  GRUPOS.forEach((g) => g.campos.forEach((c) => { ETIQUETA[c.id] = c.etq; }));

  const CALIDAD = { O: "Óptima", MB: "Muy buena", B: "Buena", S: "Satisfactoria", NS: "No satisfactoria" };

  // ------------------------------------------------------------
  // Estado de la sesión
  // ------------------------------------------------------------
  let muestra = null;
  let resultado = null;
  let archivoIniciado = false; // solo para el modo sin Electron
  let bufferArchivo = "";

  // ------------------------------------------------------------
  // Utilidades de interfaz
  // ------------------------------------------------------------
  function el(tag, props = {}, ...hijos) {
    const n = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else n.setAttribute(k, v);
    });
    hijos.forEach((h) => n.append(h));
    return n;
  }

  function mensaje(titulo, texto, alAceptar) {
    const d = $("#dialogo");
    $("#dialogo-titulo").textContent = titulo;
    $("#dialogo-texto").textContent = texto;
    const ok = $("#dialogo-ok");
    ok.onclick = () => { d.close(); if (alAceptar) alAceptar(); };
    if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
    ok.focus();
  }

  let temporizador = null;
  function aviso(texto) {
    const t = $("#toast");
    t.textContent = texto;
    t.hidden = false;
    clearTimeout(temporizador);
    temporizador = setTimeout(() => { t.hidden = true; }, 5000);
  }

  function mostrarVista(nombre) {
    $$(".vista").forEach((v) => { v.hidden = v.id !== "vista-" + nombre; });
    $$(".menu-btn[data-vista]").forEach((b) => b.classList.toggle("activo", b.dataset.vista === nombre));
    if (nombre === "resultados") dibujarResultados();
    $(".contenido").scrollTop = 0;
  }

  function actualizarEstado() {
    $("#estado-texto").textContent = muestra
      ? (muestra.identificacion.trim() || "(sin identificación)")
      : "Sin datos cargados";
  }

  // ------------------------------------------------------------
  // Logo de la Facultad
  // ------------------------------------------------------------
  $$("img[data-logo]").forEach((img) => {
    img.addEventListener("error", () => {
      img.alt = "FCEyN";
    });
    img.src = "assets/logo-fceyn-2.png";
  });

  // ------------------------------------------------------------
  // Formulario
  // ------------------------------------------------------------
  function construirFormulario() {
    const cont = $("#grupos");
    GRUPOS.forEach((g) => {
      const grilla = el("div", { class: "grilla" });
      g.campos.forEach((c) => {
        const campo = el("div", { class: "campo", "data-campo": c.id });
        campo.append(el("label", { for: "f-" + c.id, text: c.etq }));
        const entrada = el("div", { class: "entrada" });
        entrada.append(
          el("input", { type: "text", id: "f-" + c.id, inputmode: "decimal", placeholder: "sin dato", spellcheck: "false" }),
          el("span", { class: "unidad", text: c.unidad })
        );
        campo.append(entrada);
        if (c.nota) campo.append(el("span", { class: "nota", text: c.nota }));
        campo.append(el("span", { class: "error", hidden: "" }));
        grilla.append(campo);
      });
      cont.append(el("div", { class: "hoja" },
        el("h3", { class: "grupo-titulo", text: g.titulo }),
        el("p", { class: "ayuda", text: g.ayuda }),
        grilla));
    });
    $$("#grupos input").forEach((inp) => inp.addEventListener("input", () => limpiarError(inp)));
  }

  function limpiarError(inp) {
    const campo = inp.closest(".campo");
    campo.classList.remove("invalido");
    const e = $(".error", campo);
    e.hidden = true; e.textContent = "";
    inp.removeAttribute("aria-invalid");
  }

  function marcarError(id, texto) {
    const inp = $("#f-" + id);
    const campo = inp.closest(".campo");
    campo.classList.add("invalido");
    inp.setAttribute("aria-invalid", "true");
    const e = $(".error", campo);
    e.textContent = texto; e.hidden = false;
  }

  /** Lee una casilla numérica. Vacía → null. Inválida → lanza texto de error. */
  function leerNumero(texto) {
    let s = texto.trim();
    if (s === "") return null;
    if (/^[+-]?\d*,\d+$|^[+-]?\d+,\d*$/.test(s)) s = s.replace(",", "."); // coma decimal
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) {
      throw new Error("Ingrese un número (use punto decimal) o deje la casilla vacía.");
    }
    const v = parseFloat(s);
    if (!Number.isFinite(v)) throw new Error("El número es demasiado grande.");
    if (v < 0) throw new Error("El valor no puede ser negativo.");
    return v;
  }

  function leerOpcion(id) {
    const v = $("#f-" + id).value;
    return v === "" ? null : Number(v);
  }

  function limpiarFormulario() {
    $("#f-identificacion").value = "";
    IDS_NUMERICOS.forEach((id) => { const i = $("#f-" + id); i.value = ""; limpiarError(i); });
    $("#f-precipitacion_calcita").value = "";
    $("#f-hidrolisis_silice_biogenica").value = "";
    $("#aviso-form").textContent = "";
  }

  function enviarFormulario(ev) {
    ev.preventDefault();
    const entradas = { identificacion: $("#f-identificacion").value };
    let primerError = null;
    IDS_NUMERICOS.forEach((id) => {
      const inp = $("#f-" + id);
      limpiarError(inp);
      try {
        entradas[id] = leerNumero(inp.value);
      } catch (e) {
        marcarError(id, e.message);
        if (!primerError) primerError = inp;
      }
    });
    if (primerError) {
      $("#aviso-form").textContent = "Revise las casillas marcadas en rojo.";
      primerError.focus();
      return;
    }
    $("#aviso-form").textContent = "";
    entradas.precipitacion_calcita = leerOpcion("precipitacion_calcita");
    entradas.hidrolisis_silice_biogenica = leerOpcion("hidrolisis_silice_biogenica");

    muestra = C.muestraDesdeEntradas(entradas);
    resultado = C.calcular(muestra);
    actualizarEstado();
    mostrarVista("resultados");
    aviso("Carga de datos completada. Cálculos realizados.");
  }

  // ------------------------------------------------------------
  // Resultados
  // ------------------------------------------------------------
  function filaRelacion(etq, valor) {
    const tr = el("tr");
    tr.append(el("td", { text: etq }));
    if (valor === null) tr.append(el("td", { class: "sin", text: "No se calculó por falta de datos ingresados" }));
    else tr.append(el("td", { class: "valor", text: C.pyFixed(valor, 2) }));
    return tr;
  }

  function dibujarResultados() {
    const vacio = !(muestra && resultado);
    $("#res-vacio").hidden = !vacio;
    $("#res-contenido").hidden = vacio;
    $("#res-sub").textContent = vacio ? "" : "Muestra: " + (muestra.identificacion.trim() || "(sin identificación)");
    if (vacio) return;

    const q = resultado.calidad_analitica;
    const sigla = $("#res-sigla");
    sigla.textContent = q;
    sigla.className = "calidad-sigla q-" + q;
    $("#res-calidad-texto").textContent = CALIDAD[q];

    const tr = $("#tabla-relaciones"); tr.replaceChildren();
    C.RELACIONES.forEach(([k, etq]) => tr.append(filaRelacion(etq, resultado.relaciones_mostradas[k])));

    const tp = $("#tabla-procesos"); tp.replaceChildren();
    C.PROCESOS.forEach(([k, etq]) => {
      const p = resultado.puntajes_procesos[k];
      const nombre = el("td", { text: etq });
      if (C.marcaIPNC(k, muestra)) nombre.append(el("span", { class: "chip", text: "IPNC" }));
      const barra = el("div", { class: "barra", "aria-hidden": "true" }, el("span"));
      barra.firstChild.style.width = Math.max(0, Math.min(100, p * 10)) + "%";
      nombre.append(barra);
      tp.append(el("tr", {}, nombre, el("td", { class: "valor", text: C.pyFixed(p, 2) })));
    });

    const td = $("#tabla-datos"); td.replaceChildren();
    const fila = (etq, txt) => td.append(el("tr", {}, el("td", { text: etq }),
      txt === null ? el("td", { class: "sin", text: "Sin dato" }) : el("td", { class: "valor", text: txt })));
    C.DATOS.forEach(([etq, campo]) => {
      const v = muestra[campo];
      fila(etq, v === null ? null : C.pyStr(v));
    });
    const sn = (v) => (v === null ? null : v === 1 ? "Sí (1)" : "No (0)");
    fila("Precipitación de calcita", sn(muestra.precipitacion_calcita));
    fila("Hidrólisis de sílice biogénica", sn(muestra.hidrolisis_silice_biogenica));
  }

  // ------------------------------------------------------------
  // Opciones del menú
  // ------------------------------------------------------------
  function accionCalcular() {
    if (!muestra) {
      mensaje("Faltan datos", "Debe ingresar los datos antes de hacer los cálculos.", () => mostrarVista("cargar"));
      return;
    }
    resultado = C.calcular(muestra);
    mostrarVista("resultados");
    aviso("Cálculos completados.");
  }

  function accionGuardar() {
    if (!muestra || !resultado) {
      mensaje("Faltan datos", "Debe ingresar los datos y hacer los cálculos antes de guardar los resultados.", () => mostrarVista("cargar"));
      return;
    }
    const primero = C.bloqueParaArchivo(muestra, resultado, true);
    const siguiente = C.bloqueParaArchivo(muestra, resultado, false);

    // Modo navegador: se descarga el archivo acumulado de la sesión.
    bufferArchivo += archivoIniciado ? siguiente : primero;
    archivoIniciado = true;
    const blob = new Blob([bufferArchivo + C.REFERENCIA_ARCHIVO], { type: "text/plain;charset=utf-8" });
    const a = el("a", { href: URL.createObjectURL(blob), download: "ResultadosMARI24.dat" });
    document.body.append(a); a.click(); a.remove();
    aviso("Resultados guardados en ResultadosMARI24.dat");
  }

  function accionSalir() {
    mensaje("¡Gracias por usar esta calculadora!", "Puede cerrar la pestaña. Si guardó resultados, el archivo se descargó en su carpeta de descargas.", () => mostrarVista("portada"));
  }

  // ------------------------------------------------------------
  // Eventos
  // ------------------------------------------------------------
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-vista], [data-accion]");
    if (!b) return;
    if (b.dataset.vista) mostrarVista(b.dataset.vista);
    else if (b.dataset.accion === "calcular") accionCalcular();
    else if (b.dataset.accion === "guardar") accionGuardar();
    else if (b.dataset.accion === "salir") accionSalir();
  });
  $("#formulario").addEventListener("submit", enviarFormulario);
  $("#btn-limpiar").addEventListener("click", limpiarFormulario);

  construirFormulario();
  actualizarEstado();
  mostrarVista("portada");

  // Para pruebas automáticas
  window.__hidrica = { leerNumero };
})();
