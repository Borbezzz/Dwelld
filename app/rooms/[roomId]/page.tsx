import RoomDetail from "@/components/room-detail";
export default async function RoomPage({params}:{params:Promise<{roomId:string}>}){const {roomId}=await params;return <RoomDetail roomId={roomId}/>;}
