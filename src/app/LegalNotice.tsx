import { useState, type ReactNode } from 'react';
import PageBar from '../shared/ui/PageBar';
import Button from '../shared/ui/Button';
import { audienceState, setOptOut, type AudienceState } from './audience';
import { MEASUREMENT_HOST, NETWORK_EXCEPTIONS } from './legal';
import { REPO_URL, SITE_URL } from './site';
import { navigate } from './use-hash-route';

/**
 * `#/legal` — the legal notice: who publishes Atelier, who hosts it, what
 * stays on the device, which requests may leave it, how visits are counted
 * and the switch to stop that, the licence. A reading page of the shell,
 * like `#/agents`, linked from the home page's footer (COMMON-PROJECT-SPEC
 * C17). Facts only, in the words versus' notice uses for the same ones; the
 * requests come from `legal.ts`, which `legal.test.ts` holds to the code.
 */

const legend = 'font-mono text-2xs tracking-[0.14em] uppercase text-muted';
const link = 'text-accent-ink underline underline-offset-[3px] hover:text-accent';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 pb-8 border-b border-line">
      <h2 className="m-0 font-serif text-xl leading-snug">{title}</h2>
      {children}
    </section>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p className="m-0 text-sm text-ink-soft leading-relaxed">{children}</p>;
}

