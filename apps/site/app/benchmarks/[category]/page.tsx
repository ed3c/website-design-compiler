import { notFound } from "next/navigation";
import { GeneratedPage, type ProjectedPageGraph } from "@/components/sections/generated-page";
import projection from "@/generated/benchmark-page-graphs.json";

const graphs=projection.graphs as Record<string,ProjectedPageGraph>;
export function generateStaticParams(){return Object.keys(graphs).map((category)=>({category}));}

export default async function BenchmarkPage({params}:{params:Promise<{category:string}>}){
  const {category}=await params;
  const graph=graphs[category];
  if(!graph)notFound();
  return <GeneratedPage graph={graph}/>;
}
