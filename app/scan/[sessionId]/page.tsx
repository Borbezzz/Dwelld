import LiveWorkspace from '@/components/live/live-workspace';
export default async function Page({params}:{params:Promise<{sessionId:string}>}){return <LiveWorkspace sessionId={(await params).sessionId} phone/>}
