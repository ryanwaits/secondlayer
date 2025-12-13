/**
 * React Context for Stacks configuration
 */

import { createContext } from "react";
import type { StacksReactConfig } from "../types";

/**
 * React context for Stacks configuration
 */
export const StacksContext = createContext<StacksReactConfig | undefined>(
  undefined
);

/**
 * Display name for debugging
 */
StacksContext.displayName = "StacksContext";
