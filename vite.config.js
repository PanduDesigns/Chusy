// ============================================================================
// Vite — solo empaqueta; la app sigue siendo Vanilla JS sin frameworks.
//
// Tres cosas que NO son las de por defecto, y por qué:
//
// 1) Firebase por CDN. Los módulos importan el SDK desde
//    https://www.gstatic.com/firebasejs/... (no está en node_modules). Se
//    declara externo: Vite deja esos `import` tal cual en el JS compilado y
//    el navegador los descarga en tiempo de ejecución.
//
// 2) `assets/` íntegro y SIN hash. La app descarga/enlaza esos archivos por su
//    ruta (`assets/gantt-template-martech.xlsm`, `assets/drive/*`,
//    `assets/outlook/*`, `assets/abrir-ubicacion/*`, iconos…) y la gente
//    también los reparte tal cual. Por eso:
//      · `build.assetsDir = "bundle"`: lo que Vite genera con hash (JS y CSS)
//        va a dist/bundle/ y deja dist/assets/ libre — con el valor por
//        defecto ("assets") se mezclarían.
//      · el plugin `copyAssetsVerbatim` copia assets/ a dist/assets/ sin tocar
//        nada (mismos nombres, mismos bytes).
//      · en index.html, las etiquetas que apuntan a assets/ llevan
//        `vite-ignore` (Vite no las reescribe y quita el atributo al compilar).
//      · en desarrollo (`vite`) no hace falta nada: Vite sirve la raíz del
//        proyecto, así que /assets/... funciona igual que en un servidor
//        estático.
//
// 3) `base: "./"`: rutas relativas, para que dist/ funcione igual en la raíz de
//    un dominio que en una subcarpeta (GitHub Pages: usuario.github.io/repo/).
// ============================================================================
import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";

function copyAssetsVerbatim() {
  let outDir = "dist";
  let root = process.cwd();
  return {
    name: "chusy:copy-assets-verbatim",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
      root = config.root;
    },
    closeBundle() {
      const from = path.join(root, "assets");
      if (!fs.existsSync(from)) return;
      fs.cpSync(from, path.join(outDir, "assets"), { recursive: true });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [copyAssetsVerbatim()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsDir: "bundle",
    assetsInlineLimit: 0,
    rollupOptions: {
      external: [/^https?:\/\//],
    },
  },
});
