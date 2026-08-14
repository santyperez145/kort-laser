/**
 * Importacion de listas de precio de proveedor.
 *
 * El proveedor manda CSV/Excel exportado con encabezados distintos cada vez:
 * "Material", "Descripcion", "$/kg", "Precio kg", etc. Este modulo no intenta
 * adivinar todo; reconoce lo suficiente para actualizar la verdad critica del
 * sistema, que es el precio de compra por kilo.
 */

const n = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);

export function normalizarTexto(v) {
  return String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function numeroProveedor(v) {
  let s = String(v ?? '').trim();
  if (!s) return 0;
  s = s.replace(/\s/g, '').replace(/[$]/g, '');
  const coma = s.lastIndexOf(',');
  const punto = s.lastIndexOf('.');
  if (coma >= 0 && punto >= 0) {
    s = coma > punto ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (coma >= 0) {
    const dec = s.length - coma - 1;
    s = dec === 3 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (punto >= 0) {
    const dec = s.length - punto - 1;
    if (dec === 3) s = s.replace(/\./g, '');
  }
  const out = Number(s.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(out) ? out : 0;
}

function separar(linea, sep) {
  const out = [];
  let actual = '';
  let comillas = false;
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (ch === '"') {
      if (comillas && linea[i + 1] === '"') {
        actual += '"';
        i++;
      } else {
        comillas = !comillas;
      }
    } else if (ch === sep && !comillas) {
      out.push(actual.trim());
      actual = '';
    } else {
      actual += ch;
    }
  }
  out.push(actual.trim());
  return out;
}

export function parsearTablaProveedor(texto) {
  const lineas = String(texto || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lineas.length) return [];
  const muestra = lineas.slice(0, 5).join('\n');
  const sep = [';', ',', '\t'].sort((a, b) => (muestra.split(b).length - muestra.split(a).length))[0];
  return lineas.map((l) => separar(l, sep));
}

function detectarColumnas(filas) {
  const cab = filas[0] || [];
  const h = cab.map(normalizarTexto);
  const buscar = (...pats) => h.findIndex((x) => pats.some((p) => p.test(x)));
  const material = buscar(/^id$/, /codigo/, /sku/, /material/, /descripcion/, /nombre/);
  const precio = buscar(/precio.*kg/, /\$.*kg/, /kg/, /precio/, /valor/, /lista/);
  const tieneCabecera = material >= 0 || precio >= 0 || h.some((x) => /material|precio|kg|codigo/.test(x));
  return {
    material: material >= 0 ? material : 0,
    precio: precio >= 0 ? precio : 1,
    desde: tieneCabecera ? 1 : 0,
  };
}

function indiceMateriales(materiales) {
  const idx = new Map();
  for (const m of materiales || []) {
    idx.set(normalizarTexto(m.id), m);
    idx.set(normalizarTexto(m.nombre), m);
    for (const alias of m.aliases || []) idx.set(normalizarTexto(alias), m);
  }
  return idx;
}

function buscarMaterial(valor, materiales, idx) {
  const key = normalizarTexto(valor);
  if (!key) return null;
  if (idx.has(key)) return idx.get(key);
  return (materiales || []).find((m) => {
    const nombre = normalizarTexto(m.nombre);
    const id = normalizarTexto(m.id);
    return (nombre && (key.includes(nombre) || nombre.includes(key))) || (id && key.includes(id));
  }) || null;
}

export function importarPreciosProveedor(texto, materiales = [], opts = {}) {
  const filas = parsearTablaProveedor(texto);
  const cols = detectarColumnas(filas);
  const idx = indiceMateriales(materiales);
  const cambios = [];
  const ignoradas = [];
  const vistos = new Set();
  const tolerancia = n(opts.toleranciaPct) || 0;

  for (let i = cols.desde; i < filas.length; i++) {
    const fila = filas[i];
    const materialTxt = fila[cols.material];
    const precio = numeroProveedor(fila[cols.precio]);
    const mat = buscarMaterial(materialTxt, materiales, idx);
    if (!mat) {
      ignoradas.push({ fila: i + 1, material: materialTxt || '', motivo: 'material no reconocido' });
      continue;
    }
    if (!(precio > 0)) {
      ignoradas.push({ fila: i + 1, material: materialTxt || mat.nombre, motivo: 'precio vacio o invalido' });
      continue;
    }
    if (vistos.has(mat.id)) {
      ignoradas.push({ fila: i + 1, material: materialTxt || mat.nombre, motivo: 'material repetido en la lista' });
      continue;
    }
    vistos.add(mat.id);
    const anterior = n(mat.precioKg);
    const variacionPct = anterior > 0 ? ((precio - anterior) / anterior) * 100 : 0;
    if (Math.abs(variacionPct) < tolerancia) continue;
    cambios.push({
      id: mat.id,
      nombre: mat.nombre,
      anterior,
      nuevo: precio,
      variacionPct,
      fila: i + 1,
    });
  }

  return {
    cambios,
    ignoradas,
    totalFilas: Math.max(0, filas.length - cols.desde),
    columnas: cols,
  };
}

export function aplicarPreciosProveedor(materiales = [], cambios = []) {
  const porId = new Map((cambios || []).map((c) => [c.id, c.nuevo]));
  return (materiales || []).map((m) => (porId.has(m.id) ? { ...m, precioKg: porId.get(m.id) } : m));
}
