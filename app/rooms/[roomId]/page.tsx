import CaptureRoom from "@/components/capture-room";
export default async function RoomPage({ params }: { params: Promise<{ roomId: string }> }) { const { roomId } = await params; return <CaptureRoom roomId={roomId}/>; }
