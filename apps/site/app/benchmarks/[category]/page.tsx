import { notFound } from "next/navigation";
import { GeneratedPage, type ProjectedPageGraph } from "@/components/sections/generated-page";
import projection from "@/generated/benchmark-page-graphs.json";

const graphs=projection.graphs as Record<string,ProjectedPageGraph>;
type ProjectedSite={project:string;signature:string;source:{mode:string;artifacts:Record<string,string>};routes:Array<{route:string;page:ProjectedPageGraph&{signature:string}}>};
const sites=projection.sites as Record<string,ProjectedSite>;
export function generateStaticParams(){return Object.keys(graphs).map((category)=>({category}));}

export default async function BenchmarkPage({params,searchParams}:{params:Promise<{category:string}>;searchParams:Promise<{route?:string}>}){
  const {category}=await params;
  const {route="/"}=await searchParams;
  const site=sites[category];
  const graph=site?.routes.find((entry)=>entry.route===route)?.page;
  if(!site||!graph)notFound();
  return <div data-compiled-site={category} data-site-project={site.project} data-site-route={route} data-site-signature={site.signature} data-page-signature={graph.signature} data-upstream-mode={site.source.mode} data-upstream-artifacts={JSON.stringify(site.source.artifacts)}><GeneratedPage graph={graph}/></div>;
}
