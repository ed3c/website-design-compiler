import type { SectionInstance, SectionKind } from "../../../../src/section-grammar";
import styles from "./governed-section.module.css";

export type GovernedSectionKind = SectionKind;

export type GovernedSectionProps = {
  kind: GovernedSectionKind;
  variant: string;
  fields: SectionInstance["props"];
  headingLevel?: 1 | 2;
};

type LinkValue = { label: string; href: string };
type MediaValue = { assetId: string; alt: string };

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function link(value: unknown): LinkValue | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const label = text(candidate.label);
  const href = text(candidate.href);
  return label && href ? { label, href } : undefined;
}

function media(value: unknown): MediaValue | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const assetId = text(candidate.assetId);
  const alt = text(candidate.alt);
  return assetId && alt ? { assetId, alt } : undefined;
}

function items(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === "string" && entry.trim()) return [entry];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = text((entry as Record<string, unknown>).value);
    return item ? [item] : [];
  });
}

function Kicker({ children }: { children: string }) {
  return <p className={styles.kicker}>{children}</p>;
}

function Action({ value, tone = "solid" }: { value: LinkValue; tone?: "solid" | "quiet" }) {
  return <a className={tone === "solid" ? styles.action : styles.quietAction} href={value.href}>{value.label}</a>;
}

function MediaFrame({ value, label }: { value?: MediaValue; label: string }) {
  const accessibleLabel = value?.alt ?? `${label} media is not supplied`;
  return <div className={styles.mediaFrame} role="img" aria-label={accessibleLabel} data-asset-id={value?.assetId ?? "ABSENT"}>
    <span aria-hidden="true" className={styles.mediaGlyph}>◫</span>
    <span>{value?.assetId ?? "Awaiting approved media"}</span>
  </div>;
}

