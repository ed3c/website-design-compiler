export type GovernedSectionKind = "navigation"|"hero"|"feature-grid"|"bento-grid"|"proof-cloud"|"metrics"|"testimonial"|"comparison"|"pricing"|"faq"|"cta"|"footer"|"editorial-prose"|"editorial-media"|"product-showcase"|"media-stage"|"graphics-2d-stage"|"graphics-3d-stage";

export type GovernedSectionProps = {
  kind: GovernedSectionKind;
  variant: string;
  heading?: string;
  body?: string;
  items?: readonly string[];
  action?:{label:string;href:string};
};

export function GovernedSection({kind,variant,heading,body,items=[],action}:GovernedSectionProps){
  const title=heading??kind.replaceAll("-"," ");
  const content=<>
    <p className="wdc-section-kicker">{kind}</p>
    <h2>{title}</h2>
    {body?<p>{body}</p>:null}
    {items.length>0?<ul>{items.map((item)=><li key={item}>{item}</li>)}</ul>:null}
  </>;
  if(kind==="navigation") return <nav data-governed-section={kind} data-variant={variant} aria-label="Primary">{content}</nav>;
  if(kind==="footer") return <footer data-governed-section={kind} data-variant={variant}>{content}</footer>;
  if(kind==="editorial-prose") return <article data-governed-section={kind} data-variant={variant}>{content}</article>;
  return <section data-governed-section={kind} data-variant={variant} aria-labelledby={`section-${kind}`}><div><p className="wdc-section-kicker">{kind}</p><h2 id={`section-${kind}`}>{title}</h2>{body?<p>{body}</p>:null}{items.length>0?<ul>{items.map((item)=><li key={item}>{item}</li>)}</ul>:null}{action?<div className="wdc-actions"><a className="wdc-button wdc-button--primary" href={action.href}>{action.label}</a></div>:null}</div></section>;
}
