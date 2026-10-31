import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ margin: "auto", padding: "4rem 1rem", textAlign: "center", display: "grid", gap: "1rem" }}>
      <h1>Page not found</h1>
      <Link href="/" style={{ textDecoration: "underline" }}>
        Go home
      </Link>
    </main>
  );
}
