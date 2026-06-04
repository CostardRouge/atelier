import { TOOLS } from './tools';

/**
 * Home page for the Atelier suite — a quiet landing that introduces the project
 * and hands off to each tool. Cards are driven by the {@link TOOLS} registry, so
 * adding a tool surfaces it here for free.
 */
export default function Home() {
  return (
    <>
      <section className="grid grid-cols-1 gap-6 pt-[clamp(2.5rem,7vw,5rem)] pb-[clamp(1.5rem,4vw,2.5rem)] min-[820px]:grid-cols-[1.35fr_1fr] min-[820px]:items-end">
        <div>
          <p className="flex items-center gap-[0.6rem] m-0 mb-4 font-mono text-[0.72rem] uppercase tracking-[0.2em] text-accent-ink before:content-[''] before:w-[26px] before:h-px before:bg-accent">
            A studio for your captures
          </p>
          <h1 className="m-0 font-serif font-normal text-[clamp(2.8rem,8vw,5.2rem)] leading-[0.95] tracking-[-0.02em]">
            One bench,
            <br />
            every <em className="text-accent italic">tool.</em>
          </h1>
        </div>
        <p className="m-0 max-w-[44ch] text-ink-soft text-[1.05rem] leading-[1.6]">
          Atelier is a small suite of local-first tools for editing the footage
          you shoot — read flight telemetry in sync with the frame, grade clips
          with LUTs, and more to come.{' '}
          <strong className="font-semibold text-ink">Nothing uploads — everything stays on your machine.</strong>
        </p>
      </section>

      <section className="grid grid-cols-1 gap-4 mb-12 min-[680px]:grid-cols-2" aria-label="Tools">
        {TOOLS.map((t) => (
          <a
            key={t.id}
            className="group flex flex-col gap-[0.55rem] px-6 py-[1.6rem] border border-line rounded-paper-lg bg-surface no-underline text-inherit shadow-paper-soft transition-[border-color,transform,box-shadow] duration-[250ms] ease-paper hover:border-line-strong hover:-translate-y-[3px] hover:shadow-paper"
            href={`#${t.path}`}
          >
            {t.subtitle && (
              <span className="font-mono text-[0.66rem] uppercase tracking-[0.16em] text-accent-ink">
                {t.subtitle}
              </span>
            )}
            <h2 className="m-0 font-serif font-normal text-[1.9rem] leading-none tracking-[-0.01em]">
              {t.label}
            </h2>
            {t.blurb && (
              <p className="m-0 flex-1 text-ink-soft text-[0.95rem] leading-[1.55]">{t.blurb}</p>
            )}
            <span
              className="inline-flex items-center gap-[0.35rem] mt-2 text-[0.78rem] font-semibold tracking-[0.01em] text-accent-ink"
              aria-hidden="true"
            >
              Open
              <svg
                viewBox="0 0 16 16"
                width="14"
                height="14"
                className="transition-transform duration-[250ms] ease-paper group-hover:translate-x-[3px]"
              >
                <path
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 8h9M8.5 4.5 12 8l-3.5 3.5"
                />
              </svg>
            </span>
          </a>
        ))}
      </section>
    </>
  );
}
