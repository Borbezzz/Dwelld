import PairCapture from '@/components/pair-capture';
export default async function Page({params}:{params:Promise<{sessionId:string}>}){return <PairCapture sessionId={(await params).sessionId}/>;}
