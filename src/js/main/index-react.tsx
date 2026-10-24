import React from "react";
import ReactDOM from "react-dom/client";
import { initBolt } from "../lib/utils/bolt";
import "../index.scss";
import { App } from "../app/App";
import type { Backend } from "../app/backend";

// Outside Premiere/AE (`npm run dev` in a browser) there's no Node or host
// app, so preview the UI against a simulated backend instead.
const createBackend = async (): Promise<Backend> => {
  if (window.cep) {
    initBolt();
    const { createCepBackend } = await import("./cep-backend");
    return createCepBackend();
  }
  const { createMockBackend } = await import("../app/mock-backend");
  return createMockBackend();
};

createBackend().then((backend) => {
  ReactDOM.createRoot(document.getElementById("app") as HTMLElement).render(
    <React.StrictMode>
      <App backend={backend} />
    </React.StrictMode>
  );
});
