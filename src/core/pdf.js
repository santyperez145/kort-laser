/**
 * KORT - Generador de PDF
 *
 * Escribe PDF 1.4 directo en bytes: texto vectorial con las fuentes base
 * (Helvetica), líneas, rectángulos, colores e imágenes JPEG embebidas.
 * Sin dependencias, funciona igual en Node y en el navegador.
 *
 * Sistema de coordenadas: se trabaja desde ARRIBA hacia abajo (como se lee),
 * la clase hace la conversión al sistema del PDF internamente.
 */

/* ---------- Anchos de las fuentes base (unidades /1000) ------------ */

const W_HELV = {
  32: 278, 33: 278, 34: 355, 35: 556, 36: 556, 37: 889, 38: 667, 39: 191, 40: 333, 41: 333,
  42: 389, 43: 584, 44: 278, 45: 333, 46: 278, 47: 278, 48: 556, 49: 556, 50: 556, 51: 556,
  52: 556, 53: 556, 54: 556, 55: 556, 56: 556, 57: 556, 58: 278, 59: 278, 60: 584, 61: 584,
  62: 584, 63: 556, 64: 1015, 65: 667, 66: 667, 67: 722, 68: 722, 69: 667, 70: 611, 71: 778,
  72: 722, 73: 278, 74: 500, 75: 667, 76: 556, 77: 833, 78: 722, 79: 778, 80: 667, 81: 778,
  82: 722, 83: 667, 84: 611, 85: 722, 86: 667, 87: 944, 88: 667, 89: 667, 90: 611, 91: 278,
  92: 278, 93: 278, 94: 469, 95: 556, 96: 333, 97: 556, 98: 556, 99: 500, 100: 556, 101: 556,
  102: 278, 103: 556, 104: 556, 105: 222, 106: 222, 107: 500, 108: 222, 109: 833, 110: 556,
  111: 556, 112: 556, 113: 556, 114: 333, 115: 500, 116: 278, 117: 556, 118: 500, 119: 722,
  120: 500, 121: 500, 122: 500, 123: 334, 124: 260, 125: 334, 126: 584,
};
const W_HELVB = {
  32: 278, 33: 333, 34: 474, 35: 556, 36: 556, 37: 889, 38: 722, 39: 238, 40: 333, 41: 333,
  42: 389, 43: 584, 44: 278, 45: 333, 46: 278, 47: 278, 48: 556, 49: 556, 50: 556, 51: 556,
  52: 556, 53: 556, 54: 556, 55: 556, 56: 556, 57: 556, 58: 333, 59: 333, 60: 584, 61: 584,
  62: 584, 63: 611, 64: 975, 65: 722, 66: 722, 67: 722, 68: 722, 69: 667, 70: 611, 71: 778,
  72: 722, 73: 278, 74: 556, 75: 722, 76: 611, 77: 833, 78: 722, 79: 778, 80: 667, 81: 778,
  82: 722, 83: 667, 84: 611, 85: 722, 86: 667, 87: 944, 88: 667, 89: 667, 90: 611, 91: 333,
  92: 278, 93: 333, 94: 584, 95: 556, 96: 333, 97: 556, 98: 611, 99: 556, 100: 611, 101: 556,
  102: 333, 103: 611, 104: 611, 105: 278, 106: 278, 107: 556, 108: 278, 109: 889, 110: 611,
  111: 611, 112: 611, 113: 611, 114: 389, 115: 556, 116: 333, 117: 611, 118: 556, 119: 778,
  120: 556, 121: 556, 122: 500, 123: 389, 124: 280, 125: 389, 126: 584,
};

/** Acentuadas y símbolos: se aproximan al ancho de su letra base. */
const EQUIV = {
  192: 65, 193: 65, 194: 65, 195: 65, 196: 65, 197: 65, 199: 67, 200: 69, 201: 69, 202: 69,
  203: 69, 204: 73, 205: 73, 206: 73, 207: 73, 209: 78, 210: 79, 211: 79, 212: 79, 213: 79,
  214: 79, 217: 85, 218: 85, 219: 85, 220: 85, 221: 89, 224: 97, 225: 97, 226: 97, 227: 97,
  228: 97, 229: 97, 231: 99, 232: 101, 233: 101, 234: 101, 235: 101, 236: 105, 237: 105,
  238: 105, 239: 105, 241: 110, 242: 111, 243: 111, 244: 111, 245: 111, 246: 111, 249: 117,
  250: 117, 251: 117, 252: 117, 253: 121, 255: 121, 176: 48, 186: 48, 170: 97, 215: 43,
  247: 43, 161: 33, 191: 63, 8364: 36,
};