function Out({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className={link} href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

const code = (s: string) => <code className="font-mono text-xs bg-paper-2 px-1 py-[0.05rem] rounded">{s}</code>;

const SENTENCES: Record<AudienceState, string> = {
  on: 'Your visits are counted, anonymously, in this browser.',
  'opted-out': 'Your visits aren’t counted in this browser.',
  declined: 'Your browser asks not to be tracked: your visits aren’t counted.',
  off: 'This copy of Atelier doesn’t count visits.',
};

/** The counter's state in this browser, and the switch where there is a choice to make. */
function MeasurementSwitch() {
  const [state, setState] = useState<AudienceState>(() => audienceState());
  const toggle = () => {
    setOptOut(state === 'on');
    setState(audienceState());
  };
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 rounded-paper border border-line bg-surface"
      aria-live="polite"
    >
      <p className="m-0 text-sm text-ink">{SENTENCES[state]}</p>
      {(state === 'on' || state === 'opted-out') && (
        <span className="ml-auto">
          <Button size="sm" onClick={toggle}>
            {state === 'on' ? 'Stop counting my visits' : 'Count my visits again'}
          </Button>
        </span>
      )}
    </div>
  );
}

export default function LegalNotice() {
  const host = new URL(SITE_URL).host;
  return (
    <article className="w-full max-w-[46rem] mx-auto mt-2 sm:mt-6 mb-16 flex flex-col gap-8 px-1" aria-label="Legal notice">
      <PageBar back={{ label: 'Home', onClick: () => navigate('/') }} />

      <header>
        <p className={legend}>Legal</p>
        <h1 className="m-0 mt-1 font-serif text-3xl leading-tight">Legal notice and privacy</h1>
        <p className="m-0 mt-2 text-base text-ink-soft leading-relaxed">
          Who publishes Atelier, who hosts it, and what it knows about you: very little. Your files never leave your
          machine, and what the app keeps, it keeps in this browser.
        </p>
        <p className="m-0 mt-2 text-xs text-muted">Last updated on 19 October 2026.</p>
      </header>

      <Section title="Publisher">
        <P>
          Atelier is published by <b className="text-ink font-medium">Steeve Pommier</b>, a private individual, on a
          non-commercial basis: it is free, shows no ads and sells nothing.
        </P>
        <P>
          As a non-professional publisher, the personal details required by French law (Loi pour la confiance dans
          l’économie numérique, art. 6-III) are kept with the hosting provider named below.
        </P>
        <P>
          Contact: through the <Out href={`${REPO_URL}/issues`}>repository’s issues</Out>.
        </P>
      </Section>

      <Section title="Hosting">
        <P>
          <b className="text-ink font-medium">{host}</b> is served by GitHub Pages: GitHub, Inc., 88 Colin P. Kelly Jr.
          Street, San Francisco, CA 94107, United States, <Out href="https://github.com">github.com</Out>. The site is
          static — no server of Atelier’s own runs anywhere, and nothing you do in it reaches one.
        </P>
        <P>Audience measurement runs on the publisher’s own server (see below).</P>
      </Section>

      <Section title="On your device">
        <P>
          Your photos, clips and logs are read in this browser and never uploaded. What Atelier keeps, it keeps in this
          browser’s storage, on this device only: your projects, trips, rolls and atlases with their settings and
          small previews of them; the story script you loaded in Storytelling; the looks and presets you loaded; the map tiles, lens profiles, camera profiles and
          logos you asked for or brought in; and your preferences (theme, layout, the choices each tool remembers). A
          Develop roll may also keep, when you let it, a working preview of each of its local pictures and a small
          vignette of each picture as shot beside its settings, so a style of your own can be learned on this machine;
          both are switched in Develop’s settings. Nothing else of a file is kept.
        </P>
        <P>
          None of this is sent anywhere, except what you send to a Winnow of your own (below) or export yourself. To
          erase it, delete the documents in the app, or clear this site’s data in your browser’s settings. An app
          installed from the home screen on iOS has a storage of its own: a document made in Safari is not in it.
        </P>
      </Section>

      <Section title="What may leave the browser">
        <P>
          The app itself, its decoders and models, its map outline, place index and look tiles are fetched from this
          site as they are needed, never from a third party. Beyond that, a request leaves only in the cases below —
          each one off until you turn it on, or started by your own gesture.
        </P>
        <ul className="m-0 pl-5 list-disc flex flex-col gap-2 text-sm text-ink-soft leading-relaxed">
          {NETWORK_EXCEPTIONS.map((exception) => (
            <li key={exception.host}>
              <b className="text-ink font-medium">{exception.name}</b> ({code(exception.host)}) — {exception.when}
            </li>
          ))}
          <li>
            <b className="text-ink font-medium">A Winnow instance you connected yourself</b> — your own server: Atelier
            reads media from it and writes to it in three places only (an export sent back, a document kept there, a
            purchased look’s file), always on your gesture and under your account there, never to a third party. Its
            session cookie is Winnow’s, under Winnow’s rules.
          </li>
          <li>
            <b className="text-ink font-medium">The agent bridge</b> — a program on your own computer, reached over{' '}
            {code('127.0.0.1')} alone, after you press Connect on the Sources screen.
          </li>
        </ul>
        <P>No account, no cookie of Atelier’s own, and no language model is ever called by Atelier.</P>
      </Section>

      <Section title="Audience measurement">
        <P>
          Visits are counted with <Out href="https://umami.is">Umami</Out>, self-hosted on the publisher’s own server at{' '}
          {code(MEASUREMENT_HOST)}: no third party receives the data, and none of it serves advertising.
        </P>
        <P>
          <b className="text-ink font-medium">Counted:</b> a view of the home page, and which tool you opened (
          {code('/develop')}, {code('/studio')}…) — never the route inside it, a document, a file name, a position or
          anything you did; the site you came from; your browser, system, type of device, screen size, language and
          country.
        </P>
        <P>
          <b className="text-ink font-medium">Never counted:</b> your pictures, your documents, your Winnow’s address,
          your IP address (it gives the country, then is discarded), or anything that could follow you from one site
          to another. No cookie is set.
        </P>
        <P>
          The counter isn’t even loaded when your browser sends <i>Do Not Track</i> or <i>Global Privacy Control</i>,
          or when you switch it off below; that choice is kept in this browser.
        </P>
        <MeasurementSwitch />
      </Section>

      <Section title="Cookies">
        <P>
          Atelier sets no cookie, so there is no consent banner: there is nothing to consent to. A Winnow you connect
          uses its own session cookie, under its own rules.
        </P>
      </Section>

      <Section title="Hosting logs">
        <P>
          Like any host, GitHub processes your IP address to deliver the pages and logs it for security purposes,
          under{' '}
          <Out href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement">
            GitHub’s privacy statement
          </Out>
          . Atelier itself keeps no log: it has no server.
        </P>
      </Section>

      <Section title="Your rights">
        <P>
          Under the GDPR you may ask to access or erase data about you. Atelier keeps none that names you: your
          documents are on your device, and the visits counted carry no identity. For any question or request, write
          to the publisher through the <Out href={`${REPO_URL}/issues`}>repository</Out>; you may also lodge a complaint
          with the <Out href="https://www.cnil.fr">CNIL</Out>.
        </P>
      </Section>

      <Section title="Licence and content">
        <P>
          Atelier is free software: its <Out href={REPO_URL}>source code</Out> is published under the{' '}
          <Out href={`${REPO_URL}/blob/main/LICENSE`}>MIT licence</Out>.
        </P>
        <P>
          What you put in Atelier remains yours: nothing of it is sent to the publisher. The map under an opt-in
          background is © OpenStreetMap contributors; the place index shipped with the app is from GeoNames (CC BY
          4.0) and the land outline from Natural Earth (public domain).
        </P>
      </Section>

      <Section title="Liability">
        <P>
          Atelier is provided as is, in good faith, with no warranty of any kind. Links to other sites are given for
          convenience; their content is theirs.
        </P>
      </Section>
    </article>
  );
}
