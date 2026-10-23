import LiveWorkspace from "@/components/live/live-workspace";
export default async function Page({searchParams}:{searchParams:Promise<{new?:string}>}){const query=await searchParams;return <LiveWorkspace newRoom={query.new==="1"}/>;}
