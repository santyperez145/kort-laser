/**
 * Mandar el presupuesto sin salir del sistema.
 *
 * Hoy se genera el PDF, se abre WhatsApp, se busca al cliente, se escribe el
 * mensaje y se adjunta el archivo. Son cinco minutos por presupuesto y varios
 * presupuestos por día.
 *
 * Este módulo arma el mensaje y el enlace. El archivo lo adjunta la persona:
 * ni WhatsApp Web ni `mailto:` aceptan adjuntos por URL, y no hay forma de
 * evitarlo sin exponer la máquina del taller a internet, que no es algo que
 * este sistema vaya a hacer.
 *
 * Sin dependencias, como todo `src/core/`.
 */

/* ── Teléfonos argentinos ───────────────────────────────────────────────── */

/**
 * Normaliza un teléfono argentino al formato que espera WhatsApp.
 *
 * Es la parte que parece trivial y no lo es. Un celular argentino se marca
 * `0380 15 4123456` dentro del país, pero WhatsApp lo quiere como
 * `5493804123456`: **sin el 0 de larga distancia, sin el 15, y con un 9
 * después del 54**. Con el 15 puesto el enlace abre un chat con un número que
 * no existe y el mensaje se pierde sin que nadie se entere — que es peor que
 * fallar, porque uno cree que lo mandó.
 *
 * @param {string} tel como lo escribió quien cargó el cliente
 * @param {string} [paisPorDefecto] código de país sin +, por si el número
 *   viene sin prefijo internacional
 * @returns {string|null} sólo dígitos, listo para wa.me; null si no sirve
 */
export function telefonoWhatsApp(tel, paisPorDefecto = '54') {
  if (!tel) return null;
  let d = String(tel).replace(/[^\d+]/g, '');
  const internacional = d.startsWith('+');
  d = d.replace(/\+/g, '');
  if (!d) return null;

  // Ya viene con código de país explícito
  if (internacional || d.startsWith('00')) {
    d = d.replace(/^00/, '');
    return d.startsWith('54') ? normalizarArgentino(d.slice(2)) : d;
  }
  if (paisPorDefecto === '54' && d.startsWith('54') && d.length > 10) {
    return normalizarArgentino(d.slice(2));
  }
  if (paisPorDefecto !== '54') return paisPorDefecto + d.replace(/^0/, '');

  return normalizarArgentino(d);
}

/**
 * Toma el número SIN código de país y devuelve `549` + área + abonado.
 *
 * El 0 inicial es el prefijo de larga distancia y el 15 el de celular: los dos
 * son de marcación interna y ninguno viaja en el número internacional. El 9
 * que va después del 54 es lo que le dice a la red que es un móvil.
 */
function normalizarArgentino(d) {
  let n = d.replace(/^0/, '');

  // El 9 puede venir ya puesto (54 9 380...). Se saca para no duplicarlo.
  if (n.startsWith('9') && n.length >= 11) n = n.slice(1);

  /* El 15 va después del código de área, que en Argentina tiene 2, 3 o 4
     dígitos. Se prueba en ese orden porque un área de 4 dígitos (2954, por
     ejemplo) empieza con un dígito que también podría leerse como área de 2.
     Sólo se saca si lo que queda tiene largo de abonado válido. */
  for (const largoArea of [2, 3, 4]) {
    if (n.slice(largoArea, largoArea + 2) === '15') {
      const resto = n.slice(largoArea + 2);
      if (resto.length >= 6 && resto.length <= 8) {
        n = n.slice(0, largoArea) + resto;
        break;
      }
    }
  }

  // Un número argentino completo son 10 dígitos (área + abonado)
  if (n.length < 8 || n.length > 11) return null;
  return '549' + n;
}

/* ── Mensajes ───────────────────────────────────────────────────────────── */

const money = (v, sim = '$') =>
  `${sim} ${Number.isFinite(v) ? v.toLocaleString('es-AR', { maximumFractionDigits: 0 }) : '—'}`;

