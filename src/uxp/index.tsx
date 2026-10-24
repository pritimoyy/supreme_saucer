import React from "react";
import ReactDOM from "react-dom/client";
import "../js/index.scss";
import { App } from "./main";

ReactDOM.createRoot(document.getElementById("app") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
