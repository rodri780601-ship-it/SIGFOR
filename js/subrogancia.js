/* =====================================================================
   SIGPM · Subrogancia de jefe analista, jefe provincial y secretaría técnica
   El titular designa un subrogante y un período. Mientras está vigente, el
   subrogante puede «actuar como» el titular (rol y bandeja del cargo, marcado
   con «(S)»). Al terminar el período o si el titular la revoca, pierde esos
   privilegios de inmediato y vuelve a su propio perfil.
   ===================================================================== */
const ROLES_SUBROGABLES = ['JA', 'JP', 'ST'];
const SUBROGA_KEY = 'sigpm.subroga.v1';
let USUARIO_BASE = null; // quien inició sesión; USUARIO es su identidad efectiva (propia o de subrogante)

const subrogancias = () => DB.subrogancias || (DB.subrogancias = []);
const subVigente = (s, hoy = hoyISO()) => !s.revocada && s.desde <= hoy && hoy <= s.hasta;
const subProgramada = (s, hoy = hoyISO()) => !s.revocada && s.desde > hoy;
const subActivaOProgramada = s => subVigente(s) || subProgramada(s);
function estadoSub(s) {
  if (s.revocada) return { nombre: 'Revocada', color: 'bad' };
  if (subVigente(s)) return { nombre: 'Vigente', color: 'ok' };
  if (subProgramada(s)) return { nombre: 'Programada', color: 'info' };
  return { nombre: 'Terminada', color: 'neutral' };
}
const subroganciasDe = titularId => subrogancias().filter(s => s.titularId === titularId).sort((a, b) => b.desde.localeCompare(a.desde));
const subroganciasComoSubrogante = id => subrogancias().filter(s => s.subroganteId === id && subActivaOProgramada(s)).sort((a, b) => a.desde.localeCompare(b.desde));
const puedeActivarSubrogancia = () => !!USUARIO && !USUARIO.subrogaA && ROLES_SUBROGABLES.includes(USUARIO.rol);
/* Posibles subrogantes: funcionarios de la misma oficina, sin usuarios externos */
const candidatosSubrogancia = titular => USUARIOS.filter(u => u.id !== titular.id && !['PR', 'CO'].includes(u.rol) && u.oficina === titular.oficina);
const rolSub = r => `${ROLES[r]} (S)`;

/* ---------- Reglas ---------- */
function activarSubrogancia(subroganteId, desde, hasta) {
  const t = USUARIO, hoy = hoyISO();
  if (!puedeActivarSubrogancia()) throw new Error('Su perfil no puede designar subrogante.');
  if (!candidatosSubrogancia(t).some(u => u.id === subroganteId)) throw new Error('Seleccione un subrogante de la lista.');
  if (!desde || !hasta) throw new Error('Indique el período en el calendario.');
  if (desde < hoy) throw new Error('El período no puede comenzar antes de hoy.');
  if (hasta < desde) throw new Error('La fecha de término debe ser igual o posterior a la de inicio.');
  const choque = subroganciasDe(t.id).find(s => subActivaOProgramada(s) && s.desde <= hasta && desde <= s.hasta);
  if (choque) throw new Error(`Ya tiene una subrogancia del ${fmtFecha(choque.desde)} al ${fmtFecha(choque.hasta)}. Revóquela antes de designar otra.`);
  DB.seq.sub = (DB.seq.sub || 0) + 1;
  const s = { id: `SUB-${DB.seq.sub}`, titularId: t.id, rol: t.rol, subroganteId, desde, hasta, creada: new Date().toISOString(), revocada: null, revocadaPor: null };
  subrogancias().push(s); guardar();
  return s;
}
function revocarSubrogancia(s) {
  if (!s || !USUARIO_BASE || USUARIO_BASE.id !== s.titularId || s.revocada || !subActivaOProgramada(s)) return false;
  s.revocada = new Date().toISOString(); s.revocadaPor = USUARIO_BASE.id; guardar();
  return true;
}

