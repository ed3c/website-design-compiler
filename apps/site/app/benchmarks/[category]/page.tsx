import { notFound } from "next/navigation";
import { GeneratedPage } from "@/components/sections/generated-page";
import { SECTION_PAGE_CATEGORIES, compileSectionPageFixture, type SectionPageCategory } from "../../../../../src/section-page-fixtures";
import { compileCompletePageGraph } from "../../../../../src/complete-page-graph";

export function generateStaticParams(){return SECTION_PAGE_CATEGORIES.map((category)=>({category}));}

export default async function BenchmarkPage({params}:{params:Promise<{category:string}>}){
  const {category}=await params;
  if(!SECTION_PAGE_CATEGORIES.includes(category as SectionPageCategory))notFound();
  const graph=compileCompletePageGraph(compileSectionPageFixture(category as SectionPageCategory));
  return <GeneratedPage graph={graph}/>;
}
