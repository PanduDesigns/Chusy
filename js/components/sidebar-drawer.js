// ============================================================================
// Barra lateral desplegable en pantallas estrechas (v95).
//
// Con la tablet en vertical (≤ 860 px, ver 11-responsive.css) la barra lateral se esconde fuera de la pantalla. El ☰ que la despliega es
// un botón FIJO de index.html (#btn-toggle-sidebar, hermano de #topbar) y por eso lo ve CUALQUIER sección: antes solo lo pintaba la barra
// de los proyectos y, al entrar en Archivo, Métricas, Pedidos… (y como Chusy recuerda la última sección, al volver a abrirlo), no había
// forma de cambiar de sección sin girar la tablet.
//
// Se cierra al elegir algo (cada onSelect… de app.js quita `is-open`), tocando fuera (telón #sidebar-backdrop), con Escape y al girar
// la tablet a horizontal. Sin Firebase.
// ============================================================================

export function setupSidebarDrawer({ sidebarEl, toggleBtn, backdropEl, mediaQuery = "(max-width: 860px)" }) {
  const isOpen = () => sidebarEl.classList.contains("is-open");
  const sync = () => { toggleBtn.setAttribute("aria-expanded", isOpen() ? "true" : "false"); };
  const setOpen = (open) => { sidebarEl.classList.toggle("is-open", open); sync(); };
  const close = () => setOpen(false);

  const onToggle = () => setOpen(!isOpen());
  toggleBtn.addEventListener("click", onToggle);
  if (backdropEl) backdropEl.addEventListener("click", close);
  const onKey = (e) => { if (e.key === "Escape" && isOpen()) close(); };
  document.addEventListener("keydown", onKey);

  let mql = null;
  const onMedia = (e) => { if (!e.matches) close(); }; // al girar a horizontal la barra ya se ve sola: que no vuelva abierta al girar de nuevo
  if (window.matchMedia) {
    mql = window.matchMedia(mediaQuery);
    if (mql.addEventListener) mql.addEventListener("change", onMedia);
  }
  // Las secciones cierran la barra quitando la clase directamente: se mantiene aria-expanded al día.
  const observer = typeof MutationObserver === "function" ? new MutationObserver(sync) : null;
  if (observer) observer.observe(sidebarEl, { attributes: true, attributeFilter: ["class"] });
  sync();

  return {
    open: () => setOpen(true),
    close,
    toggle: () => setOpen(!isOpen()),
    isOpen,
    destroy() {
      toggleBtn.removeEventListener("click", onToggle);
      if (backdropEl) backdropEl.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
      if (mql && mql.removeEventListener) mql.removeEventListener("change", onMedia);
      if (observer) observer.disconnect();
    },
  };
}