function charWidth(code, bold) {
  const T = bold ? W_HELVB : W_HELV;
  if (T[code] != null) return T[code];
  const e = EQUIV[code];
  if (e != null) return T[e] ?? 556;
  return 556;
}

/** Convierte a WinAnsi (Latin-1 + algunos símbolos). */
function toWinAnsi(str) {
  const out = [];
  for (const ch of String(str)) {
    const c = ch.codePointAt(0);
    if (c === 0x20ac) out.push(128);
    else if (c === 0x2018) out.push(145);
    else if (c === 0x2019) out.push(146);
    else if (c === 0x201c) out.push(147);
    else if (c === 0x201d) out.push(148);
    else if (c === 0x2022) out.push(149);
    else if (c === 0x2013) out.push(150);
    else if (c === 0x2014) out.push(151);
    else if (c <= 255) out.push(c);
    else out.push(63); // '?'
  }
  return out;
}

export function anchoTexto(str, size, bold = false) {
  let w = 0;
  for (const c of toWinAnsi(str)) w += charWidth(c, bold);
  return (w * size) / 1000;
}

function escapePdfString(bytes) {
  let s = '';
  for (const b of bytes) {
    if (b === 40 || b === 41 || b === 92) s += '\\' + String.fromCharCode(b);
    else if (b < 32 || b > 126) s += '\\' + b.toString(8).padStart(3, '0');
    else s += String.fromCharCode(b);
  }
  return s;
}

const f2 = (n) => (Math.round(n * 100) / 100).toString();

/* ------------------------------------------------------------------ */

export class PDF {
  /** @param {Object} opts { ancho, alto, margen } en puntos (A4 = 595.28 × 841.89) */
  constructor(opts = {}) {
    this.W = opts.ancho ?? 595.28;
    this.H = opts.alto ?? 841.89;
    this.margen = opts.margen ?? 40;
    this.paginas = [];
    this.imagenes = [];
    this.nuevaPagina();
    this.onNuevaPagina = null;
  }

  nuevaPagina() {
    this.cur = { ops: [], imgs: [] };
    this.paginas.push(this.cur);
    this.y = this.margen;
    return this.cur;
  }

  get anchoUtil() {
    return this.W - 2 * this.margen;
  }

  op(s) {
    this.cur.ops.push(s);
    return this;
  }

  /* ---------------- Primitivas de dibujo ---------------- */

  color(r, g, b, trazo = false) {
    return this.op(`${f2(r / 255)} ${f2(g / 255)} ${f2(b / 255)} ${trazo ? 'RG' : 'rg'}`);
  }

