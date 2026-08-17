import { GovernedSection, type GovernedSectionKind } from "./governed-section";

type ProjectedNode={
  id:string;
  kind:GovernedSectionKind;
  variant:string;
  semanticIndex:number;
  section:{props:Record<string,unknown>};
  responsive:{mobile:{layout:string};tablet:{layout:string};desktop:{layout:string}};
  mediaHook:{renderer:string};
  motionHook:{engine:string};
};
export type ProjectedPageGraph={
  category:string;
  readiness:"READY"|"NEEDS_INPUT";
  signature:string;
  nodes:ProjectedNode[];
};

function text(value:unknown):string|undefined{return typeof value==="string"?value:undefined;}
function items(value:unknown):string[]{if(!Array.isArray(value))return[];return value.map((entry)=>typeof entry==="string"?entry:entry&&typeof entry==="object"&&"value" in entry?String((entry as {value:unknown}).value):"").filter(Boolean);}
function content(node:ProjectedNode){
  const props=node.section.props;
  return{
    heading:text(props.heading)??text(props.headline)??text(props.title),
    body:text(props.body)??text(props.quote)??text(props.summary)??text(props.description),
    items:items(props.items)
  };
}
export function GeneratedPage({graph}: {graph:ProjectedPageGraph}){
  return <main className="wdc-shell" data-generated-page={graph.category} data-page-readiness={graph.readiness} data-graph-signature={graph.signature}>
    <header className="wdc-hero">
      <p className="wdc-eyebrow">Compiler generated benchmark</p>
      <h1>{graph.category.replaceAll("-"," ")}</h1>
      <p>Rendered directly from the governed page graph projection with semantic order, responsive, motion and media contracts attached to each node.</p>
    </header>
    {graph.nodes.map((node)=>{
      const copy=content(node);
      return <div key={node.id} data-page-node={node.id} data-semantic-index={node.semanticIndex} data-mobile-layout={node.responsive.mobile.layout} data-tablet-layout={node.responsive.tablet.layout} data-desktop-layout={node.responsive.desktop.layout} data-media-renderer={node.mediaHook.renderer} data-motion-engine={node.motionHook.engine}>
        <GovernedSection kind={node.kind} variant={node.variant} heading={copy.heading} body={copy.body} items={copy.items}/>
      </div>;
    })}
  </main>;
}
