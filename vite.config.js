import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { host: true }, // host:true zodat je met je telefoon op hetzelfde wifi kan testen
});
