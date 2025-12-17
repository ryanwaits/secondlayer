/**
 * React Context for SecondLayer configuration
 */

import { createContext } from "react";
import type { SecondLayerReactConfig } from "../types";

/**
 * React context for SecondLayer configuration
 */
export const SecondLayerContext = createContext<SecondLayerReactConfig | undefined>(
  undefined
);

/**
 * Display name for debugging
 */
SecondLayerContext.displayName = "SecondLayerContext";
