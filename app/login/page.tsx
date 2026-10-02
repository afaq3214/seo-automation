import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · SEO Automation" };

export default async function LoginPage(props: PageProps<"/login">) {
  const { next } = await props.searchParams;
  const target = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return (
    // Full-screen overlay so the app shell isn't visible behind the login form.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900 px-4">
      <LoginForm next={target} />
    </div>
  );
}