/* ---------- Identidad efectiva ---------- */
function identidadSubrogante(s) {
  const t = usuario(s.titularId);
  return { ...USUARIO_BASE, rol: s.rol, oficina: t.oficina, subrogaA: t.id, subrogancia: s.id };
}
function iniciarIdentidad() { // se llama al iniciar sesión: restaura el modo subrogante si sigue vigente
  USUARIO_BASE = USUARIO;
  let g = null; try { g = JSON.parse(localStorage.getItem(SUBROGA_KEY) || 'null'); } catch (e) { /* */ }
  const s = g && g.usuario === USUARIO_BASE.id && subrogancias().find(x => x.id === g.sub);
  if (s && s.subroganteId === USUARIO_BASE.id && subVigente(s)) USUARIO = identidadSubrogante(s);
  else limpiarModoSubrogante();
}
function limpiarModoSubrogante() { try { localStorage.removeItem(SUBROGA_KEY); } catch (e) { /* */ } }
function actuarComoSubrogante(s) {
  if (!s || !USUARIO_BASE || s.subroganteId !== USUARIO_BASE.id || !subVigente(s)) return false;
  USUARIO = identidadSubrogante(s);
  try { localStorage.setItem(SUBROGA_KEY, JSON.stringify({ usuario: USUARIO_BASE.id, sub: s.id })); } catch (e) { /* */ }
  return true;
}
function volverAMiPerfil() { if (USUARIO_BASE) USUARIO = USUARIO_BASE; limpiarModoSubrogante(); }
/* Si el período terminó o el titular revocó, el subrogante pierde los privilegios en ese momento */
function verificarSubrogancia() {
  if (!USUARIO || !USUARIO.subrogaA) return false;
  const s = subrogancias().find(x => x.id === USUARIO.subrogancia);
  if (s && subVigente(s)) return false;
  const t = usuario(USUARIO.subrogaA);
  volverAMiPerfil();
  toast(`${s && s.revocada ? `${t.nombre} revocó la subrogancia` : 'Terminó el período de subrogancia'}: ya no tiene los privilegios de ${ROLES[s ? s.rol : t.rol]}.`, 'warn');
  return true;
}
setInterval(() => { if (typeof DB !== 'undefined' && DB && verificarSubrogancia()) { pintarUsuario(); route(); } }, 60000);

