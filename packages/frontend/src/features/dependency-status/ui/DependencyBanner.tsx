import type { DependencyState } from "../model/use-dependency-status.ts";

type DependencyBannerProps = {
  state: DependencyState;
};

/**
 * Shows the startup dependency check result. Renders nothing when every
 * required binary is available.
 */
export function DependencyBanner({ state }: DependencyBannerProps) {
  if (state.status === "checking") {
    return (
      <div className="dependency-banner info">Checking dependencies...</div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="dependency-banner error">
        Dependency check failed: {state.message}
      </div>
    );
  }

  const { report } = state;
  if (report.ok) return null;

  return (
    <div className="dependency-banner error" role="alert">
      <p>Backup operations are disabled. Missing or unusable dependencies:</p>
      <ul>
        {report.dependencies
          .filter((dependency) => !dependency.available)
          .map((dependency) => (
            <li key={dependency.name}>
              <strong>{dependency.name}</strong>
              {dependency.error ? `: ${dependency.error}` : ""}
            </li>
          ))}
      </ul>
    </div>
  );
}