  hex(h, trazo = false) {
    const s = h.replace('#', '');
    return this.color(parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16), trazo);
  }

  rect(x, y, w, h, modo = 'f') {
    return this.op(`${f2(x)} ${f2(this.H - y - h)} ${f2(w)} ${f2(h)} re ${modo}`);
  }

  linea(x1, y1, x2, y2, grosor = 0.7) {
    return this.op(`${f2(grosor)} w ${f2(x1)} ${f2(this.H - y1)} m ${f2(x2)} ${f2(this.H - y2)} l S`);
  }

  /**
   * Texto. @param opts { size, bold, color, align:'left'|'right'|'center', maxWidth }
   */
  texto(x, y, str, opts = {}) {
    const size = opts.size ?? 9;
    const bold = !!opts.bold;
    const font = bold ? '/F2' : '/F1';
    let s = String(str ?? '');
    if (opts.maxWidth) s = this.truncar(s, opts.maxWidth, size, bold);
    let px = x;
    const w = anchoTexto(s, size, bold);
    if (opts.align === 'right') px = x - w;
    else if (opts.align === 'center') px = x - w / 2;
    if (opts.color) this.hex(opts.color);
    this.op(`BT ${font} ${f2(size)} Tf ${f2(px)} ${f2(this.H - y - size * 0.78)} Td (${escapePdfString(toWinAnsi(s))}) Tj ET`);
    return w;
  }

  truncar(str, maxWidth, size, bold) {
    if (anchoTexto(str, size, bold) <= maxWidth) return str;
    let s = str;
    while (s.length > 1 && anchoTexto(s + '...', size, bold) > maxWidth) s = s.slice(0, -1);
    return s + '...';
  }

  /** Divide un texto en líneas que entren en `maxWidth`. */
  ajustar(str, maxWidth, size, bold = false) {
    const palabras = String(str).split(/\s+/);
    const lineas = [];
    let linea = '';
    for (const p of palabras) {
      const prueba = linea ? linea + ' ' + p : p;
      if (anchoTexto(prueba, size, bold) > maxWidth && linea) {
        lineas.push(linea);
        linea = p;
      } else linea = prueba;
    }
    if (linea) lineas.push(linea);
    return lineas;
  }

  parrafo(x, y, str, maxWidth, opts = {}) {
    const size = opts.size ?? 8.5;
    const interlinea = opts.interlinea ?? size * 1.35;
    const lineas = this.ajustar(str, maxWidth, size, opts.bold);
    let yy = y;
    for (const l of lineas) {
      this.texto(x, yy, l, opts);
      yy += interlinea;
    }
    return yy - y;
  }

  /** Rectángulo con esquinas redondeadas (relleno). */
  rectRedondo(x, y, w, h, r, modo = 'f') {
    const Y = this.H - y - h;
    const k = 0.5523 * r;
    const o = [];
    o.push(`${f2(x + r)} ${f2(Y)} m`);
    o.push(`${f2(x + w - r)} ${f2(Y)} l`);
    o.push(`${f2(x + w - r + k)} ${f2(Y)} ${f2(x + w)} ${f2(Y + r - k)} ${f2(x + w)} ${f2(Y + r)} c`);
    o.push(`${f2(x + w)} ${f2(Y + h - r)} l`);
    o.push(`${f2(x + w)} ${f2(Y + h - r + k)} ${f2(x + w - r + k)} ${f2(Y + h)} ${f2(x + w - r)} ${f2(Y + h)} c`);
    o.push(`${f2(x + r)} ${f2(Y + h)} l`);
    o.push(`${f2(x + r - k)} ${f2(Y + h)} ${f2(x)} ${f2(Y + h - r + k)} ${f2(x)} ${f2(Y + h - r)} c`);
    o.push(`${f2(x)} ${f2(Y + r)} l`);
    o.push(`${f2(x)} ${f2(Y + r - k)} ${f2(x + r - k)} ${f2(Y)} ${f2(x + r)} ${f2(Y)} c`);
    o.push(modo);
    return this.op(o.join(' '));
  }

  /**
   * Inserta una imagen JPEG.
   * @param {Uint8Array} bytes  JPEG crudo
   */
  imagenJPEG(bytes, x, y, w, h) {
    const dim = medirJPEG(bytes);
    const idx = this.imagenes.length;
    this.imagenes.push({ bytes, ancho: dim.w, alto: dim.h, gris: dim.componentes === 1 });
    const nombre = `/Im${idx}`;
    this.cur.imgs.push(idx);
    this.op(`q ${f2(w)} 0 0 ${f2(h)} ${f2(x)} ${f2(this.H - y - h)} cm ${nombre} Do Q`);
    return this;
  }

  /** Acepta un dataURL "data:image/jpeg;base64,..." (lo que devuelve un canvas). */
  imagenDataURL(dataURL, x, y, w, h) {
    const b64 = dataURL.split(',')[1];
    return this.imagenJPEG(base64ToBytes(b64), x, y, w, h);
  }

  /* ---------------- Serialización ---------------- */

  save() {
    const objs = [];
    const add = (s) => {
      objs.push(s);
      return objs.length; // número de objeto (1-based)
    };

    const nPaginas = this.paginas.length;
    const idCatalogo = 1;
    const idPages = 2;
    const idF1 = 3;
    const idF2 = 4;

    objs.push(null, null, null, null); // reservados 1..4

    // Imágenes
    const idImg = this.imagenes.map((im) =>
      add(
        `<< /Type /XObject /Subtype /Image /Width ${im.ancho} /Height ${im.alto} ` +
          `/ColorSpace ${im.gris ? '/DeviceGray' : '/DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode ` +
          `/Length ${im.bytes.length} >>\nstream\n BIN${this.imagenes.indexOf(im)} \nendstream`
      )
    );

    // Páginas + contenidos
    const idPaginas = [];
    for (const pg of this.paginas) {
      const contenido = pg.ops.join('\n');
      const idCont = add(`<< /Length ${byteLength(contenido)} >>\nstream\n${contenido}\nendstream`);
      const xobj = pg.imgs.length
        ? `/XObject << ${[...new Set(pg.imgs)].map((i) => `/Im${i} ${idImg[i]} 0 R`).join(' ')} >>`
        : '';
      const idPg = add(
        `<< /Type /Page /Parent ${idPages} 0 R /MediaBox [0 0 ${f2(this.W)} ${f2(this.H)}] ` +
          `/Resources << /Font << /F1 ${idF1} 0 R /F2 ${idF2} 0 R >> ${xobj} >> /Contents ${idCont} 0 R >>`
      );
      idPaginas.push(idPg);
    }

    objs[0] = `<< /Type /Catalog /Pages ${idPages} 0 R >>`;
    objs[1] = `<< /Type /Pages /Kids [${idPaginas.map((i) => `${i} 0 R`).join(' ')}] /Count ${nPaginas} >>`;
    objs[2] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;
    objs[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`;

    // Ensamblado binario
    const chunks = [];
    let pos = 0;
    const push = (data) => {
      const b = typeof data === 'string' ? strToBytes(data) : data;
      chunks.push(b);
      pos += b.length;
    };

    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const offsets = [0];
    for (let i = 0; i < objs.length; i++) {
      offsets.push(pos);
      const cuerpo = objs[i];
      const m = / BIN(\d+) /.exec(cuerpo);
      if (m) {
        const [antes, despues] = cuerpo.split(m[0]);
        push(`${i + 1} 0 obj\n${antes}`);
        push(this.imagenes[Number(m[1])].bytes);
        push(`${despues}\nendobj\n`);
      } else {
        push(`${i + 1} 0 obj\n${cuerpo}\nendobj\n`);
      }
    }
    const xrefPos = pos;
    let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objs.length; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    push(xref);
    push(`trailer\n<< /Size ${objs.length + 1} /Root ${idCatalogo} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

    const total = chunks.reduce((a, c) => a + c.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* Utilidades binarias                                                 */
/* ------------------------------------------------------------------ */

function strToBytes(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}
function byteLength(s) {
  return s.length;
}

export function base64ToBytes(b64) {
  const limpio = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  const tabla = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const len = limpio.replace(/=+$/, '').length;
  const bytes = new Uint8Array((len * 3) >> 2);
  let p = 0;
  let buf = 0;
  let bits = 0;
  for (const ch of limpio) {
    if (ch === '=') break;
    buf = (buf << 6) | tabla.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[p++] = (buf >> bits) & 0xff;
    }
  }
  return bytes.subarray(0, p);
}

/** Lee ancho/alto/componentes de un JPEG desde sus marcadores SOF. */
export function medirJPEG(bytes) {
  let i = 2;
  while (i < bytes.length - 9) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marca = bytes[i + 1];
    if (marca >= 0xc0 && marca <= 0xcf && marca !== 0xc4 && marca !== 0xc8 && marca !== 0xcc) {
      return {
        h: (bytes[i + 5] << 8) | bytes[i + 6],
        w: (bytes[i + 7] << 8) | bytes[i + 8],
        componentes: bytes[i + 9],
      };
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    i += 2 + len;
  }
  return { w: 100, h: 100, componentes: 3 };
}