/* ---------- Panel en «Mi bandeja» ---------- */
function panelSubroganciaHTML() {
  if (!USUARIO || !USUARIO_BASE || ['PR', 'CO'].includes(USUARIO_BASE.rol)) return '';
  const partes = [];
  if (USUARIO.subrogaA) {
    const s = subrogancias().find(x => x.id === USUARIO.subrogancia);
    partes.push(`<div class="sub-fila sub-activa"><div>Actúa como <b>${esc(rolSub(USUARIO.rol))}</b>, subrogando a <b>${esc(usuario(USUARIO.subrogaA).nombre)}</b> hasta el <b>${fmtFecha(s.hasta)}</b>.
      <div class="small">Al terminar el período pierde estos privilegios y vuelve a su perfil.</div></div>
      <button class="btn sm ghost" type="button" id="sub-volver">Volver a mi perfil (${esc(ROLES[USUARIO_BASE.rol])})</button></div>`);
  } else {
    subroganciasComoSubrogante(USUARIO_BASE.id).forEach(s => partes.push(`<div class="sub-fila"><div><b>${esc(usuario(s.titularId).nombre)}</b> lo designó subrogante de <b>${esc(ROLES[s.rol])}</b> del ${fmtFecha(s.desde)} al ${fmtFecha(s.hasta)}.</div>
      ${subVigente(s) ? `<button class="btn sm" type="button" data-sub-actuar="${s.id}">Actuar como ${esc(rolSub(s.rol))}</button>` : `<span class="chip info">Desde el ${fmtFecha(s.desde)}</span>`}</div>`));
    if (ROLES_SUBROGABLES.includes(USUARIO.rol)) {
      const act = subroganciasDe(USUARIO.id).filter(subActivaOProgramada);
      const hist = subroganciasDe(USUARIO.id).filter(s => !subActivaOProgramada(s)).slice(0, 5);
      partes.push(`<div class="sub-fila"><div>${act.length ? act.map(s => `Subrogancia <span class="chip ${estadoSub(s).color}">${estadoSub(s).nombre}</span> · subrogante <b>${esc(usuario(s.subroganteId).nombre)}</b> del ${fmtFecha(s.desde)} al ${fmtFecha(s.hasta)}`).join('<br>') : 'No tiene subrogante designado.'}
          ${hist.length ? `<details class="small"><summary>Subrogancias anteriores</summary><ul class="list">${hist.map(s => `<li>${esc(usuario(s.subroganteId).nombre)} · ${fmtFecha(s.desde)} al ${fmtFecha(s.hasta)} · ${estadoSub(s).nombre}${s.revocada ? ` el ${fechaLocal(s.revocada)}` : ''}</li>`).join('')}</ul></details>` : ''}</div>
        <div class="row-btns wrap">${act.map(s => `<button class="btn sm ghost danger" type="button" data-sub-revocar="${s.id}">Revocar subrogancia</button>`).join('')}
          ${act.length ? '' : '<button class="btn sm" type="button" id="sub-activar">Activar subrogancia</button>'}</div></div>`);
    }
  }
  return partes.length ? `<section class="sec-box sec-sub" aria-label="Subrogancia"><h2>🔁 Subrogancia</h2>${partes.join('')}</section>` : '';
}
function insertarPanelSubrogancia(main) {
  const h = panelSubroganciaHTML(); if (!h) return;
  main.insertAdjacentHTML('afterbegin', h);
  const on = (sel, fn) => $$(sel, main).forEach(b => b.addEventListener('click', () => fn(b)));
  on('#sub-activar', () => dialogoSubrogancia());
  on('#sub-volver', () => { volverAMiPerfil(); toast(`De vuelta en su perfil de ${ROLES[USUARIO.rol]}`, 'ok'); pintarUsuario(); route(); });
  on('[data-sub-actuar]', b => { if (actuarComoSubrogante(subrogancias().find(s => s.id === b.dataset.subActuar))) { toast(`Ahora actúa como ${rolSub(USUARIO.rol)}`, 'ok'); pintarUsuario(); route(); } });
  on('[data-sub-revocar]', async b => {
    const s = subrogancias().find(x => x.id === b.dataset.subRevocar);
    const ok = await modal({ titulo: 'Revocar subrogancia', html: `<p>${esc(usuario(s.subroganteId).nombre)} dejará de subrogarlo ${subVigente(s) ? '<b>de inmediato</b> y perderá los privilegios del cargo' : 'y la subrogancia programada no comenzará'}.</p>`,
      botones: [{ txt: 'Cancelar' }, { txt: 'Revocar subrogancia', valor: true, cls: 'danger' }] });
    if (ok && revocarSubrogancia(s)) { toast('Subrogancia revocada', 'ok'); route(); }
  });
}

