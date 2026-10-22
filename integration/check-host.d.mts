export const requiredPublicInterfaces: Record<string, string[]>;
export function checkHost(installationManifest: string): Promise<{
  version: string;
  interfaces: Record<string, string[]>;
}>;
