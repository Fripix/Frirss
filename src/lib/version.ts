// Version label shown in the sidebar footer. Dev/test builds carry a beta
// label injected at build time (e.g. "v1.3.4b3" — see publish.yml); production
// builds have none and fall back to the plain package version.
export function resolveVersionLabel(devVersion: string | undefined, appVersion: string): string {
  return devVersion ? devVersion : `v${appVersion}`;
}
