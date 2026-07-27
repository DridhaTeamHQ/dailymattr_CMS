import type { Metadata } from "next";
import { Be_Vietnam_Pro, Inter, Plus_Jakarta_Sans, Geist } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const bvp = Be_Vietnam_Pro({
  variable: "--font-bvp",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

// The two faces the Pix spec names — used only inside the poster preview, so
// what the writer sees in the CMS is the type the reader gets in the app.
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["800"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "DailyMattr Studio — CMS",
  description: "Uploading platform for the DailyMattr app",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn("h-full", "antialiased", bvp.variable, jakarta.variable, inter.variable, "font-sans", geist.variable)}
    >
      <body className="min-h-full font-sans">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
