import { cookies, headers } from "next/headers";
import { RelayHudShell } from "@/features/hud/RelayHudShell";
import { UnlockScreen } from "@/features/hud/UnlockScreen";
import {
  SESSION_COOKIE_NAME,
  getRemotePasscode,
  getSessionInfo,
  isRemoteAuthConfigured,
  isTrustedLocalRequest,
  resolvePublicOrigin,
} from "@/server/auth";
import { buildHudSnapshot } from "@/server/snapshot";
import { getVault } from "@/server/vault";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const reqHeaders = await headers();
  const host = (reqHeaders.get("host") ?? "127.0.0.1:3456").trim();
  const remote = !isTrustedLocalRequest(reqHeaders);
  let sessionUser = null;

  if (remote) {
    if (!isRemoteAuthConfigured()) {
      return (
        <main className="flex min-h-[100dvh] w-full items-center justify-center bg-[#101115] p-6 text-[#e6eaf0]">
          <div className="max-w-sm rounded-xl border border-[#262c38] bg-[#14171d] p-6 text-center">
            <h1 className="text-[15px] font-semibold text-white">
              Remote Access Disabled
            </h1>
            <p className="mt-2 text-[12px] leading-relaxed text-[#9ca6ba]">
              RelayHUD is running in localhost-only mode. Configure a remote
              passcode or enable Google / OIDC SSO to allow remote access.
            </p>
          </div>
        </main>
      );
    }

    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    sessionUser = getSessionInfo(sessionToken);

    if (!sessionUser) {
      const sso = getVault().getSsoConfig();
      return (
        <UnlockScreen
          host={host}
          passcodeEnabled={Boolean(getRemotePasscode())}
          googleSsoEnabled={sso.googleAppLoginEnabled}
          oidcSsoEnabled={sso.oidcAppLoginEnabled}
          oidcLabel={sso.oidcLabel}
        />
      );
    }
  }

  const origin = resolvePublicOrigin(reqHeaders, "http://127.0.0.1:3456");
  const initialSnapshot = await buildHudSnapshot(origin);

  return (
    <RelayHudShell
      initialSnapshot={initialSnapshot}
      isRemoteSession={remote}
      sessionUser={sessionUser}
    />
  );
}
