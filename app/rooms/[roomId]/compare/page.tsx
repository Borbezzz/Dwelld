import ComparisonWorkspace from "@/components/comparison-workspace";
const id=(v:unknown)=>typeof v==="string"&&/^[a-f0-9]{24}$/.test(v)?v:"";
export default async function ComparisonPage({params,searchParams}:{params:Promise<{roomId:string}>;searchParams:Promise<{baseline?:string;current?:string}>}){const q=await searchParams;return <ComparisonWorkspace roomId={(await params).roomId} baselineId={id(q.baseline)} currentId={id(q.current)}/>;}
