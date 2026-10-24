import LiveWorkspace from "@/components/live/live-workspace";
type Query={new?:string;room?:string;type?:string;baseline?:string};
export default async function Page({searchParams}:{searchParams:Promise<Query>}){const q=await searchParams;const room=typeof q.room==="string"&&/^[a-f0-9]{24}$/.test(q.room)?q.room:"";const baseline=typeof q.baseline==="string"&&/^[a-f0-9]{24}$/.test(q.baseline)?q.baseline:"";return <LiveWorkspace newRoom={q.new==="1"} initialRoomId={room} lockRoom={!!room} initialType={q.type==="move-out"?"move-out":"move-in"} baselineId={baseline}/>;}
