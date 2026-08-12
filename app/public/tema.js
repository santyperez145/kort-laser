/**
 * Aplica el tema guardado ANTES del primer pintado.
 *
 * Va en un archivo aparte y no inline por la política de seguridad: con
 * `script-src 'self'` no hace falta ni hash ni nonce, y no hay forma de que
 * un hash mal calculado deje la página sin arrancar.
 *
 * Sin esto, la pantalla del taller destella en blanco al abrir, que en un
 * galpón a media luz molesta bastante.
 */
(function () {
  try {
    var t = localStorage.getItem('kort-tema') || 'oscuro';
    document.documentElement.classList.toggle('dark', t === 'oscuro');
  } catch (e) {
    /* navegador con el almacenamiento bloqueado: queda el tema por defecto */
  }
})();
