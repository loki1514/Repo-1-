import { notFound } from "next/navigation";
import {
  billCharges,
  currentSessionForTable,
  guestMenu,
  resolveQrToken,
  sessionOrders,
} from "@/lib/guest";
import { fontHref, fontVars, themeVars, type OrgTheme } from "@/lib/theme";
import { GuestApp } from "@/components/guest/GuestApp";
import { WelcomeGate } from "@/components/guest/WelcomeGate";

export const dynamic = "force-dynamic";

/**
 * /t/<qr_token> — what the sticker on the table points at.
 *
 * The session is keyed to the *table*, not to a browser. Four people at table
 * 22 scanning four phones all land on one bill, which is the behaviour a
 * restaurant actually wants; the PIN is then how they prove to each other
 * they are on it, exactly as the printed reference does.
 */
export default async function TablePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const table = await resolveQrToken(token);
  if (!table) notFound();

  const theme = (table.theme ?? {}) as OrgTheme;
  const shell = { ...themeVars(theme), ...fontVars(theme.font) } as React.CSSProperties;
  const href = fontHref(theme.font);

  const session = await currentSessionForTable(table.tableId);

  const chrome = (children: React.ReactNode) => (
    <div style={shell} className="min-h-dvh">
      {href && (
        <>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
          <link rel="stylesheet" href={href} />
        </>
      )}
      {children}
    </div>
  );

  if (!session) {
    return chrome(
      <WelcomeGate
        token={token}
        orgName={table.orgName}
        tableLabel={table.label}
        areaName={table.areaName}
      />,
    );
  }

  const [menu, orders, charges] = await Promise.all([
    guestMenu(table.orgId),
    sessionOrders(session.id),
    billCharges(table.orgId),
  ]);

  return chrome(
    <GuestApp
      token={token}
      table={table}
      session={session}
      categories={menu.categories}
      items={menu.items}
      orders={orders}
      charges={charges}
    />,
  );
}