export function GovernedSection({ kind, variant, fields, headingLevel = 1 }: GovernedSectionProps) {
  const heading = text(fields.heading) ?? text(fields.headline) ?? kind.replaceAll("-", " ");
  const body = text(fields.body) ?? text(fields.description);
  const list = items(fields.items);

  if (kind === "navigation") {
    const action = link(fields.action);
    return <nav className={`${styles.section} ${styles.navigation}`} data-governed-section={kind} data-variant={variant} aria-label="Primary">
      <a className={styles.brand} href="#top">{text(fields.brand) ?? "Governed site"}</a>
      <ul className={styles.navLinks}>{items(fields.links).map((item, index) => <li key={`${item}-${index}`}><a href={`#${item.toLowerCase().replaceAll(" ", "-")}`}>{item}</a></li>)}</ul>
      {action ? <Action value={action} /> : null}
    </nav>;
  }

  if (kind === "hero") {
    const primary = link(fields.primaryAction);
    const secondary = link(fields.secondaryAction);
    const Heading = headingLevel === 1 ? "h1" : "h2";
    return <section className={`${styles.section} ${styles.hero}`} data-governed-section={kind} data-variant={variant}>
      <div className={styles.heroCopy}>
        <Kicker>{text(fields.eyebrow) ?? variant}</Kicker>
        <Heading>{heading}</Heading>
        {body ? <p className={styles.lede}>{body}</p> : null}
        <div className={styles.actions}>{primary ? <Action value={primary} /> : null}{secondary ? <Action value={secondary} tone="quiet" /> : null}</div>
      </div>
      {variant !== "text-first" || fields.media ? <MediaFrame value={media(fields.media)} label="Hero" /> : null}
    </section>;
  }

  if (kind === "feature-grid" || kind === "bento-grid") {
    return <section className={`${styles.section} ${kind === "bento-grid" ? styles.bento : styles.featureGrid}`} data-governed-section={kind} data-variant={variant}>
      <header className={styles.sectionHeader}><Kicker>{variant}</Kicker><h2>{heading}</h2></header>
      <ul className={styles.cardGrid}>{list.map((item, index) => <li key={`${item}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><h3>{item}</h3><p>Governed content field</p></li>)}</ul>
    </section>;
  }

  if (kind === "proof-cloud") {
    return <section className={`${styles.section} ${styles.proof}`} data-governed-section={kind} data-variant={variant}>
      <header className={styles.sectionHeader}><Kicker>Evidence required</Kicker><h2>{heading}</h2></header>
      <ul className={styles.proofCloud}>{list.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
    </section>;
  }

  if (kind === "metrics") {
    return <section className={`${styles.section} ${styles.metrics}`} data-governed-section={kind} data-variant={variant}>
      <Kicker>Measured evidence</Kicker><h2>{heading}</h2>
      <dl>{list.map((item, index) => <div key={`${item}-${index}`}><dt>{item.split(/\s[—:-]\s/)[0]}</dt><dd>{item.split(/\s[—:-]\s/).slice(1).join(" — ") || "Supplied metric"}</dd></div>)}</dl>
    </section>;
  }

  if (kind === "testimonial") {
    return <section className={`${styles.section} ${styles.testimonial}`} data-governed-section={kind} data-variant={variant}>
      <Kicker>Attributed testimony</Kicker>
      <blockquote>“{text(fields.quote)}”</blockquote>
      <cite>{text(fields.attribution)}</cite>
    </section>;
  }

  if (kind === "comparison") {
    return <section className={`${styles.section} ${styles.comparison}`} data-governed-section={kind} data-variant={variant}>
      <table><caption>{heading}</caption><thead><tr><th scope="col">Option</th><th scope="col">Evidence</th></tr></thead><tbody>{list.map((item, index) => <tr key={`${item}-${index}`}><th scope="row">{`0${index + 1}`}</th><td>{item}</td></tr>)}</tbody></table>
    </section>;
  }

  if (kind === "pricing") {
    return <section className={`${styles.section} ${styles.pricing}`} data-governed-section={kind} data-variant={variant}>
      <header className={styles.sectionHeader}><Kicker>Commercial evidence</Kicker><h2>{heading}</h2></header>
      <ul className={styles.priceGrid}>{list.map((item, index) => <li key={`${item}-${index}`}><span>Tier {index + 1}</span><h3>{item}</h3><a href="#contact">Review terms</a></li>)}</ul>
    </section>;
  }

  if (kind === "faq") {
    return <section className={`${styles.section} ${styles.faq}`} data-governed-section={kind} data-variant={variant}>
      <header className={styles.sectionHeader}><Kicker>{variant}</Kicker><h2>{heading}</h2></header>
      <div>{list.map((item, index) => <details key={`${item}-${index}`} open={index === 0}><summary>{item}</summary><p>Answer content remains bound to the approved item.</p></details>)}</div>
    </section>;
  }

  if (kind === "cta") {
    const action = link(fields.action);
    return <section className={`${styles.section} ${styles.cta}`} data-governed-section={kind} data-variant={variant}>
      <div><Kicker>Next action</Kicker><h2>{heading}</h2>{body ? <p>{body}</p> : null}</div>
      {action ? <Action value={action} /> : null}
    </section>;
  }

  if (kind === "footer") {
    return <footer className={`${styles.section} ${styles.footer}`} data-governed-section={kind} data-variant={variant}>
      <strong>{text(fields.brand)}</strong>
      <ul>{items(fields.links).map((item, index) => <li key={`${item}-${index}`}><a href={`#${index}`}>{item}</a></li>)}</ul>
      {text(fields.legal) ? <small>{text(fields.legal)}</small> : null}
    </footer>;
  }

  if (kind === "editorial-prose") {
    return <article className={`${styles.section} ${styles.editorial}`} data-governed-section={kind} data-variant={variant}>
      <Kicker>{variant}</Kicker><h2>{heading}</h2>
      {(text(fields.body) ?? "").split(/\n+/).map((paragraph, index) => <p key={`${paragraph}-${index}`}>{paragraph}</p>)}
    </article>;
  }

  if (kind === "editorial-media") {
    const value = media(fields.media);
    return <figure className={`${styles.section} ${styles.editorialMedia}`} data-governed-section={kind} data-variant={variant}>
      <MediaFrame value={value} label="Editorial" />
      {text(fields.caption) ? <figcaption>{text(fields.caption)}</figcaption> : null}
    </figure>;
  }

  if (kind === "product-showcase") {
    return <section className={`${styles.section} ${styles.product}`} data-governed-section={kind} data-variant={variant}>
      <MediaFrame value={media(fields.media)} label="Product" />
      <div><Kicker>{variant}</Kicker><h2>{heading}</h2>{body ? <p className={styles.lede}>{body}</p> : null}</div>
    </section>;
  }

  if (kind === "media-stage") {
    return <section className={`${styles.section} ${styles.mediaStage}`} data-governed-section={kind} data-variant={variant}>
      <MediaFrame value={media(fields.media)} label="Stage" />
      <div><Kicker>{variant}</Kicker>{text(fields.description) ? <p>{text(fields.description)}</p> : null}</div>
    </section>;
  }

  if (kind === "graphics-2d-stage") {
    return <section className={`${styles.section} ${styles.graphics2d}`} data-governed-section={kind} data-variant={variant}>
      <div className={styles.canvas2d} aria-hidden="true"><i/><i/><i/><i/></div>
      <div><Kicker>Progressive 2D</Kicker><h2>{heading}</h2><p>{text(fields.description)}</p></div>
    </section>;
  }

  return <section className={`${styles.section} ${styles.graphics3d}`} data-governed-section={kind} data-variant={variant}>
    <div className={styles.scene3d} aria-hidden="true"><i/><i/><i/></div>
    <div><Kicker>Progressive 3D</Kicker><h2>{heading}</h2><p>{text(fields.description)}</p></div>
  </section>;
}
