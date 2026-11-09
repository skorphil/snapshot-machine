import { dirname, resolve, SEPARATOR } from "@std/path";

/**
 * Matches a feature slice path segment: `/features/<slice>` with an optional
 * trailing remainder (`/index.ts`, `/model/types.ts`, ...).
 */
const FEATURE_SEGMENT_PATTERN = /\/features\/([^/]+)(?:\/(.*))?$/;

/** Files that constitute a slice's public API when imported from outside the slice. */
const PUBLIC_API_FILE_PATTERN = /^index(\.(ts|tsx|js|jsx))?$/;

function toPosixPath(path: string): string {
  return path.split(SEPARATOR).join("/");
}

function isInternalSpecifier(specifier: string): boolean {
  return specifier.startsWith(".") ||
    specifier.startsWith("@/") ||
    specifier.startsWith("@snapshot-machine/");
}

/**
 * FSD (Feature-Sliced Design) lint plugin for Deno.
 * 
 * Enforces:
 * - No cross-feature imports: features/A cannot import from features/B.
 * - Slices in the "features" layer can only import from their own slice or the "shared" layer.
 * - Feature slices are consumed only through their public API (slice root or `index` file)
 *   from outside the slice.
 */
const fsdPlugin: Deno.lint.Plugin = {
  name: "fsd",
  rules: {
    "public-api-boundaries": {
      create(context) {
        const filename = toPosixPath(context.filename);
        const currentFeature = filename.match(/\/features\/([^/]+)\//)?.[1];

        function check(node: Deno.lint.Node, specifier: string) {
          if (!isInternalSpecifier(specifier)) return;

          const targetPath = specifier.startsWith(".")
            ? toPosixPath(resolve(dirname(context.filename), specifier))
            : specifier;

          const match = targetPath.match(FEATURE_SEGMENT_PATTERN);
          if (!match) return;

          const [, targetFeature, remainder] = match;

          // Same-slice imports may use internal deep paths.
          if (targetFeature === currentFeature) return;

          // Slice root (no remainder) or a public `index` file is allowed.
          if (!remainder || PUBLIC_API_FILE_PATTERN.test(remainder)) return;

          context.report({
            node,
            message: `Import "${specifier}" reaches into the internals of feature "${targetFeature}". Import from its public API ("/features/${targetFeature}" or its index file) instead.`,
          });
        }

        return {
          ImportDeclaration(node) {
            check(node, node.source.value);
          },
          ExportNamedDeclaration(node) {
            if (node.source) check(node, node.source.value);
          },
          ExportAllDeclaration(node) {
            check(node, node.source.value);
          },
        };
      },
    },
    "no-cross-feature-import": {
      create(context) {
        const filename = context.filename;
        const normalizedFilename = filename.split(SEPARATOR).join("/");
        
        const featureMatch = normalizedFilename.match(/\/features\/([^/]+)\//);
        if (!featureMatch) {
          return {};
        }

        const currentFeature = featureMatch[1];

        return {
          ImportDeclaration(node) {
            const specifier = node.source.value;
            
            // Only check internal imports
            const isInternal = specifier.startsWith(".") || 
                             specifier.startsWith("@/") || 
                             specifier.startsWith("@snapshot-machine/");
            
            if (!isInternal) return;

            let resolvedPath: string;
            if (specifier.startsWith(".")) {
              resolvedPath = resolve(dirname(filename), specifier).split(SEPARATOR).join("/");
            } else {
              // For aliased imports, we use the specifier itself as a proxy for the path
              // since we know the alias structure.
              resolvedPath = specifier;
            }

            // Check if the import is within the same feature slice
            const targetFeatureMatch = resolvedPath.match(/\/features\/([^/]+)\//) || 
                                     specifier.match(/\/features\/([^/]+)\//);
            
            const isSameFeature = targetFeatureMatch && targetFeatureMatch[1] === currentFeature;
            
            // Check if the import is from a shared folder
            // 1. Explicit workspace shared: @snapshot-machine/shared/
            // 2. Any folder named "shared": /shared/
            const isShared = specifier.startsWith("@snapshot-machine/shared/") || 
                            resolvedPath.includes("/shared/") ||
                            specifier.includes("/shared/");

            if (!isSameFeature && !isShared) {
              // If it's another feature
              if (targetFeatureMatch) {
                const targetFeature = targetFeatureMatch[1];
                context.report({
                  node,
                  message: `Feature "${currentFeature}" is not allowed to import from feature "${targetFeature}". Cross-feature imports are forbidden in FSD.`,
                });
              } else {
                // If it's something else that is not shared (e.g. a higher layer like App or Page)
                context.report({
                  node,
                  message: `Feature "${currentFeature}" is only allowed to import from its own slice or from the "shared" layer. Import "${specifier}" is not allowed.`,
                });
              }
            }
          },
        };
      },
    },
  },
};

export default fsdPlugin;
