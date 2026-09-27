import Image from "next/image";
import { SpinExperience } from "@/components/SpinExperience";

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-3 sm:px-8 sm:py-4">
        <a
          href="https://www.webauraindia.com"
          className="-my-2 flex min-h-14 items-center gap-2 transition active:scale-[0.96]"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Image src="/webaura-logo-black.png" alt="WebAura logo" width={36} height={36} priority />
          <span className="font-display text-xl font-extrabold tracking-tight text-olive">
            WebAura<span className="ml-1 align-top text-[0.6rem] font-bold tracking-[0.2em] text-gold">INDIA</span>
          </span>
        </a>
        <span className="rounded-full border border-sand px-3 py-1 text-xs font-semibold text-olive/80">Hyderabad</span>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-12 pt-1 sm:px-8 sm:pt-4 lg:pt-12">
        <SpinExperience />
      </main>

      <footer className="border-t border-sand/70 bg-white/60 px-5 py-6 text-center text-xs leading-relaxed text-navy/45">
        <p>
          © {new Date().getFullYear()} WebAura India · Websites, software &amp; marketing ·{" "}
          <a
            href="https://www.webauraindia.com"
            className="-my-5 inline-block py-5 underline underline-offset-2 transition hover:text-navy active:scale-[0.96]"
            target="_blank"
            rel="noopener noreferrer"
          >
            webauraindia.com
          </a>
        </p>
        <p className="mt-1">
          Offer valid on new projects. One coupon per person/number; not combinable with other offers. WebAura reserves the right to verify claims.
        </p>
      </footer>
    </div>
  );
}
