import KeystaticApp from "./keystatic";

export const metadata = { title: "CMS", robots: { index: false, follow: false } };

export default function Layout({ children }: LayoutProps<"/keystatic">) {
  return (
    <>
      <KeystaticApp />
      {children}
    </>
  );
}
