import { defineConfig } from 'vite';

// base: './' — относительные пути, поэтому сборка работает на GitHub Pages
// при любом имени репозитория (https://<user>.github.io/<repo>/).
export default defineConfig({
  base: './',
});
