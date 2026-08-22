import { handleRuRequest } from "../_lib/notion-render.js";

export function onRequest(context) {
  return handleRuRequest(context, []);
}
