import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { cookies } from "next/headers";
import { authRequired, isValidSession, SESSION_COOKIE } from "@/lib/auth";
import { Sidebar, type SidebarProject } from "@/components/sidebar";
import { errorMessage, logger } from "@/lib/logger";
import { listProjects } from "@/lib/services/projects";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });

export const metadata: Metadata = {
  title: "SEO Automation",
  description: "Website analysis, keyword research, competitors and content strategy",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Never load project data for visitors who aren't signed in (e.g. on the login page).
  const signedIn = isValidSession((await cookies()).get(SESSION_COOKIE)?.value);
  let projects: SidebarProject[] = [];
  if (signedIn) {
    try {
      projects = (await listProjects(30)).map((p) => ({ id: p.id, domain: p.domain, status: p.status }));
    } catch (err) {
      logger.error("sidebar: list projects failed", { error: errorMessage(err) });
    }
  }

  return (
    <html lang="en" className={geist.variable}>
      <body className="min-h-screen">
        <Sidebar projects={projects} showLogout={signedIn && authRequired()} />
        <div className="lg:pl-64">
          <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
