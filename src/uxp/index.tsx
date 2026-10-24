import React from "react";
import ReactDOM from "react-dom/client";
import "../js/index.scss";
import { App } from "../js/app/App";
import { createUxpBackend } from "./uxp-backend";

ReactDOM.createRoot(document.getElementById("app") as HTMLElement).render(
  <React.StrictMode>
    <App backend={createUxpBackend()} />
  </React.StrictMode>
);