/**
 * Mensaje de presentación del presupuesto.
 *
 * Lleva el total y nada más del cálculo: es la misma regla que el PDF. Ni
 * tiempo de máquina, ni chapas, ni margen. Lo que el cliente necesita para
 * decidir es qué recibe, cuánto sale y hasta cuándo vale.
 */
export function mensajePresupuesto({ presupuesto = {}, cotizacion, config = {}, tipo = 'whatsapp' }) {
  const emp = config.empresa || {};
  const com = config.comercial || {};
  const sim = com.simbolo || '$';
  const r = cotizacion?.resumen;
  const cli = presupuesto.cliente?.nombre;
  const items = cotizacion?.items || [];

  const saludo = cli ? `Hola ${cli.split(' ')[0]}, ¿cómo va?` : 'Hola, ¿cómo va?';
  const l = [saludo, ''];

  l.push(
    `Te paso el presupuesto ${presupuesto.numero ? `N° ${presupuesto.numero}` : ''} de ${emp.nombre || 'KORT'}:`.replace(
      /\s+/g,
      ' '
    )
  );
  l.push('');

  // Hasta tres ítems: más que eso no se lee en un chat, y para eso está el PDF
  for (const it of items.slice(0, 3)) {
    l.push(`• ${it.cantidad} × ${it.nombre} — ${it.material.nombre} ${it.espesor} mm`);
  }
  if (items.length > 3) l.push(`• y ${items.length - 3} ítem${items.length - 3 === 1 ? '' : 's'} más`);
  l.push('');

  if (r) {
    l.push(`*TOTAL: ${money(r.total, sim)}*${com.mostrarIVA ? ' (IVA incluido)' : ' + IVA'}`);
  }
  const validez = com.validezDias ?? 15;
  l.push(`Validez: ${validez} días. Entrega: ${presupuesto.entregaDias ?? 7} días hábiles.`);
  if (presupuesto.condicionPago || com.condicionPagoDefecto) {
    l.push(`Pago: ${presupuesto.condicionPago || com.condicionPagoDefecto}.`);
  }
  l.push('');
  l.push('Te adjunto el detalle en PDF. Cualquier duda me decís.');
  if (emp.nombre) l.push('', emp.nombre);

  const texto = l.join('\n');
  // El asterisco es negrita en WhatsApp y ruido en un mail
  return tipo === 'whatsapp' ? texto : texto.replace(/\*/g, '');
}

/**
 * Enlace a WhatsApp. `wa.me` funciona igual en el celular y en WhatsApp Web,
 * así que sirve tanto desde la compu del mostrador como desde el teléfono.
 *
 * @returns {{url: string, telefono: string|null, aviso: string|null}}
 */
export function enlaceWhatsApp({ telefono, mensaje }) {
  const num = telefonoWhatsApp(telefono);
  const texto = encodeURIComponent(mensaje || '');
  if (!num) {
    /* Sin número válido igual se abre WhatsApp con el mensaje escrito: se
       elige el contacto a mano. Es mejor que no hacer nada, pero hay que
       decirlo, porque si no parece que el sistema eligió el contacto solo. */
    return {
      url: `https://wa.me/?text=${texto}`,
      telefono: null,
      aviso: telefono
        ? `No pude interpretar el teléfono "${telefono}". Se abre WhatsApp con el mensaje listo: elegí el contacto a mano.`
        : 'El cliente no tiene teléfono cargado. Se abre WhatsApp con el mensaje listo: elegí el contacto a mano.',
    };
  }
  return { url: `https://wa.me/${num}?text=${texto}`, telefono: num, aviso: null };
}

/** Enlace `mailto:` con asunto y cuerpo armados. */
export function enlaceMail({ email, mensaje, presupuesto = {}, config = {} }) {
  const emp = config.empresa || {};
  const asunto = `Presupuesto ${presupuesto.numero ? `N° ${presupuesto.numero} ` : ''}— ${emp.nombre || 'KORT'}`.trim();
  const destino = email ? encodeURIComponent(email) : '';
  const url = `mailto:${destino}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(mensaje || '')}`;
  return {
    url,
    email: email || null,
    aviso: email ? null : 'El cliente no tiene mail cargado: se abre el correo con el mensaje y ponés el destinatario.',
  };
}