/* ---------- Ventana: subrogante y calendario ---------- */
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function calendarioHTML(mes, desde, hasta) { // mes: 'YYYY-MM'
  const [y, m] = mes.split('-').map(Number), hoy = hoyISO();
  const primero = new Date(y, m - 1, 1), dias = new Date(y, m, 0).getDate();
  const vacios = (primero.getDay() + 6) % 7; // semana desde el lunes
  let celdas = '';
  for (let i = 0; i < vacios; i++) celdas += '<span></span>';
  for (let d = 1; d <= dias; d++) {
    const iso = `${y}-${pad(m)}-${pad(d)}`, f = fechaDe(iso);
    const cls = [iso < hoy ? 'pasado' : '', !esHabil(f) ? 'inhabil' : '', iso === hoy ? 'hoy' : '',
      desde && hasta && iso > desde && iso < hasta ? 'rango' : '', iso === desde ? 'ini' : '', iso === hasta ? 'fin' : ''].filter(Boolean).join(' ');
    celdas += `<button type="button" class="cal-d ${cls}" data-dia="${iso}" ${iso < hoy ? 'disabled' : ''} aria-label="${d} de ${MESES[m - 1]}"${iso === desde || iso === hasta ? ' aria-pressed="true"' : ''}>${d}</button>`;
  }
  return `<div class="cal-nav"><button type="button" class="btn sm ghost" data-mes="-1" aria-label="Mes anterior">‹</button><b>${MESES[m - 1]} ${y}</b><button type="button" class="btn sm ghost" data-mes="1" aria-label="Mes siguiente">›</button></div>
    <div class="cal-grid">${['lu', 'ma', 'mi', 'ju', 'vi', 'sá', 'do'].map(x => `<span class="cal-h">${x}</span>`).join('')}${celdas}</div>`;
}
async function dialogoSubrogancia() {
  if (!puedeActivarSubrogancia()) return;
  const cand = candidatosSubrogancia(USUARIO), hoy = hoyISO();
  let desde = '', hasta = '', mes = hoy.slice(0, 7);
  const r = modal({ titulo: `Activar subrogancia · ${ROLES[USUARIO.rol]}`, ancho: 640, html: `
    <p class="hint">El subrogante tendrá los privilegios de ${esc(ROLES[USUARIO.rol])} solo durante el período indicado. Usted puede revocarla cuando quiera.</p>
    <div class="sub-dlg"><fieldset class="sub-cands"><legend>Subrogante</legend>
      ${cand.map((u, i) => `<label class="chk"><input type="radio" name="sub-u" value="${u.id}" ${i ? '' : 'checked'}> <span><b>${esc(u.nombre)}</b><br><span class="muted small">${esc(ROLES[u.rol])}</span></span></label>`).join('') || '<p class="muted">No hay funcionarios de su oficina para designar.</p>'}</fieldset>
      <div><div class="sub-leyenda small muted">Haga clic en el día de inicio y luego en el de término.</div><div id="sub-cal" class="cal"></div>
        <div class="fgrid mt"><label>Desde<input type="date" id="sub-desde" min="${hoy}"></label><label>Hasta (inclusive)<input type="date" id="sub-hasta" min="${hoy}"></label></div>
        <p class="small" id="sub-resumen"></p></div></div>
    <p class="login-err" id="sub-err" role="alert"></p>`,
    botones: [{ txt: 'Cancelar' }, { txt: 'Activar subrogancia',
      validar: bg => { try { const u = $('input[name="sub-u"]:checked', bg); if (!u) throw new Error('Seleccione al subrogante.'); validarPeriodo(); return true; } catch (e) { $('#sub-err', bg).textContent = e.message; return false; } },
      valor: bg => ({ sub: $('input[name="sub-u"]:checked', bg).value, desde, hasta }) }] });
  const bg = $$('.modal-bg').pop();
  const validarPeriodo = () => {
    if (!desde || !hasta) throw new Error('Indique el período en el calendario.');
    if (desde < hoy) throw new Error('El período no puede comenzar antes de hoy.');
    if (hasta < desde) throw new Error('La fecha de término debe ser igual o posterior a la de inicio.');
  };
  const pintar = () => {
    $('#sub-cal', bg).innerHTML = calendarioHTML(mes, desde, hasta);
    $('#sub-desde', bg).value = desde; $('#sub-hasta', bg).value = hasta; $('#sub-hasta', bg).min = desde || hoy;
    const n = desde && hasta && hasta >= desde ? corridosEntre(desde, hasta) + 1 : 0;
    $('#sub-resumen', bg).innerHTML = n ? `Del <b>${fmtFecha(desde)}</b> al <b>${fmtFecha(hasta)}</b>: ${n} día(s) corrido(s), ${habilesEntre(sumarDias(desde, -1), hasta)} hábil(es).` : desde ? 'Falta la fecha de término.' : 'Elija el día de inicio.';
    $$('[data-dia]', bg).forEach(b => b.addEventListener('click', () => {
      const d = b.dataset.dia;
      if (!desde || hasta || d < desde) { desde = d; hasta = ''; } else hasta = d;
      $('#sub-err', bg).textContent = ''; pintar();
    }));
    $$('[data-mes]', bg).forEach(b => b.addEventListener('click', () => { const [y, m] = mes.split('-').map(Number); const f = new Date(y, m - 1 + +b.dataset.mes, 1); mes = `${f.getFullYear()}-${pad(f.getMonth() + 1)}`; pintar(); }));
  };
  $('#sub-desde', bg).addEventListener('change', e => { desde = e.target.value; if (hasta && hasta < desde) hasta = ''; if (desde) mes = desde.slice(0, 7); pintar(); });
  $('#sub-hasta', bg).addEventListener('change', e => { hasta = e.target.value; if (hasta) mes = hasta.slice(0, 7); pintar(); });
  pintar();
  const v = await r;
  if (!v) return;
  try {
    const s = activarSubrogancia(v.sub, v.desde, v.hasta);
    toast(`${usuario(s.subroganteId).nombre} lo subrogará del ${fmtFecha(s.desde)} al ${fmtFecha(s.hasta)}`, 'ok');
  } catch (e) { toast(e.message, 'error'); }
  route();
}
