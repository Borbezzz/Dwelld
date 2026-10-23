import LiveWorkspace from "@/components/live/live-workspace";
export default async function RoomPage({params}:{params:Promise<{roomId:string}>}){const {roomId}=await params;return <LiveWorkspace initialRoomId={roomId}/>;}
