import SpaceDetail from "@/components/space-detail";
export default async function SpacePage({params}:{params:Promise<{spaceId:string}>}){const {spaceId}=await params;return <SpaceDetail spaceId={spaceId}/>;}
