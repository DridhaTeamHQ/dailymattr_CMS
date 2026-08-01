"use client";

import { useEffect } from "react";
import { installErrorReporting } from "@/lib/report";

/**
 * Mounts the window-level error listeners.
 *
 * A component rather than a call in the layout because the listeners have to be
 * attached in the browser and taken down again — a module-level side effect
 * would attach on every hot reload in development and never let go.
 *
 * Renders nothing.
 */
export default function ErrorReporter() {
  useEffect(() => installErrorReporting(), []);
  return null;
}
