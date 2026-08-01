import type { Metadata } from "next";
import {
  Be_Vietnam_Pro,
  Geist,
  Inter,
  Plus_Jakarta_Sans,
  Poppins,
  Roboto_Serif,
} from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { THEME_BOOTSTRAP, ThemeProvider } from "@/lib/theme";
import { ToastProvider } from "@/lib/toast";
import ErrorReporter from "@/components/ErrorReporter";
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

// The Pix Post Builder sets its poster headline in Roboto Serif 600. The
// composer reads this variable and hands the resolved family to the canvas.
const robotoSerif = Roboto_Serif({
  variable: "--font-roboto-serif",
  subsets: ["latin"],
  weight: ["600"],
});

// Body copy on the builder's Text screen.
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["700"],
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
    // The bootstrap script below writes `data-theme` and the `dark` class onto
    // this element before React hydrates, so the client copy deliberately
    // differs from the server's. That is the only difference, and it is the
    // price of not flashing a white page on a dark-mode reload — so the warning
    // is suppressed here and nowhere else.
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "h-full",
        "antialiased",
        bvp.variable,
        jakarta.variable,
        inter.variable,
        robotoSerif.variable,
        poppins.variable,
        "font-sans",
        geist.variable
      )}
    >
      <head>
        {/* Sets the theme before first paint, so a dark-mode reload never
            flashes a white page. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="min-h-full font-sans">
        {/* Outside the providers: a failure in one of them is exactly the kind
            worth catching, and a reporter mounted underneath would come down
            with it. */}
        <ErrorReporter />
        <ThemeProvider>
          {/* Above AuthProvider so sign-in and sign-out can announce
              themselves too, not only what happens once inside. */}
          <ToastProvider>
            <AuthProvider>{children}</AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
