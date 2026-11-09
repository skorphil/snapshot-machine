/**
 * Public entry point for the dependency status feature.
 *
 * @module
 */
export { DependencyBanner } from "./ui/DependencyBanner.tsx";
export {
  type DependencyState,
  useDependencyStatus,
} from "./model/use-dependency-status.ts";
