import ComparisonWorkspace from "@/components/comparison-workspace";
export default async function ComparisonPage({params}:{params:Promise<{roomId:string}>}){return <ComparisonWorkspace roomId={(await params).roomId}/>;}
